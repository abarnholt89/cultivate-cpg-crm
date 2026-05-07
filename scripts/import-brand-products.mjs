/**
 * Import brand_products (SKU catalog) from the Cultivate master SKU spreadsheet.
 *
 * Usage:
 *   node scripts/import-brand-products.mjs              # dry run (default)
 *   node scripts/import-brand-products.mjs --insert     # actually insert
 *   node scripts/import-brand-products.mjs --file /path/to/file.xlsx
 *
 * Column layout (0-indexed, header is row index 1, data starts at row index 2):
 *   0  BRAND                    29  Unit Cost
 *   1  DESCRIPTION              30  Case Cost
 *   2  Item Rank                31  SRP
 *   3  KEHE item #              32  Delivery Method
 *   4  UNFI East item #         33  Shelf Life (production)
 *   5  UNFI West item #         34  Shelf Life (retailer)
 *   6  KeHE UPC - OLD           35  MOQ
 *   7  *RETAIL UNIT UPC         36  Cert - Non-GMO
 *   8  INNER PACK GTIN          37  Cert - Organic
 *   9  *CASE PACK GTIN          38  Cert - Gluten Free
 *  10  Single Bottle UPC        39  Cert - Kosher
 *  11  SIZE                     40  Cert Vegan
 *  12  UOM                      41  Other Cert
 *  13  UNIT PACK                42  Cost Change Effective Date
 *  14  INNER PACK               43  Old Cost
 *  15  MASTER CASE PACK
 *  16-18  Unit L/W/H
 *  19-21  Inner L/W/H
 *  22-24  Case L/W/H
 *  25  Case Cube
 *  26  MC Gross Weight
 *  27  TI
 *  28  HI
 *
 * Pricing notes:
 *   - Unit Cost cells may contain split text like "$3.25 UNFI/$3.15 KeHE".
 *     The script parses the first number as `cost`, and extracts both values
 *     into `unfi_cost` and `kehe_cost` when present.
 *   - Brands listed as "BrandName - KeHE" / "BrandName - UNFI" in the sheet
 *     are mapped to the same DB brand but tagged with distributor = 'kehe'/'unfi'.
 *     Their UPCs differ per distributor so there is no unique-key conflict.
 */

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
import { readFileSync as _rf } from "fs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

// ── Env ───────────────────────────────────────────────────────────────────────

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
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Add them to .env.local or export them.");
  process.exit(1);
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const INSERT = process.argv.includes("--insert");
const fileArgIdx = process.argv.indexOf("--file");
const fileArgPath = fileArgIdx !== -1 ? process.argv[fileArgIdx + 1] : null;

const DEFAULT_XLSX_PATHS = [
  "/mnt/user-data/uploads/Untitled_spreadsheet__2_.xlsx",
  "/Users/aaronbarnholt/Downloads/Untitled spreadsheet (2).xlsx",
  "/Users/aaronbarnholt/Downloads/cultivate master sku list.xlsx",
];

function resolveXlsxPath() {
  if (fileArgPath) return fileArgPath;
  for (const p of DEFAULT_XLSX_PATHS) {
    try { _rf(p); return p; } catch (_) {}
  }
  console.error("Could not find spreadsheet. Pass --file /path/to/file.xlsx");
  process.exit(1);
}

// ── Name map ──────────────────────────────────────────────────────────────────
// Maps spreadsheet brand name → DB brand name.
// Brands ending in "- KeHE" / "- UNFI" are also tagged with distributor below.

const NAME_MAP = {
  "2Bold_Perky Jerky":                "2Bold",
  "2Bold_Perky-Stetson":              "2Bold",
  "2Bold_Savage Jerky":               "2Bold",
  "Alice Mushrooms":                  "Alice - Alice Mushrooms",
  "Allergy Smart":                    "Allergy Smart - Green Gourmand Foods",
  "American Salmon":                  "American Tuna",
  "American Tuna - P&L":              "American Tuna",
  "Aplós":                            "Aplos",
  "Auntie Rana's":                    "Auntie Rana's",
  "B.T.R. NATION":                    "B.T.R. - Better Brownie Bites INC",
  "B.T.R. Nation":                    "B.T.R. - Better Brownie Bites INC",
  "Bearded Brothers":                 "Bearded Brothers - Bearded Brothers LLC",
  "Bim Bam Boo":                      "Bim Bam Boo - Zogo",
  "BUNKY":                            "Bunky Protein Popcorn",
  "CoAqua - KeHE":                    "CoAqua",
  "CoAqua - UNFI":                    "CoAqua",
  "CON-CRĒT®":                        "Vireo - Con-Crete/Sanz",
  "Cooler Co.":                       "Cooler Co",
  "Cravings By Chrissy Teigen":       "Cravings by Chrissy - Chrissy's Cravings",
  "Dean & Peeler":                    "Dean & Peeler - Dean & Peeler Meatworks LLC",
  "Desert Creek Honey":               "Desert Creek Honey - Treehive",
  "Desert Creek Honey -TreeHive":     "Desert Creek Honey - Treehive",
  "Dr Emil Nutrition":                "Dr. Emil - Brand Holdings",
  "Drench":                           "Drench - Drench LLC",
  "El Nacho":                         "El Nacho -Alpine Tortilla Company LLC",
  "Everyday Dose - KeHE":             "Everyday Dose",
  "Everyday Dose - UNFI":             "Everyday Dose",
  "Felicia - KeHE":                   "Felicia Pasta - Andriani Usa",
  "Felicia - UNFI":                   "Felicia Pasta - Andriani Usa",
  "Glowpop":                          null,  // inactive — skip
  "Good Foods Group":                 "Good Foods",
  "Good Girl Snacks":                 "Good Girl Snacks - Good Girl Snacks LLC",
  "Grounded Shakes":                  "Grounded Shakes - Raw Is More",
  "Hedgehog Foods":                   "Hedgehog - Hedgehog Foods LLC",
  "Homiah":                           "Homiah - Homiah Inc.",
  "Japan Gold - Muso From Japan":     "Japan Gold",
  "Japan Gold - Ohsawa":              "Japan Gold",
  "KEY":                              "Key Energy - Keyed Inc",
  "Lifestacks Magic Bar":             "Lifestacks Magic Bar",
  "Lifestacks -Magic Bar":            "Lifestacks Magic Bar",
  "Naked & Saucy":                    "Naked & Saucy - Naked and Saucy Inc.",
  "naturSource - KeHE":               "Naturesource - Naturesource Inc.",
  "naturSource - UNFI":               "Naturesource - Naturesource Inc.",
  "Natty":                            "Natty - Superhuman Brand, INC",
  "Neuhaus":                          "Neuhaus Chocolates",
  "Neuhaus - UNFI":                   "Neuhaus Chocolates",
  "Nonna's":                          "Nonna's Olive Oil",
  "OKO Blends":                       "Oko Foods",
  "Organic Traditions":               "Organic Traditions- Health Matters - Sunset",
  "Papa Murphy's":                    "Papa Murphy's - MTY Group",
  "Preserve":                         "Preserve - Recycline INC",
  "PuraVida - Kids Life Disney":      "PuraVida",
  "Queen Street Gluten Free Inc":     "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "RIGWA LIFE":                       "Rigwa",
  "ripi":                             "Ripi - Ripi Foods",
  "Sanz":                             "Vireo - Con-Crete/Sanz",
  "Seven Teas & Lemonade KeHE":       "Seven Teas - Tea Horse Rd",
  "Seven Teas & Lemonade UNFI":       "Seven Teas - Tea Horse Rd",
  "Shire's":                          "Shires",
  "Spade":                            "Spade - Spade Life Inc",
  "Tacodeli":                         "Tacodeli - Tacodeli After 3 LLC",
  "Tantos":                           "Tantos - Eat Tantos - Sasto Snacks",
  "tretap - Prebiotic":               "TreTap",
  "tretap - SAP!":                    "TreTap",
  "Verve - KeHE":                     "Verve Coffee - Verve LLC",
  "Verve - UNFI":                     "Verve Coffee - Verve LLC",
  "Yough!":                           "Yough",
  "Zab's":                            "Zab's Hot Sauce - Asthmatic Uncles Club",
  "Zahav Foods, LLC":                 "Zahav",
  "aeras water":                      "Aeras",
};

// Sheet brand names that indicate a specific distributor
const DISTRIBUTOR_MAP = {
  "CoAqua - KeHE":                    "kehe",
  "CoAqua - UNFI":                    "unfi",
  "Everyday Dose - KeHE":             "kehe",
  "Everyday Dose - UNFI":             "unfi",
  "Felicia - KeHE":                   "kehe",
  "Felicia - UNFI":                   "unfi",
  "naturSource - KeHE":               "kehe",
  "naturSource - UNFI":               "unfi",
  "Neuhaus - UNFI":                   "unfi",
  "Seven Teas & Lemonade KeHE":       "kehe",
  "Seven Teas & Lemonade UNFI":       "unfi",
  "Verve - KeHE":                     "kehe",
  "Verve - UNFI":                     "unfi",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(s) {
  return String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shortName(s) {
  const idx = s.indexOf(" - ");
  return idx === -1 ? s.trim() : s.slice(0, idx).trim();
}

function bestMatch(sheetName, brands) {
  const norm = normalize(sheetName);
  const short = normalize(shortName(sheetName));

  let hit = brands.find((b) => normalize(b.name) === norm);
  if (hit) return { brand: hit, how: "exact" };

  hit = brands.find((b) => normalize(b.name) === short);
  if (hit) return { brand: hit, how: "short-name" };

  hit = brands.find((b) => normalize(b.name).startsWith(short) || short.startsWith(normalize(b.name)));
  if (hit) return { brand: hit, how: "prefix" };

  const brandsShort = brands.map((b) => ({ b, s: normalize(shortName(b.name)) }));
  hit = brandsShort.find(({ s }) => s === short)?.b;
  if (hit) return { brand: hit, how: "short-short" };

  const underscorePart = normalize(sheetName.split("_").slice(-1)[0] ?? "");
  if (underscorePart) {
    hit = brands.find((b) => normalize(b.name) === underscorePart);
    if (hit) return { brand: hit, how: "underscore-suffix" };
  }

  return null;
}

/**
 * Parse a UPC cell value to a clean string.
 * Excel stores UPCs as numbers (e.g. 852709002034), which must NOT be treated
 * as floats. We stringify, strip any trailing .0, and trim whitespace.
 */
function toUpc(val) {
  if (val === undefined || val === null || val === "") return null;
  const s = String(val).trim().replace(/\.0+$/, "");
  return s === "" ? null : s;
}

/**
 * Parse a price cell that may contain:
 *   - A plain number:          3.25
 *   - A dollar-prefixed value: $3.25
 *   - A split UNFI/KeHE value: "$3.25 UNFI/$3.15 KeHE"
 *   - N/A, TBD, empty, 0      → null
 *
 * Returns { cost, kehe_cost, unfi_cost } where cost is the first numeric found.
 * kehe_cost/unfi_cost are only set when the cell explicitly labels them.
 */
function parsePriceCell(val) {
  if (val === undefined || val === null || val === "") return { cost: null, kehe_cost: null, unfi_cost: null };
  const s = String(val).trim();
  if (/^(n\/a|tbd|none|-)$/i.test(s)) return { cost: null, kehe_cost: null, unfi_cost: null };

  // Extract all numeric values from the string
  const nums = [...s.matchAll(/\$?([\d]+\.[\d]+|[\d]+)/g)].map((m) => parseFloat(m[1]));
  const nonZeroNums = nums.filter((n) => n > 0);
  if (nonZeroNums.length === 0) return { cost: null, kehe_cost: null, unfi_cost: null };

  const cost = nonZeroNums[0];

  // Detect explicit UNFI/KeHE labels in the cell
  let kehe_cost = null;
  let unfi_cost = null;
  const upper = s.toUpperCase();
  if (upper.includes("KEHE") || upper.includes("UNFI")) {
    // Try patterns: "$X.XX UNFI/$Y.YY KeHE" or "$X.XX KeHE/$Y.YY UNFI"
    const keheMatch = s.match(/\$([\d.]+)\s*kehe/i) || s.match(/kehe[^$\d]*([\d.]+)/i);
    const unfiMatch = s.match(/\$([\d.]+)\s*unfi/i) || s.match(/unfi[^$\d]*([\d.]+)/i);
    if (keheMatch) kehe_cost = parseFloat(keheMatch[1]) || null;
    if (unfiMatch) unfi_cost = parseFloat(unfiMatch[1]) || null;
    // If only one label found, assign the two numbers accordingly
    if (!kehe_cost && !unfi_cost && nonZeroNums.length >= 2) {
      // Heuristic: first price is UNFI (higher), second is KeHE (lower) based on Allergy Smart pattern
      unfi_cost = nonZeroNums[0];
      kehe_cost = nonZeroNums[1];
    }
  }

  return { cost, kehe_cost, unfi_cost };
}

function toNum(val) {
  if (val === undefined || val === null || val === "") return null;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
  return isNaN(n) || n === 0 ? null : n;
}

function toStr(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  return s === "" ? null : s;
}

function toBool(val) {
  if (val === undefined || val === null || val === "") return null;
  const s = String(val).trim().toLowerCase();
  return ["y", "yes", "x", "✓", "1", "true"].includes(s) ? true : null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const XLSX_PATH = resolveXlsxPath();
console.log(`\nReading: ${XLSX_PATH}`);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Use { header: 1 } to get raw arrays — prevents Excel from converting UPC digits to floats
const wb = XLSX.readFile(XLSX_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

// Row 0: empty / group headers (unused)
// Row 1: column headers
// Row 2+: data
const dataRows = allRows.slice(2);

const { data: brands, error: brandsErr } = await supabase.from("brands").select("id, name");
if (brandsErr) { console.error("Failed to fetch brands:", brandsErr.message); process.exit(1); }

console.log(`Loaded ${dataRows.length} data rows, ${brands.length} brands from DB.\n`);

// ── Group rows by spreadsheet brand name ──────────────────────────────────────

const brandGroups = new Map(); // sheetBrandName → { result, distributor, rows[] }

for (const row of dataRows) {
  const sheetBrand = toStr(row[0]);
  // Skip rows with no brand or no description (null/empty only — don't trim the value itself)
  if (!sheetBrand || row[1] == null || String(row[1]).length === 0) continue;

  if (!brandGroups.has(sheetBrand)) {
    // Skip explicitly inactive brands
    if (NAME_MAP[sheetBrand] === null) {
      brandGroups.set(sheetBrand, { result: null, distributor: null, rows: [], skipped: true });
      continue;
    }

    let result = null;
    const mappedName = NAME_MAP[sheetBrand];
    if (mappedName) {
      const hit = brands.find((b) => b.name === mappedName);
      if (hit) result = { brand: hit, how: "manual-map" };
    }
    if (!result) result = bestMatch(sheetBrand, brands);

    const distributor = DISTRIBUTOR_MAP[sheetBrand] ?? null;
    brandGroups.set(sheetBrand, { result, distributor, rows: [], skipped: false });
  }

  const group = brandGroups.get(sheetBrand);
  if (group.skipped) continue;

  const { cost, kehe_cost, unfi_cost } = parsePriceCell(row[29]);

  // Description is stored verbatim — no trimming, cleaning, or normalization
  const rawDescription = row[1] != null ? String(row[1]) : null;

  group.rows.push({
    description: rawDescription,
    item_rank:             toStr(row[2]),
    kehe_item:             toStr(row[3]),
    unfi_east_item:        toStr(row[4]),
    unfi_west_item:        toStr(row[5]),
    kehe_upc_old:          toUpc(row[6]),
    retail_upc:            toUpc(row[7]),
    inner_pack_gtin:       toUpc(row[8]),
    case_pack_gtin:        toUpc(row[9]),
    single_bottle_upc:     toUpc(row[10]),
    size:                  toStr(row[11]),
    uom:                   toStr(row[12]),
    unit_pack:             toStr(row[13]),
    inner_pack:            toStr(row[14]),
    master_case_pack:      toStr(row[15]),
    unit_length:           toNum(row[16]),
    unit_width:            toNum(row[17]),
    unit_height:           toNum(row[18]),
    inner_length:          toNum(row[19]),
    inner_width:           toNum(row[20]),
    inner_height:          toNum(row[21]),
    case_length:           toNum(row[22]),
    case_width:            toNum(row[23]),
    case_height:           toNum(row[24]),
    case_cube:             toNum(row[25]),
    mc_gross_weight:       toNum(row[26]),
    ti:                    toNum(row[27]),
    hi:                    toNum(row[28]),
    cost,
    kehe_cost,
    unfi_cost,
    case_cost:             toNum(row[30]),
    srp:                   toNum(row[31]),
    delivery_method:       toStr(row[32]),
    shelf_life_production: toNum(row[33]),
    shelf_life_retailer:   toNum(row[34]),
    moq:                   toStr(row[35]),
    cert_non_gmo:          toBool(row[36]),
    cert_organic:          toBool(row[37]),
    cert_gluten_free:      toBool(row[38]),
    cert_kosher:           toBool(row[39]),
    cert_vegan:            toBool(row[40]),
    cert_other:            toStr(row[41]),
    cost_change_date:      toStr(row[42]),
    old_cost:              toNum(row[43]),
  });
}

// ── Match report ──────────────────────────────────────────────────────────────

const matched   = [];
const unmatched = [];
const skipped   = [];

for (const [sheetBrand, group] of brandGroups.entries()) {
  if (group.skipped) { skipped.push(sheetBrand); continue; }
  if (group.result) {
    matched.push({ sheetBrand, brand: group.result.brand, how: group.result.how, distributor: group.distributor, rows: group.rows });
  } else {
    unmatched.push({ sheetBrand, count: group.rows.length });
  }
}

console.log("═".repeat(80));
console.log("BRAND MATCH REPORT");
console.log("═".repeat(80));
for (const m of matched) {
  const flag = m.how === "exact" || m.how === "manual-map" ? "  " : "~ ";
  const dist = m.distributor ? ` [${m.distributor}]` : "";
  console.log(`${flag}${m.sheetBrand.padEnd(42)} → "${m.brand.name}"${dist} — ${m.rows.length} SKUs`);
}

if (skipped.length) {
  console.log(`\nSkipped (inactive): ${skipped.join(", ")}`);
}

if (unmatched.length) {
  console.log(`\n✗ UNMATCHED (${unmatched.length}) — these will NOT be inserted:`);
  unmatched.forEach(({ sheetBrand, count }) => console.log(`  ✗ ${sheetBrand} (${count} SKUs)`));
}

const totalSkus    = matched.reduce((s, m) => s + m.rows.length, 0);
const unmatchedSkus = unmatched.reduce((s, u) => s + u.count, 0);

console.log("\n" + "═".repeat(80));
console.log(`Matched:   ${matched.length} sheet brands → rows ready to insert: ${totalSkus}`);
console.log(`Unmatched: ${unmatched.length} brands, ${unmatchedSkus} SKUs skipped`);
console.log(`Skipped:   ${skipped.length} inactive brands`);

// ── Dry-run samples ───────────────────────────────────────────────────────────

// UPC sample — first 5 UPCs from matched rows
const upcSample = matched.flatMap((m) => m.rows.map((r) => r.retail_upc).filter(Boolean)).slice(0, 5);
console.log(`\nUPC sample (first 5): ${upcSample.join(", ")}`);

// Pricing sample — first 5 rows with a parseable cost
const priceSample = matched
  .flatMap((m) => m.rows.map((r) => ({ brand: m.brand.name, desc: r.description, cost: r.cost, kehe_cost: r.kehe_cost, unfi_cost: r.unfi_cost, srp: r.srp })))
  .filter((r) => r.cost != null)
  .slice(0, 5);
console.log("\nPricing sample (first 5 rows with cost):");
for (const r of priceSample) {
  const parts = [`cost=$${r.cost}`];
  if (r.kehe_cost) parts.push(`kehe=$${r.kehe_cost}`);
  if (r.unfi_cost) parts.push(`unfi=$${r.unfi_cost}`);
  if (r.srp) parts.push(`srp=$${r.srp}`);
  console.log(`  [${r.brand}] ${r.desc.slice(0, 40).padEnd(40)} ${parts.join(" | ")}`);
}

// Null-cost count
const nullCostCount = matched.flatMap((m) => m.rows).filter((r) => r.cost == null).length;
console.log(`\nRows with no parseable cost: ${nullCostCount} / ${totalSkus}`);

console.log("═".repeat(80));

if (!INSERT) {
  console.log("\nDRY RUN complete. Re-run with --insert to write to the database.\n");
  process.exit(0);
}

// ── Insert ────────────────────────────────────────────────────────────────────

console.log("\nInserting…");
let inserted = 0;
let errors = 0;

// Deduplicate all rows globally by (brand_id, retail_upc, distributor) before
// inserting — last spreadsheet occurrence wins. This prevents duplicate-key
// errors when multiple sheet sections map to the same DB brand with overlapping UPCs.
const globalSeen = new Map(); // key → row (last writer wins)

for (const { brand, distributor, rows } of matched) {
  for (const r of rows) {
    if (!r.retail_upc) continue;
    const key = `${brand.id}||${r.retail_upc}||${distributor ?? ""}`;
    globalSeen.set(key, { brand, distributor, r });
  }
}

// Re-group deduplicated rows back by brand for batch insertion
const deduped = new Map(); // brand.id → { brand, distributor, rows[] }
for (const { brand, distributor, r } of globalSeen.values()) {
  const k = `${brand.id}||${distributor ?? ""}`;
  if (!deduped.has(k)) deduped.set(k, { brand, distributor, rows: [] });
  deduped.get(k).rows.push(r);
}

const totalDeduped = matched.reduce((s, m) => s + m.rows.filter(r => r.retail_upc).length, 0);
const totalAfterDedup = [...deduped.values()].reduce((s, g) => s + g.rows.length, 0);
if (totalDeduped !== totalAfterDedup) {
  console.log(`Deduplication removed ${totalDeduped - totalAfterDedup} duplicate UPC rows.`);
}

for (const { brand, distributor, rows } of deduped.values()) {
  const insertRows = rows.map((r) => ({
      brand_id:              brand.id,
      description:           r.description,
      item_rank:             r.item_rank,
      kehe_item:             r.kehe_item,
      unfi_east_item:        r.unfi_east_item,
      unfi_west_item:        r.unfi_west_item,
      kehe_upc_old:          r.kehe_upc_old,
      retail_upc:            r.retail_upc,
      inner_pack_gtin:       r.inner_pack_gtin,
      case_pack_gtin:        r.case_pack_gtin,
      single_bottle_upc:     r.single_bottle_upc,
      size:                  r.size,
      uom:                   r.uom,
      unit_pack:             r.unit_pack,
      inner_pack:            r.inner_pack,
      master_case_pack:      r.master_case_pack,
      unit_length:           r.unit_length,
      unit_width:            r.unit_width,
      unit_height:           r.unit_height,
      inner_length:          r.inner_length,
      inner_width:           r.inner_width,
      inner_height:          r.inner_height,
      case_length:           r.case_length,
      case_width:            r.case_width,
      case_height:           r.case_height,
      case_cube:             r.case_cube,
      mc_gross_weight:       r.mc_gross_weight,
      ti:                    r.ti,
      hi:                    r.hi,
      cost:                  r.cost,
      kehe_cost:             r.kehe_cost,
      unfi_cost:             r.unfi_cost,
      case_cost:             r.case_cost,
      srp:                   r.srp,
      delivery_method:       r.delivery_method,
      shelf_life_production: r.shelf_life_production,
      shelf_life_retailer:   r.shelf_life_retailer,
      moq:                   r.moq,
      cert_non_gmo:          r.cert_non_gmo,
      cert_organic:          r.cert_organic,
      cert_gluten_free:      r.cert_gluten_free,
      cert_kosher:           r.cert_kosher,
      cert_vegan:            r.cert_vegan,
      cert_other:            r.cert_other,
      cost_change_date:      r.cost_change_date,
      old_cost:              r.old_cost,
      distributor:           distributor,
      status:                "active",
    }));

  // Insert in batches of 200
  const BATCH = 200;
  for (let i = 0; i < insertRows.length; i += BATCH) {
    const batch = insertRows.slice(i, i + BATCH);
    const { error } = await supabase.from("brand_products").insert(batch);
    if (error) {
      console.error(`  ✗ ${brand.name} batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
      errors++;
    } else {
      inserted += batch.length;
    }
  }
  console.log(`  ✓ ${brand.name}${distributor ? ` [${distributor}]` : ""} — ${insertRows.length} SKUs`);
}

console.log(`\nDone. ${inserted} rows inserted, ${errors} batch errors, ${unmatched.length} brands skipped.\n`);
