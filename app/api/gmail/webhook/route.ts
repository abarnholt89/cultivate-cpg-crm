import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function extractEmailAddresses(headers: any[] = [], name: string) {
  const header = headers.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  );
  if (!header?.value) return [];

  return header.value
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);
}

function extractHeader(headers: any[] = [], name: string) {
  return (
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ||
    ""
  );
}

function decodeBase64Url(input?: string) {
  if (!input) return "";
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function extractPlainTextFromPayload(payload: any): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts?.length) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }

    for (const part of payload.parts) {
      const nested = extractPlainTextFromPayload(part);
      if (nested) return nested;
    }
  }

  return "";
}

function buildClientMessage(activityKind: string, activityTypeKey: string, subject: string) {
  if (activityKind === "outbound_initial") {
    if (activityTypeKey === "submission") {
      return "Rep submitted products to the retailer.";
    }
    if (activityTypeKey === "follow_up") {
      return "Rep initiated outreach and follow-up with the retailer.";
    }
    return "Rep sent an outreach email to the retailer.";
  }

  if (activityKind === "outbound_follow_up") {
    return "Rep followed up with the retailer.";
  }

  if (activityKind === "retailer_reply") {
    return "Retailer replied. Summary draft ready for review.";
  }

  return subject || "Email activity logged.";
}

function simpleAiDraftSummary(bodyText: string, subject: string) {
  const text = (bodyText || "").trim();

  if (!text) {
    return {
      aiSummary: "Retailer replied by email.",
      clientDraftSummary: "Retailer responded by email.",
      approvalStatus: "pending_review",
    };
  }

  const lower = text.toLowerCase();

  if (lower.includes("sample")) {
    return {
      aiSummary: "Retailer replied and requested samples.",
      clientDraftSummary: "Retailer responded positively and requested samples for evaluation.",
      approvalStatus: "pending_review",
    };
  }

  if (lower.includes("meeting") || lower.includes("call")) {
    return {
      aiSummary: "Retailer replied and requested a meeting or call.",
      clientDraftSummary: "Retailer responded and is open to a meeting or call.",
      approvalStatus: "pending_review",
    };
  }

  if (lower.includes("not interested")) {
    return {
      aiSummary: "Retailer replied and indicated they are not interested at this time.",
      clientDraftSummary: "Retailer responded and is not moving forward at this time.",
      approvalStatus: "pending_review",
    };
  }

  if (lower.includes("circle back") || lower.includes("follow up later") || lower.includes("reach back out")) {
    return {
      aiSummary: "Retailer replied and asked to reconnect later.",
      clientDraftSummary: "Retailer responded and requested a later follow-up.",
      approvalStatus: "pending_review",
    };
  }

  return {
    aiSummary: subject
      ? `Retailer replied regarding "${subject}".`
      : "Retailer replied by email.",
    clientDraftSummary: "Retailer responded by email. Draft summary is ready for review.",
    approvalStatus: "pending_review",
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("📩 PubSub message received:", body);

    const message = body?.message;
    if (!message?.data) {
      return new Response("No data", { status: 200 });
    }

    const decoded = JSON.parse(
      Buffer.from(message.data, "base64").toString("utf-8")
    );

    console.log("📬 Decoded Gmail event:", decoded);

    const { emailAddress, historyId } = decoded;

    const { data: watchRow, error: watchLookupError } = await supabase
      .from("gmail_mailbox_watches")
      .select("*")
      .eq("gmail_email", emailAddress)
      .maybeSingle();

    if (watchLookupError) {
      console.error("watch lookup error", watchLookupError);
      return new Response("Watch lookup error", { status: 500 });
    }

    if (!watchRow) {
      console.log("No watch row found for mailbox:", emailAddress);
      return new Response("No watch row", { status: 200 });
    }

    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY!;

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      subject: emailAddress,
    });

    const gmail = google.gmail({ version: "v1", auth });

    const history = await gmail.users.history.list({
      userId: "me",
      startHistoryId: watchRow.gmail_history_id,
    });

    console.log("📚 Gmail history full:", JSON.stringify(history.data, null, 2));

    const historyItems = history.data.history || [];
    const processedMessageIds = new Set<string>();

    for (const item of historyItems) {
      const candidateMessages = [
        ...(item.messages || []),
        ...((item.messagesAdded || []).map((x: any) => x.message).filter(Boolean)),
      ];

      for (const msg of candidateMessages) {
        if (!msg?.id) continue;
        if (processedMessageIds.has(msg.id)) continue;
        processedMessageIds.add(msg.id);

        let fullMessage;
        try {
          fullMessage = await gmail.users.messages.get({
            userId: "me",
            id: msg.id,
            format: "full",
          });
        } catch (err: any) {
          const status = err?.status || err?.code || err?.response?.status;
          if (status === 404) {
            console.log("⏭️ Gmail message no longer exists, skipping:", msg.id);
            continue;
          }
          throw err;
        }

        const payload = fullMessage.data.payload;
        const headers = payload?.headers || [];
        const labelIds = fullMessage.data.labelIds || [];

        const subject = extractHeader(headers, "Subject");
        const from = extractHeader(headers, "From");
        const to = extractEmailAddresses(headers, "To");
        const threadId = fullMessage.data.threadId || null;
        const bodyText = extractPlainTextFromPayload(payload);

        const fromLower = from.toLowerCase();
        const mailboxLower = String(emailAddress).toLowerCase();

        const isSentLabel = labelIds.includes("SENT");
        const isFromMailbox = fromLower.includes(mailboxLower);
        const isOutbound = isSentLabel || isFromMailbox;
        const isInbound = !isOutbound;

        const { data: existingThreadContext, error: threadLookupError } = await supabase
          .from("gmail_thread_context")
          .select("*")
          .eq("thread_id", threadId)
          .maybeSingle();

        if (threadLookupError) {
          console.error("thread context lookup error", threadLookupError);
          continue;
        }

        // OUTBOUND EMAILS
        if (isOutbound) {
          console.log("✉️ Processing outbound email:", {
            messageId: msg.id,
            subject,
            threadId,
            labelIds,
          });

          // Existing thread => follow-up
          if (existingThreadContext) {
            const clientVisibleMessage = buildClientMessage(
              "outbound_follow_up",
              existingThreadContext.activity_type_key,
              subject
            );

            const { error: followUpInsertError } = await supabase
              .from("crm_activities")
              .insert({
                rep_id: existingThreadContext.rep_id,
                retailer_id: existingThreadContext.retailer_id,
                brand_id: existingThreadContext.brand_id,
                activity_type_key: existingThreadContext.activity_type_key,
                source: "email",
                direction: "outbound",
                activity_kind: "outbound_follow_up",
                visibility: "client_visible",
                approval_status: "not_needed",
                thread_id: threadId,
                email_subject: subject,
                email_body_raw: bodyText,
                summary: "Rep followed up by email.",
                client_visible_message: clientVisibleMessage,
                sent_at: new Date().toISOString(),
                gmail_message_id: msg.id,
                gmail_thread_id: threadId,
                sender_email: from,
                recipient_emails: to,
                raw_payload: fullMessage.data,
              });

            if (followUpInsertError) {
              console.error("follow-up insert error", followUpInsertError);
              continue;
            }

            console.log("✅ Logged outbound follow-up for thread:", threadId);
            continue;
          }

          // No thread context yet => find pending context and make this the initial send
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

          const { data: pendingContext, error: pendingError } = await supabase
            .from("gmail_pending_context")
            .select("*")
            .eq("gmail_email", emailAddress)
            .is("used_at", null)
            .gte("created_at", fiveMinutesAgo)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (pendingError) {
            console.error("pending context lookup error", pendingError);
            continue;
          }

          if (!pendingContext) {
            console.log("No unused pending context found for:", emailAddress);
            continue;
          }

          console.log("🧩 Matched pending context:", pendingContext);

          const { error: threadInsertError } = await supabase
            .from("gmail_thread_context")
            .insert({
              thread_id: threadId,
              initial_message_id: msg.id,
              rep_id: pendingContext.rep_id,
              gmail_email: emailAddress,
              retailer_id: pendingContext.retailer_id,
              brand_id: pendingContext.brand_id,
              activity_type_key: pendingContext.activity_type_key,
              status: "active",
              updated_at: new Date().toISOString(),
            });

          if (threadInsertError) {
            console.error("thread context insert error", threadInsertError);
            continue;
          }

          const clientVisibleMessage = buildClientMessage(
            "outbound_initial",
            pendingContext.activity_type_key,
            subject
          );

          const { error: activityInsertError } = await supabase
            .from("crm_activities")
            .insert({
              rep_id: pendingContext.rep_id,
              retailer_id: pendingContext.retailer_id,
              brand_id: pendingContext.brand_id,
              activity_type_key: pendingContext.activity_type_key,
              source: "email",
              direction: "outbound",
              activity_kind: "outbound_initial",
              visibility: "client_visible",
              approval_status: "not_needed",
              thread_id: threadId,
              email_subject: subject,
              email_body_raw: bodyText,
              summary: "Rep sent initial email.",
              client_visible_message: clientVisibleMessage,
              sent_at: new Date().toISOString(),
              gmail_message_id: msg.id,
              gmail_thread_id: threadId,
              sender_email: from,
              recipient_emails: to,
              raw_payload: fullMessage.data,
            });

          if (activityInsertError) {
            console.error("initial activity insert error", activityInsertError);
            continue;
          }

          const { error: pendingUpdateError } = await supabase
            .from("gmail_pending_context")
            .update({
              used_at: new Date().toISOString(),
            })
            .eq("id", pendingContext.id);

          if (pendingUpdateError) {
            console.error("pending context update error", pendingUpdateError);
          }

          console.log("✅ Logged outbound initial email for thread:", threadId);
          continue;
        }

        // INBOUND EMAILS
        if (isInbound) {
          if (!existingThreadContext) {
            console.log("⏭️ Skipping inbound message with no known thread context:", {
              messageId: msg.id,
              subject,
              threadId,
              from,
            });
            continue;
          }

          console.log("📥 Processing inbound retailer reply:", {
            messageId: msg.id,
            subject,
            threadId,
            from,
          });

          const ai = simpleAiDraftSummary(bodyText, subject);
          const clientVisibleMessage = buildClientMessage(
            "retailer_reply",
            existingThreadContext.activity_type_key,
            subject
          );

          const { data: insertedActivity, error: inboundInsertError } = await supabase
            .from("crm_activities")
            .insert({
              rep_id: existingThreadContext.rep_id,
              retailer_id: existingThreadContext.retailer_id,
              brand_id: existingThreadContext.brand_id,
              activity_type_key: existingThreadContext.activity_type_key,
              source: "email",
              direction: "inbound",
              activity_kind: "retailer_reply",
              visibility: "internal",
              approval_status: ai.approvalStatus,
              thread_id: threadId,
              email_subject: subject,
              email_body_raw: bodyText,
              summary: ai.aiSummary,
              ai_summary: ai.aiSummary,
              client_draft_summary: ai.clientDraftSummary,
              client_visible_message: clientVisibleMessage,
              sent_at: new Date().toISOString(),
              gmail_message_id: msg.id,
              gmail_thread_id: threadId,
              sender_email: from,
              recipient_emails: to,
              raw_payload: fullMessage.data,
            })
            .select("id")
            .single();

          if (inboundInsertError) {
            console.error("inbound activity insert error", inboundInsertError);
            continue;
          }

          const { error: reviewInsertError } = await supabase
            .from("crm_activity_review_queue")
            .insert({
              crm_activity_id: insertedActivity.id,
              rep_id: existingThreadContext.rep_id,
              status: "pending",
            });

          if (reviewInsertError) {
            console.error("review queue insert error", reviewInsertError);
          }

          console.log("✅ Logged inbound retailer reply for thread:", threadId);
        }
      }
    }

    const { error: updateWatchError } = await supabase
      .from("gmail_mailbox_watches")
      .update({
        gmail_history_id: String(historyId),
        updated_at: new Date().toISOString(),
      })
      .eq("gmail_email", emailAddress);

    if (updateWatchError) {
      console.error("watch update error", updateWatchError);
    }

    return new Response("OK", { status: 200 });
  } catch (err: any) {
    console.error("❌ webhook error", err);
    return new Response("Error", { status: 500 });
  }
}