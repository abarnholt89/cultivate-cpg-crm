import { createClient } from "@supabase/supabase-js";
import { createServerClientForApp } from "@/lib/supabase-server";

// Service-role client used for the actual writes — bypasses RLS on
// crm_activities, brand_retailer_messages, and crm_activity_review_queue.
// The session check below is what gates the request; service-role is just the
// write capability.
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    // ── Auth gate ────────────────────────────────────────────────────────
    // Anyone with the URL could previously flip any crm_activities row to
    // client_visible. Require a signed-in admin/rep before approving.
    const sb = await createServerClientForApp();
    const { data: { user }, error: userErr } = await sb.auth.getUser();
    if (userErr || !user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: profile } = await sb
      .from("profiles")
      .select("role, full_name")
      .eq("id", user.id)
      .maybeSingle();
    const role = (profile?.role ?? null) as string | null;
    if (role !== "admin" && role !== "rep") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const approverName: string = profile?.full_name || user.email || "Cultivate Rep";

    const { activityId, editedSummary } = await req.json();
    if (!activityId) {
      return Response.json({ error: "Missing activityId" }, { status: 400 });
    }

    const { data: activity, error: fetchError } = await admin
      .from("crm_activities")
      .select("*")
      .eq("id", activityId)
      .single();
    if (fetchError || !activity) {
      return Response.json({ error: "Activity not found" }, { status: 404 });
    }

    const finalSummary: string =
      (editedSummary && String(editedSummary).trim()) ||
      activity.client_draft_summary ||
      activity.summary ||
      "Retailer reply approved.";
    const approvedAt = new Date().toISOString();

    // ── 1. Mark the activity approved + client-visible ──────────────────
    const { error: updateError } = await admin
      .from("crm_activities")
      .update({
        visibility: "client_visible",
        approval_status: "approved",
        client_visible_message: finalSummary,
      })
      .eq("id", activityId);
    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    // ── 2. Mirror to brand_retailer_messages so the summary actually
    //       lands in the client-visible thread on the retailer card. The
    //       previous version stopped at step 1, so approval never propagated
    //       beyond the single-retailer detail page's own crm_activities query.
    //       Pattern mirrored from crm-activities/create/route.ts:179-198.
    if (activity.brand_id && activity.retailer_id) {
      const { error: msgError } = await admin
        .from("brand_retailer_messages")
        .insert({
          brand_id: activity.brand_id,
          retailer_id: activity.retailer_id,
          visibility: "client",
          sender_id: activity.rep_id ?? user.id,
          sender_name: approverName,
          body: finalSummary,
          created_at: approvedAt,
          source: "email_reply_approval",
        });
      if (msgError) {
        // Non-fatal — activity is already approved. Surface in response so
        // the client can show a soft warning if it wants.
        console.error("[approve] brand_retailer_messages insert failed:", msgError.message);
      }
    }

    // ── 3. Mark any pending review-queue row for this activity as
    //       approved so the queue doesn't accumulate stale entries.
    const { error: queueError } = await admin
      .from("crm_activity_review_queue")
      .update({ status: "approved" })
      .eq("crm_activity_id", activityId)
      .eq("status", "pending");
    if (queueError) {
      console.error("[approve] crm_activity_review_queue update failed:", queueError.message);
    }

    return Response.json({ ok: true });
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}
