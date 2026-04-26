import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { title, notes, due_date, assigned_to, created_by, brand_id, retailer_id } =
      await req.json();

    if (!title?.trim()) {
      return Response.json({ error: "title is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: title.trim(),
        notes: notes?.trim() || null,
        due_date: due_date || null,
        assigned_to: assigned_to || null,
        created_by: created_by || null,
        brand_id: brand_id || null,
        retailer_id: retailer_id || null,
        status: "open",
      })
      .select("id")
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ id: data.id });
  } catch (err: any) {
    return Response.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}
