/**
 * Import UNFI and KeHE item numbers + DC listings from the APL assortment spreadsheet.
 *
 * Usage:
 *   node scripts/import-distributor-dc.mjs              # dry run (default)
 *   node scripts/import-distributor-dc.mjs --insert     # write to DB
 *   node scripts/import-distributor-dc.mjs --file /path/to/file.xlsx
 *
 * Sheet 2 'UNFI ' layout (header at row index 3):
 *   Brand | Description | UPC | UNFI East # | UNFI West # | DC codes (ATL, AUR, …)
 *
 * Sheet 3 'KeHE' layout (header at row index 3):
 *   Brand | Description | UPC | KeHE Item Number | DC full names (Aurora AUR - 12, …)
 *
 * For each row:
 *   1. Match brand+UPC → brand_products.id
 *   2. Update brand_products.unfi_east_item / unfi_west_item / kehe_item
 *   3. Upsert distributor_dc_listings for each DC column with an 'X'
 */

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
import { readFileSync as _rf } from "fs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

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

const DEFAULT_PATHS = [
  "/mnt/user-data/uploads/apl_dc_assortment_list.xlsx",
  "/Users/aaronbarnholt/Downloads/apl dc assortment list.xlsx",
];

const INSERT = process.argv.includes("--insert");
const fileArgIdx = process.argv.indexOf("--file");
const fileArgPath = fileArgIdx !== -1 ? process.argv[fileArgIdx + 1] : null;

function resolveXlsxPath() {
  if (fileArgPath) return fileArgPath;
  for (const p of DEFAULT_PATHS) {
    try { _rf(p); return p; } catch (_) {}
  }
  console.error("Could not find spreadsheet. Pass --file /path/to/file.xlsx");
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s) {
  return String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toStr(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  return s === "" ? null : s;
}

function isAuthorized(val) {
  const s = String(val ?? "").trim().toLowerCase();
  return s !== "" && s !== "0" && s !== "false";
}

// Parse KeHE DC header like "Aurora AUR - 12" → { dc_code: "AUR", dc_name: "Aurora" }
// or "Bloomington, IN - BLO - 16" → { dc_code: "BLO", dc_name: "Bloomington, IN" }
function parseKeheDcHeader(header) {
  const m = header.match(/^(.+?)\s*-?\s*([A-Z]{3})\s*-\s*\d+\s*$/);
  if (m) return { dc_code: m[2].trim(), dc_name: m[1].trim().replace(/,\s*$/, "") };
  // Fallback — just use whole string as name
  return { dc_code: header.replace(/[^A-Z]/g, "").slice(0, 4), dc_name: header };
}

// ── Brand name overrides ──────────────────────────────────────────────────────

const BRAND_NAME_MAP = {
  "Alice": "Alice - Alice Mushrooms",
  "ALICE ": "Alice - Alice Mushrooms",
  "Aplós": "Aplos",
  "Aplós ": "Aplos",
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
  "Bearded Bros": "Bearded Bros",
  "BEARDED BROTHERS": "Bearded Bros",
  "BEARDED BROTHERS - Yumster Yo! Bar": "Bearded Bros",
  "CON-CRĒT®": "Vireo - Con-Crete/Sanz",
  "Cravings By Chrissy Teigen": "Cravings by Chrissy - Chrissy's Cravings",
  "CRAVINGS BY CHRISSYTEIGEN": "Cravings by Chrissy - Chrissy's Cravings",
  "CRAVINGS BY CHRISSY TEIGEN": "Cravings by Chrissy - Chrissy's Cravings",
  "Dr Emil Nutrition": "Dr. Emil - Brand Holdings",
  "Hedgehog Foods": "Hedgehog - Hedgehog Foods LLC",
  "HOMIAH INC.": "Homiah",
  "Japan Gold - Muso": "Japan Gold",
  "Japan Gold - Ohsawa": "Japan Gold",
  "Naked & Saucy": "Naked and Saucy",
  "NAKED AND SAUCY": "Naked and Saucy",
  "NaturSource": "Naturesource - Naturesource Inc.",
  "naturSource": "Naturesource - Naturesource Inc.",
  "OKO Blends": "Oko Foods",
  "ORGANIC TRADITIONS": "Organic Traditions",
  "Queen St. Bakery": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "QUEEN STREET BAKERY": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "Queen Street Gluten Free": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "Seven Teas": "Seven Teas - Tea Horse Rd",
  "Seven Teas & Lemonade": "Seven Teas - Tea Horse Rd",
  "SEVEN ADE": "Seven Teas - Tea Horse Rd",
  "VERVE LLC": "Verve",
  "VERVE COFFEE ROASTERS": "Verve",
  "Zahav Foods, LLC": "Zahav Foods",
  "pH-D Feminine Health": "pH-D Feminine Health",
  "ph-D Feminine Health": "pH-D Feminine Health",
  "RIPI": "ripi",
  "SAPS": "Saps",
  "Yesly ": "YESLY",
  "Puravida": "PuraVida",
  "COAQUA": "CoAqua",
  "Purplesful": null,
  "Blue Durango": null,
};

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

  // Short-vs-short match (handles "Name - Company LLC" → "Name")
  const listShort = list.map((x) => ({ x, s: normalize(shortName(keyFn(x))) }));
  hit = listShort.find(({ s }) => s === short)?.x;
  if (hit) return { item: hit, how: "short-short" };

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const XLSX_PATH = resolveXlsxPath();
console.log(`\nReading: ${XLSX_PATH}`);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Fetch ALL brand_products with pagination (Supabase default cap is 1000)
async function fetchAll(query) {
  const PAGE = 1000;
  let all = [], from = 0;
  while (true) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) { console.error("Fetch error:", error.message); process.exit(1); }
    all = all.concat(data ?? []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

const brandProducts = await fetchAll(
  supabase.from("brand_products").select("id,brand_id,retail_upc,description")
);

const { data: brands, error: brandsErr } = await supabase.from("brands").select("id,name");
if (brandsErr) { console.error("Failed to fetch brands:", brandsErr.message); process.exit(1); }

// Index brand_products by (brand_id, upc) for fast lookup
const bpByBrandUpc = new Map(); // "brandId|upc" → bp
for (const bp of brandProducts) {
  if (bp.retail_upc) bpByBrandUpc.set(`${bp.brand_id}|${bp.retail_upc}`, bp);
}

// Also index by upc alone as fallback
const bpByUpc = new Map(); // upc → bp (last one wins if duplicates)
for (const bp of brandProducts) {
  if (bp.retail_upc) bpByUpc.set(bp.retail_upc, bp);
}

console.log(`Loaded ${brandProducts.length} brand_products, ${brands.length} brands from DB.\n`);

const brandCache = new Map();
function resolveDbBrand(sheetBrand) {
  if (brandCache.has(sheetBrand)) return brandCache.get(sheetBrand);
  const override = BRAND_NAME_MAP[sheetBrand];
  if (override === null) { brandCache.set(sheetBrand, null); return null; }
  if (override) {
    const hit = brands.find((b) => b.name === override);
    if (hit) { brandCache.set(sheetBrand, hit); return hit; }
  }
  const result = bestMatch(sheetBrand, brands, (b) => b.name);
  const resolved = result ? result.item : null;
  brandCache.set(sheetBrand, resolved);
  return resolved;
}

function resolveBrandProduct(sheetBrand, upc) {
  const dbBrand = resolveDbBrand(sheetBrand);
  if (!dbBrand || !upc) return null;
  const upcStr = String(upc).trim();
  return bpByBrandUpc.get(`${dbBrand.id}|${upcStr}`) ?? bpByUpc.get(upcStr) ?? null;
}

// Returns { bp, created: bool } — creates a minimal brand_product row if not found
function resolveBrandProductOrStub(sheetBrand, upc, description) {
  const existing = resolveBrandProduct(sheetBrand, upc);
  if (existing) return { bp: existing, created: false };
  const dbBrand = resolveDbBrand(sheetBrand);
  if (!dbBrand || !upc) return null;
  const upcStr = String(upc).trim();
  // Return a stub — no DB id yet; will be created on insert
  return { bp: { id: null, brand_id: dbBrand.id, retail_upc: upcStr, description: String(description ?? "").trim() }, created: true };
}

const wb = XLSX.readFile(XLSX_PATH);

// ── Process UNFI sheet ────────────────────────────────────────────────────────

console.log("═".repeat(72));
console.log("SHEET 2: UNFI");
console.log("═".repeat(72));

const ws2 = wb.Sheets["UNFI "];
const arr2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: "" });
const headers2 = arr2[3]; // row index 3 = header row
const data2 = arr2.slice(4);

// UNFI DC columns start at index 5 (after Brand, Description, UPC, East, West)
const unfiDcHeaders = headers2.slice(5); // array of dc codes like "ATL", "AUR", ...

// Full DC names for UNFI codes (best-effort)
const UNFI_DC_NAMES = {
  ATL: "Atlanta, GA", AUR: "Aurora, CO", CHE: "Chesterfield, NH", CRL: "Carol Stream, IL",
  DAY: "Dayville, CT", GIL: "Gilroy, CA", GLY: "Glenview, IL", GRW: "Green Bay, WI",
  HOW: "Howard, WI", HVA: "Hudson Valley, NY", IOW: "Iowa City, IA", JLN: "Joplin, MO",
  LAN: "Lancaster, PA", LND: "Landover, MD", MAN: "Manchester, NH", MOR: "Moreno Valley, CA",
  PHI: "Pennsauken, NJ", RAC: "Racine, WI", RCH: "Richmond, VA", RID: "Ridgefield, WA",
  ROC: "Rochester, NY", SRQ: "Sarasota, FL", TWC: "Twin Cities, MN",
};

let unfiMatched = 0, unfiCreated = 0, unfiUnmatched = 0;
const unfiUpdates = []; // { id, unfi_east_item, unfi_west_item } for existing brand_products
const unfiNewBp = [];   // new brand_product rows to upsert first (stubs)
// DC rows collected after insert so we can attach real IDs; use placeholder map
const unfiDcPending = []; // { bpKey: "brandId|upc", dcCode, dcName }
const unfiUnmatchedBrands = new Set();

for (const row of data2) {
  const sheetBrand = String(row[0] ?? "").trim();
  const description = String(row[1] ?? "").trim();
  const upc = String(row[2] ?? "").trim();
  const eastItem = toStr(row[3]);
  const westItem = toStr(row[4]);

  if (!sheetBrand || !upc) continue;

  const resolved = resolveBrandProductOrStub(sheetBrand, upc, description);
  if (!resolved) {
    unfiUnmatched++;
    unfiUnmatchedBrands.add(sheetBrand);
    continue;
  }
  const { bp, created } = resolved;

  if (created) {
    unfiCreated++;
    unfiNewBp.push({ brand_id: bp.brand_id, description: bp.description || description, retail_upc: bp.retail_upc, status: "active", unfi_east_item: eastItem, unfi_west_item: westItem });
  } else {
    unfiMatched++;
    if (eastItem || westItem) {
      unfiUpdates.push({ id: bp.id, unfi_east_item: eastItem, unfi_west_item: westItem });
    }
  }

  for (let i = 0; i < unfiDcHeaders.length; i++) {
    const dcCode = String(unfiDcHeaders[i]).trim();
    if (!dcCode) continue;
    const cellVal = row[5 + i];
    if (isAuthorized(cellVal)) {
      if (!created && bp.id) {
        // existing bp — use id directly
        unfiDcPending.push({ id: bp.id, dcCode, dcName: UNFI_DC_NAMES[dcCode] ?? dcCode });
      } else {
        // new bp — key by brand_id|upc, resolve id after insert
        unfiDcPending.push({ bpKey: `${bp.brand_id}|${bp.retail_upc}`, dcCode, dcName: UNFI_DC_NAMES[dcCode] ?? dcCode });
      }
    }
  }
}

console.log(`Matched existing: ${unfiMatched} rows`);
console.log(`New brand_products to create: ${unfiCreated} rows`);
console.log(`Unmatched (no brand in DB): ${unfiUnmatched} rows`);
if (unfiUnmatchedBrands.size > 0) {
  console.log("Unmatched brands:");
  [...unfiUnmatchedBrands].sort().forEach((b) => console.log(`  ✗ "${b}"`));
}
console.log(`Item # updates: ${unfiUpdates.length}`);
console.log(`DC listing rows pending: ${unfiDcPending.length}`);

// ── Process KeHE sheet ────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(72));
console.log("SHEET 3: KeHE");
console.log("═".repeat(72));

const ws3 = wb.Sheets["KeHE"];
const arr3 = XLSX.utils.sheet_to_json(ws3, { header: 1, defval: "" });
const headers3 = arr3[3];
const data3 = arr3.slice(4);

// KeHE DC columns start at index 4 (after Brand, Description, UPC, KeHE Item Number)
const keheDcHeaders = headers3.slice(4).map((h) => {
  const parsed = parseKeheDcHeader(String(h).trim());
  return { raw: String(h).trim(), ...parsed };
});

let keheMatched = 0, keheCreated = 0, keheUnmatched = 0;
const keheUpdates = [];
const keheNewBp = [];
const keheDcPending = [];
const keheUnmatchedBrands = new Set();

for (const row of data3) {
  const sheetBrand = String(row[0] ?? "").trim();
  const description = String(row[1] ?? "").trim();
  const upc = String(row[2] ?? "").trim();
  const keheItem = toStr(row[3]);

  if (!sheetBrand || !upc) continue;

  const resolved = resolveBrandProductOrStub(sheetBrand, upc, description);
  if (!resolved) {
    keheUnmatched++;
    keheUnmatchedBrands.add(sheetBrand);
    continue;
  }
  const { bp, created } = resolved;

  if (created) {
    keheCreated++;
    keheNewBp.push({ brand_id: bp.brand_id, description: bp.description || description, retail_upc: bp.retail_upc, status: "active", kehe_item: keheItem });
  } else {
    keheMatched++;
    if (keheItem) keheUpdates.push({ id: bp.id, kehe_item: keheItem });
  }

  for (let i = 0; i < keheDcHeaders.length; i++) {
    const { dc_code, dc_name } = keheDcHeaders[i];
    if (!dc_code) continue;
    const cellVal = row[4 + i];
    if (isAuthorized(cellVal)) {
      if (!created && bp.id) {
        keheDcPending.push({ id: bp.id, dcCode: dc_code, dcName: dc_name });
      } else {
        keheDcPending.push({ bpKey: `${bp.brand_id}|${bp.retail_upc}`, dcCode: dc_code, dcName: dc_name });
      }
    }
  }
}

console.log(`Matched existing: ${keheMatched} rows`);
console.log(`New brand_products to create: ${keheCreated} rows`);
console.log(`Unmatched (no brand in DB): ${keheUnmatched} rows`);
if (keheUnmatchedBrands.size > 0) {
  console.log("Unmatched brands:");
  [...keheUnmatchedBrands].sort().forEach((b) => console.log(`  ✗ "${b}"`));
}
console.log(`Item # updates: ${keheUpdates.length}`);
console.log(`DC listing rows pending: ${keheDcPending.length}`);

console.log("\n" + "═".repeat(72));
console.log(`TOTAL: ${unfiUpdates.length + keheUpdates.length} item # updates, ${unfiDcPending.length + keheDcPending.length} DC listing rows`);
console.log(`New brand_products to create: ${unfiNewBp.length + keheNewBp.length}`);
console.log("═".repeat(72));

if (!INSERT) {
  console.log("\nDRY RUN complete. Re-run with --insert to write to the database.\n");
  process.exit(0);
}

// ── Insert ────────────────────────────────────────────────────────────────────

const BATCH = 200;

async function batchUpsert(table, rows, conflict, label) {
  let done = 0, errs = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: conflict, ignoreDuplicates: false });
    if (error) { console.error(`  ✗ ${label} batch ${Math.floor(i / BATCH) + 1}: ${error.message}`); errs++; }
    else { done += batch.length; }
  }
  console.log(`  ✓ ${label}: ${done} rows, ${errs} errors`);
}

async function batchUpdate(table, rows, label) {
  let done = 0, errs = 0;
  for (const row of rows) {
    const { id, ...fields } = row;
    // Only update fields that are non-null
    const updateFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));
    if (Object.keys(updateFields).length === 0) continue;
    const { error } = await supabase.from(table).update(updateFields).eq("id", id);
    if (error) { errs++; } else { done++; }
  }
  console.log(`  ✓ ${label}: ${done} rows updated, ${errs} errors`);
}

console.log("\nWriting to database…");

// Step 1: upsert new brand_product stubs (UNFI + KeHE combined, deduped by brand_id+upc)
const allNewBp = [...unfiNewBp, ...keheNewBp];
const newBpDeduped = [...new Map(allNewBp.map((r) => [`${r.brand_id}|${r.retail_upc}`, r])).values()];
let newBpInserted = [];
if (newBpDeduped.length > 0) {
  const { data: inserted, error } = await supabase
    .from("brand_products")
    .upsert(newBpDeduped, { onConflict: "brand_id,retail_upc", ignoreDuplicates: false })
    .select("id,brand_id,retail_upc");
  if (error) { console.error("  ✗ New brand_products upsert:", error.message); }
  else {
    newBpInserted = inserted ?? [];
    console.log(`  ✓ New brand_products: ${newBpInserted.length} rows created/updated`);
  }
}

// Build lookup for newly inserted bp ids
const newBpById = new Map(newBpInserted.map((r) => [`${r.brand_id}|${r.retail_upc}`, r.id]));

// Step 2: resolve DC pending rows to final brand_product_id
function resolveDcRows(pending, distributor) {
  return pending
    .map(({ id, bpKey, dcCode, dcName }) => {
      const resolvedId = id ?? newBpById.get(bpKey);
      if (!resolvedId) return null;
      return { brand_product_id: resolvedId, distributor, dc_code: dcCode, dc_name: dcName, listed: true };
    })
    .filter(Boolean);
}

const unfiDcRows = resolveDcRows(unfiDcPending, "UNFI");
const keheDcRows = resolveDcRows(keheDcPending, "KeHE");

// Step 3: update item numbers on existing brand_products
await batchUpdate("brand_products", unfiUpdates, "UNFI item # updates");
await batchUpdate("brand_products", keheUpdates, "KeHE item # updates");

// Step 4: upsert DC listings
await batchUpsert("distributor_dc_listings", unfiDcRows, "brand_product_id,distributor,dc_code", "UNFI DC listings");
await batchUpsert("distributor_dc_listings", keheDcRows, "brand_product_id,distributor,dc_code", "KeHE DC listings");

console.log("\nDone.\n");
