import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data: retailers, error: retailersError } = await supabase
    .from("retailers")
    .select("id, banner")
    .order("banner", { ascending: true });

  const { data: brands, error: brandsError } = await supabase
    .from("brands")
    .select("id, name")
    .order("name", { ascending: true });

  const { data: activityTypes, error: activityTypesError } = await supabase
    .from("activity_types")
    .select("key, label, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  // Pull brand_category_access for every brand so the Gmail add-on can show
  // a category picker for Submission activities. Returned as a map keyed by
  // brand_id so the client can scope or union as it sees fit.
  const { data: categoryAccess, error: categoryAccessError } = await supabase
    .from("brand_category_access")
    .select("brand_id, universal_category");

  if (retailersError || brandsError || activityTypesError || categoryAccessError) {
    return NextResponse.json(
      {
        error:
          retailersError?.message ||
          brandsError?.message ||
          activityTypesError?.message ||
          categoryAccessError?.message ||
          "Failed to load options",
      },
      { status: 500 }
    );
  }

  const allowedActivityTypeKeys = new Set(["intro", "follow_up", "submission"]);

  const categoriesByBrandId: Record<string, string[]> = {};
  ((categoryAccess ?? []) as { brand_id: string; universal_category: string | null }[])
    .forEach((row) => {
      if (!row.brand_id || !row.universal_category) return;
      if (!categoriesByBrandId[row.brand_id]) categoriesByBrandId[row.brand_id] = [];
      if (!categoriesByBrandId[row.brand_id].includes(row.universal_category)) {
        categoriesByBrandId[row.brand_id].push(row.universal_category);
      }
    });
  Object.keys(categoriesByBrandId).forEach((k) =>
    categoriesByBrandId[k].sort((a, b) => a.localeCompare(b))
  );

  return NextResponse.json({
    retailers: (retailers || []).map((r) => ({
      id: r.id,
      name: r.banner,
    })),
    brands,
    activityTypes: (activityTypes || []).filter((t) => allowedActivityTypeKeys.has(t.key)),
    categoriesByBrandId,
  });
}