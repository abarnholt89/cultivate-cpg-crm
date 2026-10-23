import type { SupabaseClient } from "@supabase/supabase-js";

export type BrandStatusFields = {
  archived: boolean | null;
  brand_status: string | null;
};

// Unified inactive definition used across the app (roster, contacts): archived=true OR brand_status='Inactive'.
export function isInactiveBrand(b: BrandStatusFields | null | undefined): boolean {
  if (!b) return false;
  return !!b.archived || b.brand_status === "Inactive";
}

// Ids of all brands currently considered inactive. Fetches the full brands table and filters
// in JS (rather than a `.neq("brand_status","Inactive")` query filter) because a bare `neq`
// silently drops rows where brand_status is null in Postgres's three-valued NULL logic.
export async function fetchInactiveBrandIds(client: SupabaseClient): Promise<Set<string>> {
  const { data } = await client.from("brands").select("id,archived,brand_status");
  const ids = ((data ?? []) as ({ id: string } & BrandStatusFields)[])
    .filter(isInactiveBrand)
    .map((b) => b.id);
  return new Set(ids);
}

// PostgREST "not in (...)" filter value for excluding inactive brand ids at the query level
// (e.g. to preserve an exact `count: "exact", head: true` query). Returns null when there's
// nothing to exclude, since `.not(col, "in", "()")` is invalid PostgREST syntax on an empty set.
export function notInBrandIdsFilter(ids: Set<string>): string | null {
  if (ids.size === 0) return null;
  return `(${[...ids].join(",")})`;
}
