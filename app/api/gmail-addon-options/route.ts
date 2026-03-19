import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data: retailers, error: retailersError } = await supabase
    .from("retailers")
    .select("id, name")
    .order("name", { ascending: true });

  const { data: brands, error: brandsError } = await supabase
    .from("brands")
    .select("id, name")
    .order("name", { ascending: true });

  const { data: activityTypes, error: activityTypesError } = await supabase
    .from("activity_types")
    .select("key, label, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (retailersError || brandsError || activityTypesError) {
    return NextResponse.json(
      {
        error:
          retailersError?.message ||
          brandsError?.message ||
          activityTypesError?.message ||
          "Failed to load options",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    retailers,
    brands,
    activityTypes,
  });
}