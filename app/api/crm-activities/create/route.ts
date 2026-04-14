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

    let repId: string | null = null;
    if (senderEmail) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", senderEmail.trim())
        .maybeSingle();
      if (profile) repId = profile.id;
    }

    if (!repId) {
      const { data: fallbackProfile } = await supabase
        .from("profiles")
        .select("id")
        .in("role", ["admin", "rep"])
        .limit(1)
        .maybeSingle();
      if (fallbackProfile) repId = fallbackProfile.id;
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
    }

    return Response.json({ activityIds });
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}
