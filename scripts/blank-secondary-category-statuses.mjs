/**
 * For brands with multiple categories in brand_retailer_timing,
 * blank out account_status on all non-primary category rows.
 *
 * Primary category is determined by the CATEGORY_MAP below
 * (first element for multi-category brands, or the single string value).
 *
 * Step 1 – dry run (default):
 *   node scripts/blank-secondary-category-statuses.mjs
 *
 * Step 2 – apply:
 *   node scripts/blank-secondary-category-statuses.mjs --apply
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

const APPLY = process.argv.includes("--apply");

// Primary category per brand (same as expand-brand-retailer-categories.mjs)
// Value = string (single) or string[] (multi; first = primary)
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

function normalize(s) {
  return String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shortName(s) {
  const idx = String(s).indexOf(" - ");
  return idx === -1 ? String(s).trim() : String(s).slice(0, idx).trim();
}

function primaryCategory(val) {
  return Array.isArray(val) ? val[0] : val;
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const { data: brands, error: brandsErr } = await supabase.from("brands").select("id,name");
if (brandsErr) { console.error("brands:", brandsErr.message); process.exit(1); }

// Build brand name → primary category map
const brandPrimaryMap = new Map(); // brandId → primaryCategory
for (const [mapName, catVal] of Object.entries(CATEGORY_MAP)) {
  const norm = normalize(mapName);
  const short = normalize(shortName(mapName));
  const matched = brands.find((b) => {
    const bn = normalize(b.name);
    const bs = normalize(shortName(b.name));
    return bn === norm || bs === short || bn.startsWith(short) || short.startsWith(bn);
  });
  if (!matched) {
    console.warn(`  MISS: "${mapName}"`);
    continue;
  }
  brandPrimaryMap.set(matched.id, primaryCategory(catVal));
}

console.log(`\nMatched ${brandPrimaryMap.size} brands.\n`);

// Fetch all brand_retailer_timing rows
let allTiming = [];
let from = 0;
while (true) {
  const { data, error } = await supabase
    .from("brand_retailer_timing")
    .select("id,brand_id,universal_category,account_status")
    .range(from, from + 999);
  if (error) { console.error("timing fetch:", error.message); process.exit(1); }
  if (!data?.length) break;
  allTiming.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

console.log(`Loaded ${allTiming.length} timing rows.\n`);

// Find non-primary rows that have a non-blank account_status
const toBlank = [];
for (const row of allTiming) {
  const primary = brandPrimaryMap.get(row.brand_id);
  if (!primary) continue; // brand not in our map
  if (!row.universal_category) continue; // null category = primary row, skip
  if (row.universal_category === primary) continue; // is primary category, skip
  // It's a secondary category row
  if (row.account_status && row.account_status !== "") {
    toBlank.push(row.id);
  }
}

console.log(`\nRows to blank (non-primary category, non-empty status): ${toBlank.length}`);

if (!APPLY) {
  console.log("\n[DRY RUN] Pass --apply to apply these changes.\n");
  process.exit(0);
}

// Apply updates
const BATCH = 500;
let updated = 0;
for (let i = 0; i < toBlank.length; i += BATCH) {
  const batch = toBlank.slice(i, i + BATCH);
  const { error } = await supabase
    .from("brand_retailer_timing")
    .update({ account_status: null })
    .in("id", batch);
  if (error) { console.error("  Update error:", error.message); }
  else { updated += batch.length; }
  process.stdout.write(`\r  Updated ${updated} / ${toBlank.length}…`);
}

console.log(`\n\nAll done. ${updated} rows blanked.\n`);
