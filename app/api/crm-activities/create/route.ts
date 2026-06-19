import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function buildClientMessage(activityTypeKey: string): string {
  switch (activityTypeKey) {
    case "intro":      return "Your Cultivate rep made an introduction to this retailer.";
    case "follow_up":  return "Your Cultivate rep followed up with this retailer.";
    case "submission": return "Your Cultivate rep submitted your brand to this retailer.";
    default:           return "Your Cultivate rep took action on this account.";
  }
}

export async function POST(req: Request) {
  try {
    const {
      retailerId,
      brandIds,
      activityTypeKey,
      summary,
      category: categoryFromClient,
      senderEmail,
      subject,
      gmailMessageId,
      gmailThreadId,
      source,
    } = await req.json();

    if (!retailerId || !Array.isArray(brandIds) || brandIds.length === 0 || !activityTypeKey) {
      return Response.json(
        { error: "Missing required fields: retailerId, brandIds, activityTypeKey" },
        { status: 400 }
      );
    }

    console.log("[create-activity] senderEmail received:", senderEmail);

    const SYSTEM_FALLBACK_REP_ID = "b47ace4b-fd4d-4d2f-96da-9794781bf0ef";

    let repId: string = SYSTEM_FALLBACK_REP_ID;
    let senderName: string = senderEmail || "Cultivate Team";

    if (senderEmail) {
      // Tier 1: exact case-insensitive email match
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, full_name")
        .ilike("email", senderEmail.trim())
        .maybeSingle();

      if (profile) {
        repId = profile.id;
        if (profile.full_name) senderName = profile.full_name;
      } else {
        // Tier 2: match on local part before @ (e.g. "george" from "george@cultivatecpg.com")
        const localPart = senderEmail.trim().split("@")[0];
        if (localPart) {
          const { data: localProfile } = await supabase
            .from("profiles")
            .select("id, full_name")
            .ilike("email", `${localPart}@%`)
            .maybeSingle();

          if (localProfile) {
            repId = localProfile.id;
            if (localProfile.full_name) senderName = localProfile.full_name;
          } else {
            // Tier 3: system fallback — rep_id is set but senderName stays as
            // the raw email so the actual sender is still auditable in the record.
            console.warn("[create-activity] no profile match for:", senderEmail, "— using system fallback rep_id");
          }
        }
      }
    }

    const activityIds: string[] = [];
    // Prefer the rep's typed summary so the retailer card shows what they
    // actually wrote, not a generic per-activity-type template. Falls back to
    // the generic message only when the summary field is blank/whitespace.
    const clientMessage = (summary ?? "").trim() || buildClientMessage(activityTypeKey);
    const sentAt = new Date().toISOString();

    for (const brandId of brandIds) {
      const { data, error } = await supabase
        .from("crm_activities")
        .insert({
          rep_id: repId,
          retailer_id: retailerId,
          brand_id: brandId,
          activity_type_key: activityTypeKey,
          summary: summary || "",
          sender_email: senderEmail || "",
          email_subject: subject || "",
          gmail_message_id: gmailMessageId || null,
          gmail_thread_id: gmailThreadId || null,
          source: source || "gmail_addon",
          client_visible_message: clientMessage,
          direction: "outbound",
          activity_kind: "manual_log",
          visibility: "client_visible",
          approval_status: "not_needed",
          sent_at: sentAt,
        })
        .select("id")
        .single();

      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }

      activityIds.push(data.id);

      // Immediately bind this Gmail thread to the brand/retailer so that
      // inbound replies are matched back without relying on the time-windowed
      // email_log_tokens webhook path. Non-fatal if this fails.
      if (gmailThreadId && senderEmail) {
        try {
          const { error: threadCtxError } = await supabase
            .from("gmail_thread_context")
            .upsert(
              {
                thread_id: gmailThreadId,
                initial_message_id: gmailMessageId || null,
                rep_id: repId,
                gmail_email: senderEmail.trim().toLowerCase(),
                retailer_id: retailerId,
                brand_id: brandId,
                activity_type_key: activityTypeKey,
                status: "active",
                updated_at: new Date().toISOString(),
              },
              { onConflict: "thread_id" }
            );
          if (threadCtxError) {
            console.error("[create-activity] gmail_thread_context upsert failed:", threadCtxError.message);
          }
        } catch (ctxErr: any) {
          console.error("[create-activity] gmail_thread_context unexpected error:", ctxErr.message);
        }
      }

      // If this is a submission activity, create a row in the submissions table
      // (skip silently if a row for this brand+retailer+category already exists).
      // Non-fatal if this fails.
      if (activityTypeKey === "submission") {
        try {
          // Prefer the category the rep picked in the Gmail add-on, but only
          // if it's actually granted to this brand via brand_category_access.
          // The add-on dropdown shows the union across every brand the rep
          // can see (Apps Script can't refresh the dropdown reactively when
          // brand checkboxes change), so a rep could pick a category that
          // belongs to a different brand than the one they ticked. Verify
          // against the brand's allowed set, falling back to the first
          // alphabetical entry (or "General") on miss or empty.
          const clientCategory =
            typeof categoryFromClient === "string" ? categoryFromClient.trim() : "";
          const { data: catRows } = await supabase
            .from("brand_category_access")
            .select("universal_category")
            .eq("brand_id", brandId)
            .order("universal_category");
          const allowed = ((catRows ?? []) as { universal_category: string | null }[])
            .map((r) => r.universal_category)
            .filter((c): c is string => !!c);
          let category: string;
          if (clientCategory && allowed.includes(clientCategory)) {
            category = clientCategory;
          } else {
            if (clientCategory && !allowed.includes(clientCategory)) {
              console.warn(
                `[create-activity] category "${clientCategory}" not in brand_category_access for brand ${brandId} — falling back`
              );
            }
            category = allowed[0] ?? "General";
          }

          // Plain insert (not upsert) — submissions has no unique constraint
          // on (brand_id, retailer_id, category), so an upsert with onConflict
          // was silently failing with Postgres 42P10 for every Gmail-addon
          // submission. Each submission is a unique event anyway; re-submissions
          // legitimately create a new dated row so the history is preserved.
          const { error: subError } = await supabase
            .from("submissions")
            .insert({
              brand_id: brandId,
              retailer_id: retailerId,
              category,
              submitted_at: sentAt.slice(0, 10), // date only (YYYY-MM-DD)
              notes: summary || null,
              created_by: repId,
            });

          if (subError) {
            console.error("[create-activity] submissions insert failed:", subError.message);
          }

          // Also stamp brand_retailer_timing.submitted_date — but only for the
          // single category row that this submission landed on. Previous
          // version updated every category row for the pair, which would
          // homogenize per-category submitted dates and erase legitimate
          // history for the other categories. Scoping by universal_category
          // keeps each category's submission timeline independent.
          const submittedDate = sentAt.slice(0, 10);
          const { error: brtError } = await supabase
            .from("brand_retailer_timing")
            .update({ submitted_date: submittedDate })
            .eq("brand_id", brandId)
            .eq("retailer_id", retailerId)
            .eq("universal_category", category);
          if (brtError) {
            console.error("[create-activity] brand_retailer_timing submitted_date update failed:", brtError.message);
          }

          // Auto-bump account_status to 'in_process' for the same category row,
          // but only if it isn't currently in a "freeze" state. active_maintain_
          // and_grow means the account is live and being grown — a new
          // submission shouldn't demote it back to in_process. retailer_declined
          // is a hard stop; logging a submission against a declined account
          // shouldn't silently re-open it. Any other status (awaiting_submission_
          // opportunity, working_to_secure_anchor_account, null, etc) gets bumped.
          const { error: statusError } = await supabase
            .from("brand_retailer_timing")
            .update({ account_status: "in_process" })
            .eq("brand_id", brandId)
            .eq("retailer_id", retailerId)
            .eq("universal_category", category)
            .not("account_status", "in", "(active_maintain_and_grow,retailer_declined)");
          if (statusError) {
            console.error("[create-activity] brand_retailer_timing account_status update failed:", statusError.message);
          }
        } catch (subErr: any) {
          console.error("[create-activity] submissions unexpected error:", subErr.message);
        }
      }

      // Mirror to brand_retailer_messages so the activity appears in the
      // retailer card inline Messages view. Non-fatal if this fails.
      try {
        const msgVisibility = "client_visible" === "client_visible" ? "client" : "internal";
        const { error: msgError } = await supabase
          .from("brand_retailer_messages")
          .insert({
            brand_id: brandId,
            retailer_id: retailerId,
            visibility: msgVisibility,
            sender_id: repId,
            sender_name: senderName,
            body: clientMessage,
            created_at: sentAt,
            source: "gmail_addon",
          });
        if (msgError) {
          console.error("[create-activity] brand_retailer_messages insert failed:", msgError.message);
        }
      } catch (msgErr: any) {
        console.error("[create-activity] brand_retailer_messages unexpected error:", msgErr.message);
      }
    }

    return Response.json({ activityIds });
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}
