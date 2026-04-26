/**
 * Import brand_products (SKU catalog) from the Cultivate master SKU spreadsheet.
 *
 * Usage:
 *   node scripts/import-brand-products.mjs              # dry run (default)
 *   node scripts/import-brand-products.mjs --insert     # actually upsert
 *   node scripts/import-brand-products.mjs --file /path/to/file.xlsx
 *
 * Column mapping (row 0 is the header row, data starts at row 1):
 *   __EMPTY    → BRAND
 *   __EMPTY_1  → DESCRIPTION
 *   __EMPTY_7  → RETAIL UNIT UPC
 *   __EMPTY_11 → SIZE
 *   __EMPTY_29 → Unit Cost
 *   __EMPTY_31 → SRP
 */

import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

// Read credentials from env — set SUPABASE_URL and SUPABASE_SERVICE_KEY before running,
// or they'll be pulled from .env.local automatically via the dotenv loader below.
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
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Add them to .env.local or export them.");
  process.exit(1);
}

const DEFAULT_XLSX_PATHS = [
  "/mnt/user-data/uploads/Untitled_spreadsheet__2_.xlsx",
  "/Users/aaronbarnholt/Downloads/Untitled spreadsheet (2).xlsx",
  "/Users/aaronbarnholt/Downloads/cultivate master sku list.xlsx",
];

// ── CLI args ──────────────────────────────────────────────────────────────────

const INSERT = process.argv.includes("--insert");
const fileArgIdx = process.argv.indexOf("--file");
const fileArgPath = fileArgIdx !== -1 ? process.argv[fileArgIdx + 1] : null;

function resolveXlsxPath() {
  if (fileArgPath) return fileArgPath;
  for (const p of DEFAULT_XLSX_PATHS) {
    try { _rf(p); return p; } catch (_) {}
  }
  console.error("Could not find spreadsheet. Pass --file /path/to/file.xlsx");
  process.exit(1);
}

// ── Manual name overrides ─────────────────────────────────────────────────────
// Maps exact spreadsheet brand names → exact DB brand names for cases where
// the fuzzy matcher can't find a match automatically.

const NAME_MAP = {
  "Alice Mushrooms": "Alice - Alice Mushrooms",
  "Aplós": "Aplos",
  "B.T.R. NATION": "B.T.R. - Better Brownie Bites INC",
  "Cravings By Chrissy Teigen": "Cravings by Chrissy - Chrissy's Cravings",
  "Dr Emil Nutrition": "Dr. Emil - Brand Holdings",
  "Hedgehog Foods": "Hedgehog - Hedgehog Foods LLC",
  "naturSource": "Naturesource - Naturesource Inc.",
  "OKO Blends": "Oko Foods",
  "Queen Street Gluten Free": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "Seven Teas & Lemonade": "Seven Teas - Tea Horse Rd",
  "B.T.R. Nation": "B.T.R. - Better Brownie Bites INC",
  "naturSource - KeHE": "Naturesource - Naturesource Inc.",
  "naturSource - UNFI": "Naturesource - Naturesource Inc.",
  "Queen Street Gluten Free Inc": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "Seven Teas & Lemonade KeHE": "Seven Teas - Tea Horse Rd",
  "Seven Teas & Lemonade UNFI": "Seven Teas - Tea Horse Rd",
  "American Salmon": "American Tuna",
  "CON-CRĒT®": "Vireo - Con-Crete/Sanz",
  "Sanz": "Vireo - Con-Crete/Sanz",
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

  // Exact full-name match
  let hit = brands.find((b) => normalize(b.name) === norm);
  if (hit) return { brand: hit, how: "exact" };

  // Match before the " - " separator
  hit = brands.find((b) => normalize(b.name) === short);
  if (hit) return { brand: hit, how: "short-name" };

  // Prefix match
  hit = brands.find((b) => normalize(b.name).startsWith(short) || short.startsWith(normalize(b.name)));
  if (hit) return { brand: hit, how: "prefix" };

  // Short-vs-short match
  const brandsShort = brands.map((b) => ({ b, s: normalize(shortName(b.name)) }));
  hit = brandsShort.find(({ s }) => s === short)?.b;
  if (hit) return { brand: hit, how: "short-short" };

  // Also try matching against brand name that contains "_" as separator (e.g. "2Bold_Perky Jerky")
  const underscorePart = normalize(sheetName.split("_").slice(-1)[0] ?? "");
  hit = brands.find((b) => normalize(b.name) === underscorePart);
  if (hit) return { brand: hit, how: "underscore-suffix" };

  return null;
}

function toNum(val) {
  if (val === undefined || val === null || val === "") return null;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function toStr(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  return s === "" ? null : s;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const XLSX_PATH = resolveXlsxPath();
console.log(`\nReading: ${XLSX_PATH}`);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const wb = XLSX.readFile(XLSX_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const allRows = XLSX.utils.sheet_to_json(ws);

// Row 0 is the header row (has __EMPTY → "BRAND" etc); data starts at row 1
const dataRows = allRows.slice(1);

const { data: brands, error: brandsErr } = await supabase.from("brands").select("id, name");
if (brandsErr) { console.error("Failed to fetch brands:", brandsErr.message); process.exit(1); }

console.log(`Loaded ${dataRows.length} data rows, ${brands.length} brands from DB.\n`);
console.log("═".repeat(72));
console.log("MATCH REPORT");
console.log("═".repeat(72));

// Group by brand name first so we report one header per brand
const brandGroups = new Map(); // sheetBrandName → { result, rows: [] }

for (const row of dataRows) {
  const sheetBrand = String(row["__EMPTY"] ?? "").trim();
  const description = String(row["__EMPTY_1"] ?? "").trim();

  // Skip rows with no brand or description
  if (!sheetBrand || !description) continue;

  if (!brandGroups.has(sheetBrand)) {
    let result = null;
    // Check manual override first
    const mappedName = NAME_MAP[sheetBrand];
    if (mappedName) {
      const hit = brands.find((b) => b.name === mappedName);
      if (hit) result = { brand: hit, how: "manual-map" };
    }
    if (!result) result = bestMatch(sheetBrand, brands);
    brandGroups.set(sheetBrand, { result, rows: [] });
  }

  brandGroups.get(sheetBrand).rows.push({
    description,
    retail_upc: toStr(row["__EMPTY_7"]),
    size: toStr(row["__EMPTY_11"]),
    cost: toNum(row["__EMPTY_29"]),
    srp: toNum(row["__EMPTY_31"]),
  });
}

const matched = [];   // { sheetBrand, brand, rows }
const unmatched = []; // sheetBrand strings

for (const [sheetBrand, { result, rows }] of brandGroups.entries()) {
  if (result) {
    matched.push({ sheetBrand, brand: result.brand, how: result.how, rows });
    const flag = result.how === "exact" ? "  " : "~ ";
    console.log(`${flag}${sheetBrand.padEnd(40)} → "${result.brand.name}" (${result.how}) — ${rows.length} SKUs`);
  } else {
    unmatched.push({ sheetBrand, count: rows.length });
  }
}

console.log("\n" + "═".repeat(72));
if (unmatched.length === 0) {
  console.log("✓ All brands matched.");
} else {
  console.log(`✗ UNMATCHED (${unmatched.length} brands) — these will NOT be inserted:`);
  unmatched.forEach(({ sheetBrand, count }) =>
    console.log(`  ✗ ${sheetBrand} (${count} SKUs)`)
  );
}

const totalSkus = matched.reduce((s, m) => s + m.rows.length, 0);
const unmatchedSkus = unmatched.reduce((s, u) => s + u.count, 0);
console.log(`\nMatched:   ${matched.length} brands, ${totalSkus} SKUs`);
console.log(`Unmatched: ${unmatched.length} brands, ${unmatchedSkus} SKUs`);
console.log("═".repeat(72));

if (!INSERT) {
  console.log("\nDRY RUN complete. Re-run with --insert to write to the database.\n");
  process.exit(0);
}

// ── Upsert ────────────────────────────────────────────────────────────────────

console.log("\nInserting…");
let inserted = 0;
let errors = 0;

for (const { brand, rows } of matched) {
  const upsertRows = rows.map((r) => ({
    brand_id: brand.id,
    description: r.description,
    retail_upc: r.retail_upc,
    size: r.size,
    cost: r.cost,
    srp: r.srp,
    status: "active",
  }));

  // Upsert in batches of 200 to avoid payload limits
  const BATCH = 200;
  for (let i = 0; i < upsertRows.length; i += BATCH) {
    const batch = upsertRows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("brand_products")
      .upsert(batch, { onConflict: "brand_id,retail_upc", ignoreDuplicates: false });

    if (error) {
      console.error(`  ✗ ${brand.name} batch ${i / BATCH + 1}: ${error.message}`);
      errors++;
    } else {
      inserted += batch.length;
    }
  }
  console.log(`  ✓ ${brand.name} — ${rows.length} SKUs`);
}

console.log(`\nDone. ${inserted} rows upserted, ${errors} batch errors, ${unmatched.length} brands skipped.\n`);
