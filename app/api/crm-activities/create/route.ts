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
    const clientMessage = buildClientMessage(activityTypeKey);
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
