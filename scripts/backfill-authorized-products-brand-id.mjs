/**
 * Backfill brand_id on authorized_products rows where brand_id IS NULL.
 *
 * Matches client_name → brands.name using the same NAME_MAP + fuzzy logic
 * as the retailer assortment importer.
 *
 * Usage:
 *   node scripts/backfill-authorized-products-brand-id.mjs          # dry run
 *   node scripts/backfill-authorized-products-brand-id.mjs --insert  # commit updates
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

// ── Brand name overrides (same as import-retailer-assortment.mjs) ─────────────

const BRAND_NAME_MAP = {
  "Alice": "Alice - Alice Mushrooms",
  "Alice Mushrooms": "Alice - Alice Mushrooms",
  "ALICE ": "Alice - Alice Mushrooms",
  "Aplós": "Aplos",
  "Allergy Smart": "Allergy Smart",
  "ALLERGY SMART": "Allergy Smart",
  "American Salmon": "American Tuna",
  "American Tuna - American Salmon": "American Tuna",
  "American Tuna - P&L": "American Tuna",
  "American Tuna ": "American Tuna",
  "B.T.R. Nation": "B.T.R. - Better Brownie Bites INC",
  "B.T.R. NATION": "B.T.R. - Better Brownie Bites INC",
  "B.T.R. Nation - Better Brownie Bites": "B.T.R. - Better Brownie Bites INC",
  "B T R NATION - Better Brownie Bites": "B.T.R. - Better Brownie Bites INC",
  "B.T.R.": "B.T.R. - Better Brownie Bites INC",
  "Bearded Bros": "Bearded Brothers - Bearded Brothers LLC",
  "Bearded Bros - Yumster": "Bearded Brothers - Bearded Brothers LLC",
  "BEARDED BROTHERS": "Bearded Brothers - Bearded Brothers LLC",
  "BEARDED BROTHERS - Yumster Yo! Bar": "Bearded Brothers - Bearded Brothers LLC",
  "CON-CRĒT®": "Vireo - Con-Crete/Sanz",
  "Cravings By Chrissy Teigen": "Cravings by Chrissy - Chrissy's Cravings",
  "CRAVINGS BY CHRISSYTEIGEN": "Cravings by Chrissy - Chrissy's Cravings",
  "CRAVINGS BY CHRISSY TEIGEN": "Cravings by Chrissy - Chrissy's Cravings",
  "Dr Emil Nutrition": "Dr. Emil - Brand Holdings",
  "Hedgehog Foods": "Hedgehog - Hedgehog Foods LLC",
  "HOMIAH INC.": "Homiah",
  "Japan Gold - Muso": "Japan Gold",
  "Japan Gold - Ohsawa": "Japan Gold",
  "Naked & Saucy": "Naked & Saucy - Naked and Saucy Inc.",
  "NAKED AND SAUCY": "Naked & Saucy - Naked and Saucy Inc.",
  "NaturSource": "Naturesource - Naturesource Inc.",
  "naturSource": "Naturesource - Naturesource Inc.",
  "NAKD": "Naked & Saucy - Naked and Saucy Inc.",
  "OKO Blends": "Oko Foods",
  "ORGANIC TRADITIONS": "Organic Traditions",
  "Organic Traditions": "Organic Traditions",
  "Queen St. Bakery": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "QUEEN STREET BAKERY": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "Queen Street Gluten Free": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "Seven Teas": "Seven Teas - Tea Horse Rd",
  "Seven Teas & Lemonade": "Seven Teas - Tea Horse Rd",
  "SEVEN ADE": "Seven Teas - Tea Horse Rd",
  "VERVE LLC": "Verve",
  "VERVE COFFEE ROASTERS": "Verve",
  "Verve": "Verve",
  "Zahav Foods, LLC": "Zahav Foods",
  "pH-D Feminine Health": "pH-D Feminine Health",
  "ph-D Feminine Health": "pH-D Feminine Health",
  "RIPI": "ripi",
  "ripi": "ripi",
  "SAPS": null,
  "Saps": null,
  "Clean Roots": null,
  "Little Inca": null,
  "Zee Test Brand": null,
  "Aplós ": "Aplos",
  "American Tuna ": "American Tuna",
  "Yesly ": "YESLY",
  "Puravida": "PuraVida",
  "COAQUA": "CoAqua",
  "Purplesful": null,
  "Blue Durango": null,
};

function resolveBrandName(clientName) {
  if (!clientName) return null;
  const trimmed = clientName.trim();
  if (Object.prototype.hasOwnProperty.call(BRAND_NAME_MAP, trimmed)) {
    return BRAND_NAME_MAP[trimmed]; // may be null (intentional skip)
  }
  return trimmed; // use as-is for fuzzy matching
}

// ── Main ──────────────────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("\nFetching brands…");
const { data: brands, error: brandsErr } = await supabase.from("brands").select("id,name");
if (brandsErr) { console.error("Failed to fetch brands:", brandsErr.message); process.exit(1); }

console.log(`Fetched ${brands.length} brands.\n`);

// Build brand lookup map: name → id
const brandByName = new Map(brands.map((b) => [b.name, b.id]));

// Fetch all authorized_products where brand_id IS NULL
console.log("Fetching authorized_products where brand_id IS NULL…");
let allRows = [];
const PAGE = 1000;
let from = 0;
while (true) {
  const { data, error } = await supabase
    .from("authorized_products")
    .select("id,client_name,upc,retailer_id")
    .is("brand_id", null)
    .range(from, from + PAGE - 1);
  if (error) { console.error("Fetch error:", error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  allRows.push(...data);
  if (data.length < PAGE) break;
  from += PAGE;
}

console.log(`Found ${allRows.length} rows with NULL brand_id.\n`);

if (allRows.length === 0) {
  console.log("Nothing to backfill. All rows already have brand_id set.");
  process.exit(0);
}

// Group by client_name so we only resolve each name once
const byClientName = new Map();
for (const row of allRows) {
  const key = row.client_name ?? "";
  if (!byClientName.has(key)) byClientName.set(key, []);
  byClientName.get(key).push(row);
}

console.log(`Unique client_name values: ${byClientName.size}\n`);

// Resolve each client_name → brand_id
const resolved = new Map(); // client_name → brand_id | null
const skipped = [];

for (const [clientName, rows] of byClientName) {
  const mappedName = resolveBrandName(clientName);

  // Explicit null in MAP = intentionally skip
  if (mappedName === null) {
    console.log(`  SKIP  "${clientName}" (explicitly excluded)`);
    skipped.push({ clientName, reason: "excluded in NAME_MAP" });
    resolved.set(clientName, null);
    continue;
  }

  // Try direct lookup by mapped name
  if (brandByName.has(mappedName)) {
    const brandId = brandByName.get(mappedName);
    console.log(`  EXACT "${clientName}" → "${mappedName}" (${brandId})`);
    resolved.set(clientName, brandId);
    continue;
  }

  // Fuzzy match against all brands
  const match = bestMatch(mappedName, brands, (b) => b.name);
  if (match) {
    console.log(`  FUZZY "${clientName}" → "${match.item.name}" [${match.how}] (${match.item.id})`);
    resolved.set(clientName, match.item.id);
    continue;
  }

  console.log(`  MISS  "${clientName}" — no brand match found`);
  skipped.push({ clientName, reason: "no match", count: rows.length });
  resolved.set(clientName, null);
}

// Build update batches
const updates = []; // { id, brand_id }
for (const row of allRows) {
  const brandId = resolved.get(row.client_name ?? "");
  if (brandId) updates.push({ id: row.id, brand_id: brandId });
}

console.log(`\n──────────────────────────────────────────`);
console.log(`Total rows:         ${allRows.length}`);
console.log(`Will update:        ${updates.length}`);
console.log(`Skipped (no match): ${allRows.length - updates.length}`);

if (skipped.length > 0) {
  console.log(`\nSkipped client_names:`);
  for (const s of skipped) {
    const cnt = byClientName.get(s.clientName)?.length ?? 0;
    console.log(`  "${s.clientName}" (${cnt} rows) — ${s.reason}`);
  }
}

if (!INSERT) {
  console.log(`\n[DRY RUN] Pass --insert to commit these updates.`);
  process.exit(0);
}

// Execute updates in batches using individual updates (no bulk update API without RLS bypass)
console.log(`\nUpdating ${updates.length} rows…`);
const BATCH = 50;
let done = 0;
let errors = 0;

for (let i = 0; i < updates.length; i += BATCH) {
  const batch = updates.slice(i, i + BATCH);
  // Run batch in parallel
  const results = await Promise.all(
    batch.map(({ id, brand_id }) =>
      supabase.from("authorized_products").update({ brand_id }).eq("id", id)
    )
  );
  for (const { error } of results) {
    if (error) { console.error("  Update error:", error.message); errors++; }
    else done++;
  }
  process.stdout.write(`\r  Updated ${done} / ${updates.length}…`);
}

console.log(`\n\nDone. Updated: ${done}, Errors: ${errors}`);
