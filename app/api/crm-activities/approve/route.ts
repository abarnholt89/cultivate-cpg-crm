import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { activityId, editedSummary } = await req.json();

    if (!activityId) {
      return Response.json({ error: "Missing activityId" }, { status: 400 });
    }

    // Get the activity first
    const { data: activity, error: fetchError } = await supabase
      .from("crm_activities")
      .select("*")
      .eq("id", activityId)
      .single();

    if (fetchError || !activity) {
      return Response.json({ error: "Activity not found" }, { status: 404 });
    }

    // Use edited version OR AI draft
    const finalSummary =
      editedSummary || activity.client_draft_summary || activity.summary;

    const { error: updateError } = await supabase
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

    return Response.json({ ok: true });
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}