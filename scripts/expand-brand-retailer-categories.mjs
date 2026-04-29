/**
 * Expand brand_retailer_timing with universal_category.
 *
 * Step 0 (manual): Run the printed ALTER TABLE SQL in Supabase to add the column.
 *
 * Step 1 – dry run (default):
 *   node scripts/expand-brand-retailer-categories.mjs
 *
 * Step 2 – write:
 *   node scripts/expand-brand-retailer-categories.mjs --insert
 *
 * For single-category brands: UPDATE existing rows → set universal_category.
 * For multi-category brands:  UPDATE existing rows → set primary category,
 *                             INSERT new rows for each additional category.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync as _rf } from "fs";

function loadDotEnv() {
  try {
    const env = _rf(".env.local", "utf8");
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch (_) {}
}
loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const INSERT = process.argv.includes("--insert");
const INSERTS_ONLY = process.argv.includes("--inserts-only");

// ── Step 0 ────────────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════════════════════════");
console.log("STEP 0 — Run this SQL in Supabase before using --insert:");
console.log("══════════════════════════════════════════════════════════════════════");
console.log(`
  ALTER TABLE public.brand_retailer_timing
    ADD COLUMN IF NOT EXISTS universal_category text;
`);

// ── Category map ──────────────────────────────────────────────────────────────
// Value is string (single category) or string[] (multi-category, first = primary).

const CATEGORY_MAP = {
  "Allergy Smart":          "Cookies",
  "Aonic":                  "Functional Beverages",
  "Auntie Rana's":          "Condiments & Sauces & Marinades",
  "B.T.R.":                 "Nutrition Bars",
  "Baked by Sticky":        "Pastries & Desserts",
  "Blue Mountain Pecans":   "Deli Cheese",
  "Bonfire Burritos":       "Frozen Breakfast",
  "Bunky Protein Popcorn":  "Popcorn & Puffs",
  "Cooler Co":              "RTD Coffee & Tea",
  "Cravings by Chrissy":    "Baking Mixes & Ingredients",
  "Dean & Peeler":          "Packaged Deli Meals",
  "Desert Creek Honey":     "Honey",
  "Dr. Emil":               "Functional Supplements",
  "Drench":                 "Salad Dressings & Toppers",
  "Fresh Victor":           "Refrigerated Beverages",
  "Good Foods":             "Fresh Dips & Dressings",
  "Grounded Shakes":        "Refrigerated Beverages",
  "Japan Gold":             "Asian",
  "Key Energy":             "Energy Drinks",
  "Lebby Snacks":           "Other Snacks",
  "Mauro Provisions":       "Pickles Olives & Peppers",
  "Organic Traditions":     "Functional Supplements",
  "peppertux":              "Nut Butters",
  "Puravida":               "Frozen Fruit & Vegetables",
  "Queen Street Bakery":    "Frozen Bread",
  "Ripi":                   "Frozen Meals & Entrees",
  "Shires":                 "Frozen Meals & Entrees",
  "Sobo Foods":             "Frozen Meals & Entrees",
  "Sunny Fine Foods":       "Deli Dressings & Sauces",
  "Tantos":                 "Salty Snacks",
  "TreTap":                 "Functional Beverages",
  "Yesly":                  "Functional Beverages",
  "Zab's Hot Sauce":        "Condiments & Sauces & Marinades",
};

// Normalise a category entry to [primary, ...extras]
function toCategories(val) {
  return Array.isArray(val) ? val : [val];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s) {
  return String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shortName(s) {
  const idx = String(s).indexOf(" - ");
  return idx === -1 ? String(s).trim() : String(s).slice(0, idx).trim();
}

function bestMatch(name, list, keyFn = (x) => x) {
  const norm = normalize(name);
  const short = normalize(shortName(name));

  let hit = list.find((x) => normalize(keyFn(x)) === norm);
  if (hit) return { item: hit, how: "exact" };

  hit = list.find((x) => normalize(keyFn(x)) === short);
  if (hit) return { item: hit, how: "short" };

  hit = list.find((x) => {
    const n = normalize(keyFn(x));
    return n.startsWith(short) || short.startsWith(n);
  });
  if (hit) return { item: hit, how: "prefix" };

  const shortList = list.map((x) => ({ x, s: normalize(shortName(keyFn(x))) }));
  hit = shortList.find(({ s }) => s === short)?.x;
  if (hit) return { item: hit, how: "short-short" };

  return null;
}

// ── Connect ───────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const { data: brands, error: brandsErr } = await supabase.from("brands").select("id,name");
if (brandsErr) { console.error("brands:", brandsErr.message); process.exit(1); }

// Fetch all brand_retailer_timing rows
let allTiming = [];
let from = 0;
while (true) {
  const { data, error } = await supabase
    .from("brand_retailer_timing")
    .select("id,brand_id,retailer_id,account_status,schedule_mode,universal_category")
    .range(from, from + 999);
  if (error) { console.error("timing fetch:", error.message); process.exit(1); }
  if (!data?.length) break;
  allTiming.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

console.log(`\nLoaded ${brands.length} brands, ${allTiming.length} brand_retailer_timing rows.\n`);

// ── Resolve map entries → brand IDs ──────────────────────────────────────────

console.log("══════════════════════════════════════════════════════════════════════");
console.log("BRAND → DB MATCH");
console.log("══════════════════════════════════════════════════════════════════════");

// brandId → categories[]
const brandCategories = new Map();
const misses = [];

for (const [mapName, catVal] of Object.entries(CATEGORY_MAP)) {
  const match = bestMatch(mapName, brands, (b) => b.name);
  if (!match) {
    console.log(`  ✗ MISS  "${mapName}"`);
    misses.push(mapName);
    continue;
  }
  const cats = toCategories(catVal);
  console.log(`  ✓ "${mapName}" → "${match.item.name}" [${match.how}]  →  ${cats.join(" | ")}`);
  brandCategories.set(match.item.id, { brandName: match.item.name, cats });
}

if (misses.length) {
  console.log(`\nUnmatched brand names (${misses.length}): ${misses.join(", ")}`);
}

// ── Load brand_category_access for all matched brands ─────────────────────────

const matchedBrandIds = [...brandCategories.keys()];
let categoryAccessRows = [];
if (matchedBrandIds.length > 0) {
  const { data: caData, error: caErr } = await supabase
    .from("brand_category_access")
    .select("brand_id,universal_category")
    .in("brand_id", matchedBrandIds);
  if (caErr) { console.error("brand_category_access fetch:", caErr.message); process.exit(1); }
  categoryAccessRows = caData ?? [];
}

// Build map: brandId → Set of all categories from brand_category_access
const categoryAccessByBrand = new Map();
for (const row of categoryAccessRows) {
  if (!categoryAccessByBrand.has(row.brand_id)) categoryAccessByBrand.set(row.brand_id, new Set());
  categoryAccessByBrand.get(row.brand_id).add(row.universal_category);
}

// Merge CATEGORY_MAP extras + brand_category_access extras into brandCategories
for (const [brandId, entry] of brandCategories) {
  const primary = entry.cats[0];
  const mapExtras = entry.cats.slice(1);
  const accessCats = categoryAccessByBrand.get(brandId) ?? new Set();
  // All extras: union of map extras + access extras, excluding primary
  const allExtras = [
    ...new Set([...mapExtras, ...[...accessCats].filter((c) => c !== primary)]),
  ];
  entry.cats = [primary, ...allExtras];
}

// ── Plan: updates + inserts ───────────────────────────────────────────────────

// Group timing rows by brand_id
const timingByBrand = new Map();
for (const row of allTiming) {
  if (!timingByBrand.has(row.brand_id)) timingByBrand.set(row.brand_id, []);
  timingByBrand.get(row.brand_id).push(row);
}

// Index existing timing rows by brand_id+retailer_id+universal_category to avoid duplicates
const existingCombos = new Set();
for (const row of allTiming) {
  if (row.universal_category) {
    existingCombos.add(`${row.brand_id}||${row.retailer_id}||${row.universal_category}`);
  }
}

const updates = []; // { id, universal_category }
const inserts = []; // full rows to insert

for (const [brandId, { brandName, cats }] of brandCategories) {
  const [primary, ...extras] = cats;
  const timingRows = timingByBrand.get(brandId) ?? [];

  if (timingRows.length === 0) {
    console.log(`  ⚠ No timing rows found for "${brandName}" (brand_id: ${brandId})`);
    continue;
  }

  // UPDATE all existing rows → primary category
  for (const row of timingRows) {
    updates.push({ id: row.id, universal_category: primary });
  }

  // INSERT new rows for each extra category, one per existing retailer_id (skip existing combos)
  for (const extraCat of extras) {
    // Deduplicate by retailer_id — one insert per retailer, not per timing row
    const seenRetailers = new Set();
    for (const row of timingRows) {
      if (seenRetailers.has(row.retailer_id)) continue;
      seenRetailers.add(row.retailer_id);
      const comboKey = `${brandId}||${row.retailer_id}||${extraCat}`;
      if (existingCombos.has(comboKey)) continue; // already exists
      inserts.push({
        brand_id: brandId,
        retailer_id: row.retailer_id,
        universal_category: extraCat,
        account_status: "unassigned",
        schedule_mode: row.schedule_mode ?? "scheduled",
      });
    }
  }
}

// ── Dry-run report ────────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════════════════════════════════");
console.log("DRY RUN SUMMARY");
console.log("══════════════════════════════════════════════════════════════════════");
console.log(`Brands matched in map:          ${brandCategories.size} / ${Object.keys(CATEGORY_MAP).length}`);
console.log(`Existing rows to UPDATE:        ${updates.length}`);
console.log(`New rows to INSERT (extra cats): ${inserts.length}`);

// Breakdown per brand
console.log("\nPer-brand breakdown:");
for (const [brandId, { brandName, cats }] of brandCategories) {
  const rows = timingByBrand.get(brandId) ?? [];
  const [primary, ...extras] = cats;
  const extraInserts = inserts.filter((r) => r.brand_id === brandId).length;
  console.log(`  "${brandName}": ${rows.length} rows → UPDATE to "${primary}"${extras.length ? ` + INSERT ${extraInserts} rows for [${extras.join(", ")}]` : ""}`);
}

// Check column exists
const colCheck = await supabase
  .from("brand_retailer_timing")
  .select("universal_category")
  .limit(1);
const colExists = !colCheck.error;
if (!colExists) {
  console.log("\n⚠ Column universal_category does not exist yet — run the ALTER TABLE SQL above first.");
}

if (!INSERT && !INSERTS_ONLY) {
  console.log("\n[DRY RUN] Pass --insert to apply these changes.\n");
  process.exit(0);
}

if (!colExists) {
  console.error("\nERROR: universal_category column missing. Run the ALTER TABLE SQL first, then re-run with --insert.");
  process.exit(1);
}

// ── Execute ───────────────────────────────────────────────────────────────────

const BATCH = 50;

if (!INSERTS_ONLY) {
  console.log(`\nUpdating ${updates.length} rows…`);
  let updatedCount = 0;
  let updateErrors = 0;

  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(({ id, universal_category }) =>
        supabase.from("brand_retailer_timing").update({ universal_category }).eq("id", id)
      )
    );
    for (const { error } of results) {
      if (error) { console.error("  Update error:", error.message); updateErrors++; }
      else updatedCount++;
    }
    process.stdout.write(`\r  Updated ${updatedCount} / ${updates.length}…`);
  }
  console.log(`\n  Done. Updated: ${updatedCount}, Errors: ${updateErrors}`);
} else {
  console.log("\n[Skipping UPDATEs — --inserts-only flag set]");
}

if (inserts.length > 0) {
  console.log(`\nInserting ${inserts.length} extra-category rows…`);
  let insertedCount = 0;
  let insertErrors = 0;
  for (let i = 0; i < inserts.length; i += BATCH) {
    const batch = inserts.slice(i, i + BATCH);
    const { error } = await supabase.from("brand_retailer_timing").insert(batch);
    if (error) { console.error("  Insert error:", error.message); insertErrors++; }
    else insertedCount += batch.length;
    process.stdout.write(`\r  Inserted ${insertedCount} / ${inserts.length}…`);
  }
  console.log(`\n  Done. Inserted: ${insertedCount}, Errors: ${insertErrors}`);
}

console.log("\nAll done.\n");
