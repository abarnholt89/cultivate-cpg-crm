/**
 * Import retailer assortment authorizations from Sheet 1 of the APL assortment spreadsheet.
 *
 * Usage:
 *   node scripts/import-retailer-assortment.mjs              # dry run (default)
 *   node scripts/import-retailer-assortment.mjs --insert     # upsert into authorized_products
 *   node scripts/import-retailer-assortment.mjs --file /path/to/file.xlsx
 *
 * Sheet 1 layout:
 *   Row 1 (index 0): junk row
 *   Row 2 (index 1): headers — Brand, Description, UPC, [retailer names...]
 *   Row 3+ (index 2+): data
 *   A non-empty cell in a retailer column = the brand's product is authorized at that retailer.
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

function shortName(s) {
  const idx = s.indexOf(" - ");
  return idx === -1 ? s.trim() : s.slice(0, idx).trim();
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

// ── Brand name overrides ──────────────────────────────────────────────────────

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
  "Bearded Bros": "Bearded Bros",
  "Bearded Bros - Yumster": "Bearded Bros",
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
  "NAKD": "Naked and Saucy",
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
  "SAPS": "Saps",
  "ALICE ": "Alice - Alice Mushrooms",
  "Aplós ": "Aplos",
  "American Tuna ": "American Tuna",
  "Yesly ": "YESLY",
  "Puravida": "PuraVida",
  "COAQUA": "CoAqua",
  "Purplesful": null,
  "Blue Durango": null,
};

// ── Main ──────────────────────────────────────────────────────────────────────

const XLSX_PATH = resolveXlsxPath();
console.log(`\nReading: ${XLSX_PATH}`);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const wb = XLSX.readFile(XLSX_PATH);
const ws = wb.Sheets["Retailer assortment"];
if (!ws) { console.error("Sheet 'Retailer assortment' not found"); process.exit(1); }

const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
const headerRow = allRows[1];    // row index 1 = row 2 in spreadsheet
const dataRows = allRows.slice(2);

const retailerHeaders = headerRow.slice(3); // columns 3+ are retailer names

// Fetch DB data
const { data: brands, error: brandsErr } = await supabase.from("brands").select("id,name");
if (brandsErr) { console.error("Failed to fetch brands:", brandsErr.message); process.exit(1); }

const { data: retailers, error: retailersErr } = await supabase.from("retailers").select("id,name,banner");
if (retailersErr) { console.error("Failed to fetch retailers:", retailersErr.message); process.exit(1); }

console.log(`Loaded ${dataRows.length} data rows, ${brands.length} brands, ${retailers.length} retailers from DB.\n`);

// ── Match retailer column headers → DB retailers ──────────────────────────────

console.log("═".repeat(72));
console.log("RETAILER COLUMN MATCHING");
console.log("═".repeat(72));

const retailerColMap = new Map(); // colIndex → { retailer } | null

const RETAILER_NAME_MAP = {
  "Aj's - Bashas": "AJ's Fine Foods",
  "Basha's": "Bashas",
  "Albertsons Boise HQ": "Albertsons",
  "Albetsons Jewel": "Jewel-Osco",
  "Albertsons- Mid Atlantic": "Albertsons",
  "Albertsons NorCal": "Albertsons",
  "Albs - Shaws": "Shaw's",
  "Albertsons Seattle": "Albertsons",
  "Albertsons Southern": "Albertsons",
  "Albertsons Portland": "Albertsons",
  "Albertsons Mountian West": "Albertsons",
  "Albertsons Southwest": "Albertsons",
  "ASG": "ASG",
  "Associated Food Stores (AFS)": "Associated Food Stores",
  "Giant Co : Martin & Carlisle": "Giant",
  "Giant Food Landover": "Giant Food",
  "NorthWest Grocers Corp": "NW Grocers",
  "Pavillions": "Pavilions",
  "Rosauers / Huckleberrys": "Rosauers",
  "Skogen": "Skogen's Festival Foods",
  "Town and Country": "Town and Country Markets",
  "Whole Foods": "Whole Foods Market",
};

for (let i = 0; i < retailerHeaders.length; i++) {
  const colName = String(retailerHeaders[i]).trim();
  if (!colName) { retailerColMap.set(i, null); continue; }

  // Try manual override first
  const mappedName = RETAILER_NAME_MAP[colName];
  if (mappedName) {
    const hit = retailers.find((r) => normalize(r.name) === normalize(mappedName) || normalize(r.banner ?? "") === normalize(mappedName));
    if (hit) { retailerColMap.set(i, hit); continue; }
  }

  // Fuzzy match by name then banner
  const byName = bestMatch(colName, retailers, (r) => r.name);
  if (byName) { retailerColMap.set(i, byName.item); continue; }

  const byBanner = bestMatch(colName, retailers, (r) => r.banner ?? "");
  if (byBanner) { retailerColMap.set(i, byBanner.item); continue; }

  retailerColMap.set(i, null);
}

const matchedRetailerCols = [...retailerColMap.entries()].filter(([, r]) => r !== null);
const unmatchedRetailerCols = [...retailerColMap.entries()].filter(([, r]) => r === null);

matchedRetailerCols.forEach(([i, r]) => console.log(`  ✓ "${retailerHeaders[i]}" → "${r.name}"`));
console.log(`\n✓ Matched: ${matchedRetailerCols.length} retailer columns`);
if (unmatchedRetailerCols.length > 0) {
  console.log(`✗ Unmatched: ${unmatchedRetailerCols.length} retailer columns (will be skipped):`);
  unmatchedRetailerCols.forEach(([i]) => console.log(`    ✗ "${retailerHeaders[i]}"`));
}

// ── Match brands + build upsert rows ─────────────────────────────────────────

console.log("\n" + "═".repeat(72));
console.log("BRAND MATCHING");
console.log("═".repeat(72));

const brandCache = new Map(); // sheetBrandName → brand | null

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

// Process all data rows
const toUpsert = [];       // { brand, retailer, upc, sku_description }
let totalAuthorizedCells = 0;
let skippedNoBrand = 0;
let skippedNoRetailer = 0;

const brandMatchReport = new Map(); // sheetBrand → { brand|null, skus: 0 }

for (const row of dataRows) {
  const sheetBrand = String(row[0] ?? "").trim();
  const description = String(row[1] ?? "").trim();
  const upc = String(row[2] ?? "").trim();

  if (!sheetBrand || !description || !upc) continue;

  const dbBrand = resolveDbBrand(sheetBrand);
  if (!brandMatchReport.has(sheetBrand)) {
    brandMatchReport.set(sheetBrand, { brand: dbBrand, skus: 0, authorizations: 0 });
  }
  brandMatchReport.get(sheetBrand).skus++;

  for (let i = 0; i < retailerHeaders.length; i++) {
    const cellVal = String(row[3 + i] ?? "").trim();
    if (!cellVal) continue;
    totalAuthorizedCells++;
    brandMatchReport.get(sheetBrand).authorizations++;

    const dbRetailer = retailerColMap.get(i);

    if (!dbBrand) { skippedNoBrand++; continue; }
    if (!dbRetailer) { skippedNoRetailer++; continue; }

    toUpsert.push({
      brand_id: dbBrand.id,
      client_name: dbBrand.name,
      brand_source: dbBrand.name,
      sku_description: description,
      upc: upc,
      retailer_id: dbRetailer.id,
      retailer_name: dbRetailer.name,
      raw_retailer_name: String(retailerHeaders[i]).trim(),
      authorized: true,
      authorization_source: "apl_assortment",
    });
  }
}

for (const [sheetBrand, { brand, skus, authorizations }] of brandMatchReport.entries()) {
  const flag = brand ? "  ✓" : "  ✗";
  const dbName = brand ? `"${brand.name}"` : "NO MATCH";
  console.log(`${flag} "${sheetBrand}" → ${dbName} (${skus} SKUs, ${authorizations} authorizations)`);
}

const matchedBrands = [...brandMatchReport.values()].filter((v) => v.brand).length;
const unmatchedBrands = [...brandMatchReport.values()].filter((v) => !v.brand).length;

console.log("\n" + "═".repeat(72));
console.log(`Total authorized cells in spreadsheet: ${totalAuthorizedCells}`);
console.log(`Rows to upsert (brand+retailer both matched): ${toUpsert.length}`);
console.log(`Skipped — no brand match: ${skippedNoBrand}`);
console.log(`Skipped — no retailer match: ${skippedNoRetailer}`);
console.log(`Brands matched: ${matchedBrands} / ${brandMatchReport.size}`);
console.log("═".repeat(72));

if (!INSERT) {
  console.log("\nDRY RUN complete. Re-run with --insert to write to the database.\n");
  process.exit(0);
}

// ── Upsert ────────────────────────────────────────────────────────────────────

console.log("\nInserting into authorized_products…");
let inserted = 0;
let errors = 0;
const BATCH = 200;

for (let i = 0; i < toUpsert.length; i += BATCH) {
  const batch = toUpsert.slice(i, i + BATCH);
  const { error } = await supabase
    .from("authorized_products")
    .insert(batch, { ignoreDuplicates: true });

  if (error) {
    console.error(`  ✗ Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
    errors++;
  } else {
    inserted += batch.length;
    process.stdout.write(`  ✓ ${inserted}/${toUpsert.length} rows\r`);
  }
}

console.log(`\nDone. ${inserted} rows upserted, ${errors} batch errors.\n`);
