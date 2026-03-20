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

        if (!labelIds.includes("SENT")) {
          console.log("⏭️ Skipping non-SENT message:", msg.id, labelIds);
          continue;
        }

        const subject = extractHeader(headers, "Subject");
        const from = extractHeader(headers, "From");
        const to = extractEmailAddresses(headers, "To");
        const threadId = fullMessage.data.threadId || null;
        const bodyText = extractPlainTextFromPayload(payload);

        console.log("✉️ Processing sent email:", {
          messageId: msg.id,
          subject,
          threadId,
        });

        const { data: pendingContext, error: pendingError } = await supabase
          .from("gmail_pending_context")
          .select("*")
          .eq("gmail_email", emailAddress)
          .is("used_at", null)
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

        const clientVisibleMessage =
          "Email activity logged for selected retailer and brand.";

        const { error: activityInsertError } = await supabase
          .from("crm_activities")
          .insert({
            rep_id: pendingContext.rep_id,
            retailer_id: pendingContext.retailer_id,
            brand_id: pendingContext.brand_id,
            activity_type_key: pendingContext.activity_type_key,
            source: "email",
            direction: "outbound",
            email_subject: subject,
            email_body_raw: bodyText,
            summary: subject,
            client_visible_message: clientVisibleMessage,
            sent_at: new Date().toISOString(),
            gmail_message_id: msg.id,
            gmail_thread_id: threadId,
            sender_email: from,
            recipient_emails: to,
          });

        if (activityInsertError) {
          console.error("activity insert error", activityInsertError);
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

        console.log(
          "✅ CRM activity inserted using pending context:",
          pendingContext.id
        );
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