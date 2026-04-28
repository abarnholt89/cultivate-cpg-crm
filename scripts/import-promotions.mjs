/**
 * Import promotions from the clean xlsx file into the promotions table.
 *
 * Usage:
 *   node scripts/import-promotions.mjs              # dry run (default)
 *   node scripts/import-promotions.mjs --wipe       # delete all existing rows then insert
 *
 * Source file: ~/Downloads/NEW-promotions_upload_CRM_ready_final_updated_simple.xlsx
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

const WIPE = process.argv.includes("--wipe");
const _fileIdx = process.argv.indexOf("--file");
const XLSX_PATH =
  _fileIdx !== -1
    ? process.argv[_fileIdx + 1]
    : "/Users/aaronbarnholt/Downloads/NEW-promotions_upload_CRM_ready_final_updated_simple.xlsx";

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

/** Convert Excel serial date number → ISO date string (YYYY-MM-DD), or null. */
function excelDateToISO(val) {
  if (val == null || val === "") return null;
  const n = Number(val);
  if (isNaN(n)) return null;
  // Excel epoch: Dec 30, 1899. JS epoch: Jan 1, 1970.
  // Offset between them: 25569 days. Also account for Excel's leap-year bug (day 60 = Feb 29 1900).
  const jsMs = (n - 25569) * 86400 * 1000;
  const d = new Date(jsMs);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── Brand name overrides ──────────────────────────────────────────────────────

const BRAND_NAME_MAP = {
  // Bearded Brothers
  "Bearded Brothers - Bearded Brothers LLC": "Bearded Brothers - Bearded Brothers LLC",
  "Bearded Bros": "Bearded Brothers - Bearded Brothers LLC",
  "BEARDED BROTHERS": "Bearded Brothers - Bearded Brothers LLC",

  // B.T.R.
  "B.T.R. Nation": "B.T.R. - Better Brownie Bites INC",
  "B.T.R. NATION": "B.T.R. - Better Brownie Bites INC",
  "B.T.R. Nation - Better Brownie Bites": "B.T.R. - Better Brownie Bites INC",
  "BTR": "B.T.R. - Better Brownie Bites INC",
  "B.T.R.": "B.T.R. - Better Brownie Bites INC",

  // Alice Mushrooms
  "Alice": "Alice - Alice Mushrooms",
  "Alice Mushrooms": "Alice - Alice Mushrooms",

  // Aplos
  "Aplós": "Aplos",
  "Aplós ": "Aplos",
  "Aplos": "Aplos",

  // American Tuna
  "American Salmon": "American Tuna",
  "American Tuna - American Salmon": "American Tuna",
  "American Tuna - P&L": "American Tuna",
  "American Tuna ": "American Tuna",

  // Cravings by Chrissy
  "Cravings by Chrissy": "Cravings by Chrissy - Chrissy's Cravings",
  "Cravings By Chrissy Teigen": "Cravings by Chrissy - Chrissy's Cravings",
  "CRAVINGS BY CHRISSY TEIGEN": "Cravings by Chrissy - Chrissy's Cravings",

  // Verve
  "Verve Coffee - Verve LLC": "Verve",
  "VERVE LLC": "Verve",
  "VERVE COFFEE ROASTERS": "Verve",
  "Verve": "Verve",

  // Naked & Saucy
  "Naked & Saucy": "Naked & Saucy - Naked and Saucy Inc.",
  "NAKED AND SAUCY": "Naked & Saucy - Naked and Saucy Inc.",
  "NAKD": "Naked & Saucy - Naked and Saucy Inc.",

  // PuraVida
  "Puravida": "PuraVida",
  "PuraVida": "PuraVida",

  // Zahav
  "Zahav": "Zahav Foods",
  "Zahav Foods, LLC": "Zahav Foods",

  // ripi
  "Ripi - Ripi Foods": "ripi",
  "RIPI": "ripi",
  "ripi": "ripi",

  // Organic Traditions
  "Organic Traditions- Health Matters - Sunset": "Organic Traditions",
  "Organic Traditions - Health Matters": "Organic Traditions",
  "ORGANIC TRADITIONS": "Organic Traditions",
  "Organic Traditions": "Organic Traditions",

  // Bim Bam Boo
  "Bim Bam Boo - Zogo": "Bim Bam Boo",

  // Hedgehog
  "Hedgehog Foods": "Hedgehog - Hedgehog Foods LLC",

  // Homiah
  "HOMIAH INC.": "Homiah",

  // Japan Gold
  "Japan Gold - Muso": "Japan Gold",
  "Japan Gold - Ohsawa": "Japan Gold",

  // NaturSource
  "NaturSource": "Naturesource - Naturesource Inc.",
  "naturSource": "Naturesource - Naturesource Inc.",

  // OKO
  "OKO Blends": "Oko Foods",

  // Queen Street
  "Queen St. Bakery": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "QUEEN STREET BAKERY": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "Queen Street Gluten Free": "Queen Street Bakery - Queen Street Gluten Free Inc.",

  // Seven Teas
  "Seven Teas": "Seven Teas - Tea Horse Rd",
  "Seven Teas & Lemonade": "Seven Teas - Tea Horse Rd",
  "SEVEN ADE": "Seven Teas - Tea Horse Rd",

  // Con-Cret
  "CON-CRĒT®": "Vireo - Con-Crete/Sanz",

  // Dr. Emil
  "Dr Emil Nutrition": "Dr. Emil - Brand Holdings",

  // pH-D
  "pH-D Feminine Health": "pH-D Feminine Health",
  "ph-D Feminine Health": "pH-D Feminine Health",

  // YESLY
  "Yesly ": "YESLY",
  "Yesly": "YESLY",

  // CoAqua
  "COAQUA": "CoAqua",

  // Allergy Smart
  "Allergy Smart": "Allergy Smart",
  "ALLERGY SMART": "Allergy Smart",

  // Intentionally skipped — inactive clients or not in DB
  "Purplesful": null,
  "Blue Durango": null,
  "Zee Test Brand": null,
  "Clean Roots": null,
  "Little Inca": null,
  "Freestyle Snacks": null,
  "Crate 61": null,
  "Rif Care": null,
  "Sap's - Craft Hydration LLC": null,
};

// ── Retailer name overrides ───────────────────────────────────────────────────

const RETAILER_NAME_MAP = {
  // Whole Foods (DB name: "Whole Foods", banner: "Whole Foods")
  "Whole Foods Market": "Whole Foods",
  "Whole Foods": "Whole Foods",
  "Whole Foods (SP & NC regions)": "Whole Foods",
  "Whole Foods (SoCal, NorCal, NE)": "Whole Foods",
  "Whole Foods- SoPac Only": "Whole Foods",
  "Whole Foods SoPac": "Whole Foods",
  "WFM": "Whole Foods",

  // Kroger
  "Kroger": "Kroger",
  "Kroger Divisions: Col, Mich, Central, Delta, SW": "Kroger",
  "Kroger Central": "Kroger",
  "Kroger SW": "Kroger",
  "Kroger Divisions": "Kroger",
  "King Soopers": "Kroger",
  "King Soopers / Fred Meyers/ QFC": "Kroger",
  "Fred Meyer": "Kroger",
  "QFC": "Kroger",

  // Albertsons family
  "Albertsons": "Albertsons",
  "Albertsons Boise HQ": "Albertsons Boise HQ",
  "Albertsons- Mid Atlantic": "Albertsons",
  "Albertsons NorCal": "Albertsons",
  "Albertson's - SoCal": "Albertsons",
  "Albertsons Seattle": "Albertsons",
  "Albertsons Southern": "Albertsons",
  "Albertsons Portland": "Albertsons",
  "Albertsons Mountian West": "Albertsons",
  "Albertsons Southwest": "Albertsons",
  "Pavilions": "Albertsons",
  "Pavillions": "Albertsons",

  // AJ's - Bashas (now in DB)
  "AJ's": "AJ's - Bashas",
  "Aj's - Bashas": "AJ's - Bashas",
  "AJ's - Bashas": "AJ's - Bashas",

  // Northwest Grocers
  "NW Grocer": "Northwest Grocers",
  "NW Grocers": "Northwest Grocers",
  "NorthWest Grocers Corp": "Northwest Grocers",

  // Sprouts (DB name: "Sprouts Farmers Market", banner: "Sprouts")
  "Sprouts": "Sprouts Farmers Market",
  "Sprouts Farmers Market": "Sprouts Farmers Market",

  // Natural Grocers
  "Natural Grocers": "Natural Grocers",
  "Natural Grocers - Vitamin Cottage": "Natural Grocers",

  // Town and Country (DB name: "Town and Country")
  "Town and Country": "Town and Country",
  "Town and Country Markets": "Town and Country",

  // Ahold banners
  "Giant Co : Martin & Carlisle": "Ahold",
  "Giant Food Landover": "Ahold",
  "Stop & Shop": "Ahold",
  "Hannaford": "Ahold",

  // Giant Eagle & Market District
  "Market District": "Giant Eagle & Market District",
  "Giant Eagle": "Giant Eagle & Market District",
  "Giant Eagle & Market District": "Giant Eagle & Market District",

  // Rosauers
  "Rosauers": "Rosauers",
  "Rosauers / Huckleberrys": "Rosauers",

  // Skogen's Festival Foods (now in DB)
  "Skogen": "Skogen's Festival Foods",
  "Skogen's Festival Foods": "Skogen's Festival Foods",

  // Lazy Acres → New Leaf/Lazy Acres
  "Lazy Acres": "New Leaf/Lazy Acres",
  "New Leaf": "New Leaf/Lazy Acres",

  // D'Agostino's / Gristede's
  "D'Agostinos": "DiAgostino's/Grisede's",
  "D'Agostino's": "DiAgostino's/Grisede's",
  "Gristede's": "DiAgostino's/Grisede's",

  // Fresh Market → The Fresh Market
  "Fresh Market": "The Fresh Market",

  // Schnuck's (DB has "Shnuck's")
  "Schnuck's": "Shnuck's",
  "Schnucks": "Shnuck's",

  // Kowalski's
  "Kowalksi's": "Kowalskis",
  "Kowalski's": "Kowalskis",

  // Newly added retailers
  "Foodtown": "Foodtown",
  "Fraizer Farms": "Frazier Farms",
  "Frazier Farms": "Frazier Farms",
  "Baron Market": "Barons Market",
  "Barons": "Barons Market",
  "Barons Market": "Barons Market",
  "Foodland": "Foodland",
  "Heinen's": "Heinen's",
  "Roche Bros": "Roche Bros",
  "Savemart": "Save Mart",
  "Save Mart": "Save Mart",
  "Ingles": "Ingles",
  "Jerry's Foods": "Jerry's Foods",

  // Other common (exact DB names)
  "Fresh Thyme": "Fresh Thyme",
  "Fresh Thyme Farmers Market": "Fresh Thyme",
  "Market of Choice": "Market of Choice",
  "New Seasons": "New Seasons",
  "PCC": "PCC Markets",
  "Raley's": "Raleys",
  "Meijer": "Meijer",
  "Costco": "Costco",
  "Wegmans": "Wegmans",
  "Harris Teeter": "Harris Teeter",
  "Publix": "Publix",
  "H-E-B": "H-E-B",
  "Erewhon": "Erewhon",
  "DeCicco's": "DeCicco's",
  "Morton Williams": "Morton Williams",
  "Bristol Farms": "Bristol Farms",

  // Not in DB — skip
  "Jewel": null,
  "Jewel-Osco": null,
  "Albetsons Jewel": null,
  "Healthy Edge": null,
  "Vitacost": null,
  "Lowe's": null,
  "Price Chopper": null,
};

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nReading: ${XLSX_PATH}`);

let wb;
try {
  wb = XLSX.readFile(XLSX_PATH);
} catch (e) {
  console.error("Failed to read xlsx:", e.message);
  process.exit(1);
}

// Find the sheet — try a few expected names
const sheetName =
  wb.SheetNames.find((n) => n.toLowerCase().includes("promo")) ??
  wb.SheetNames[0];
const ws = wb.Sheets[sheetName];
if (!ws) {
  console.error("No sheet found. Available sheets:", wb.SheetNames.join(", "));
  process.exit(1);
}
console.log(`Using sheet: "${sheetName}"`);

const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null });
console.log(`Total data rows in xlsx: ${rawRows.length}\n`);

// ── Connect + load DB ─────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const [{ data: brands, error: brandsErr }, { data: retailers, error: retailersErr }] =
  await Promise.all([
    supabase.from("brands").select("id,name"),
    supabase.from("retailers").select("id,name,banner"),
  ]);

if (brandsErr) { console.error("Failed to fetch brands:", brandsErr.message); process.exit(1); }
if (retailersErr) { console.error("Failed to fetch retailers:", retailersErr.message); process.exit(1); }

console.log(`Loaded ${brands.length} brands, ${retailers.length} retailers from DB.\n`);

// ── Resolution helpers ────────────────────────────────────────────────────────

const brandCache = new Map();
function resolveDbBrand(name) {
  if (!name) return null;
  const key = String(name).trim();
  if (brandCache.has(key)) return brandCache.get(key);

  if (Object.prototype.hasOwnProperty.call(BRAND_NAME_MAP, key)) {
    const mapped = BRAND_NAME_MAP[key];
    if (mapped === null) { brandCache.set(key, null); return null; }
    const hit = brands.find((b) => b.name === mapped) ?? bestMatch(mapped, brands, (b) => b.name)?.item ?? null;
    brandCache.set(key, hit);
    return hit;
  }

  const hit = bestMatch(key, brands, (b) => b.name)?.item ?? null;
  brandCache.set(key, hit);
  return hit;
}

const retailerCache = new Map();
function resolveDbRetailer(name) {
  if (!name) return null;
  const key = String(name).trim();
  if (retailerCache.has(key)) return retailerCache.get(key);

  if (Object.prototype.hasOwnProperty.call(RETAILER_NAME_MAP, key)) {
    const mapped = RETAILER_NAME_MAP[key];
    if (!mapped) { retailerCache.set(key, null); return null; }
    const hit =
      retailers.find((r) => normalize(r.name) === normalize(mapped)) ??
      retailers.find((r) => normalize(r.banner ?? "") === normalize(mapped)) ??
      bestMatch(mapped, retailers, (r) => r.name)?.item ??
      null;
    retailerCache.set(key, hit);
    return hit;
  }

  const byName = bestMatch(key, retailers, (r) => r.name);
  if (byName) { retailerCache.set(key, byName.item); return byName.item; }

  const byBanner = bestMatch(key, retailers, (r) => r.banner ?? "");
  if (byBanner) { retailerCache.set(key, byBanner.item); return byBanner.item; }

  retailerCache.set(key, null);
  return null;
}

// ── Process rows ──────────────────────────────────────────────────────────────

const rows = [];
const brandMisses = new Map();
const retailerMisses = new Map();
let brandMatchCount = 0;
let retailerMatchCount = 0;

for (const raw of rawRows) {
  const brandName = String(raw.brand_name ?? "").trim();
  const retailerName = String(raw.retailer_name ?? "").trim();

  const dbBrand = resolveDbBrand(brandName);
  const dbRetailer = resolveDbRetailer(retailerName);

  if (dbBrand) brandMatchCount++;
  else if (brandName) {
    brandMisses.set(brandName, (brandMisses.get(brandName) ?? 0) + 1);
  }

  if (dbRetailer) retailerMatchCount++;
  else if (retailerName) {
    retailerMisses.set(retailerName, (retailerMisses.get(retailerName) ?? 0) + 1);
  }

  rows.push({
    raw,
    dbBrand,
    dbRetailer,
    insertRow: {
      brand_id: dbBrand?.id ?? null,
      retailer_id: dbRetailer?.id ?? null,
      brand_name: brandName || null,
      retailer_name: retailerName || null,
      retailer_banner: dbRetailer?.banner ?? null,
      distributor: raw.distributor ?? null,
      cultivate_rep: raw.cultivate_rep ?? null,
      sku_description: raw.sku_description ?? null,
      unit_upc: raw.unit_upc != null ? String(raw.unit_upc) : null,
      promo_year: raw.promo_year != null ? Number(raw.promo_year) : null,
      promo_month: raw.promo_month != null ? Number(raw.promo_month) : null,
      promo_name: raw.promo_name ?? null,
      promo_type: raw.promo_type ?? null,
      promo_status: raw.promo_status ?? null,
      start_date: excelDateToISO(raw.start_date),
      end_date: excelDateToISO(raw.end_date),
      discount_percent: raw.discount_percent != null ? Number(raw.discount_percent) : null,
      discount_amount: raw.discount_amount != null ? Number(raw.discount_amount) : null,
      promo_text_raw: raw.promo_text_raw ?? null,
      notes: raw.notes ?? null,
    },
  });
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log("═".repeat(72));
console.log("BRAND MATCH REPORT");
console.log("═".repeat(72));
console.log(`Matched: ${brandMatchCount} / ${rawRows.length} rows (${((brandMatchCount / rawRows.length) * 100).toFixed(1)}%)`);
if (brandMisses.size > 0) {
  console.log(`\nUnmatched brand names (${brandMisses.size} unique):`);
  for (const [name, count] of [...brandMisses.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ✗ "${name}" (${count} rows)`);
  }
}

console.log("\n" + "═".repeat(72));
console.log("RETAILER MATCH REPORT");
console.log("═".repeat(72));
console.log(`Matched: ${retailerMatchCount} / ${rawRows.length} rows (${((retailerMatchCount / rawRows.length) * 100).toFixed(1)}%)`);
if (retailerMisses.size > 0) {
  console.log(`\nUnmatched retailer names (${retailerMisses.size} unique):`);
  for (const [name, count] of [...retailerMisses.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ✗ "${name}" (${count} rows)`);
  }
}

const insertRows = rows.map((r) => r.insertRow);
const rowsWithBothIds = insertRows.filter((r) => r.brand_id && r.retailer_id).length;
const rowsMissingBrand = insertRows.filter((r) => !r.brand_id).length;
const rowsMissingRetailer = insertRows.filter((r) => !r.retailer_id).length;

console.log("\n" + "═".repeat(72));
console.log("SUMMARY");
console.log("═".repeat(72));
console.log(`Total rows:                  ${rawRows.length}`);
console.log(`Both brand + retailer found: ${rowsWithBothIds}`);
console.log(`Missing brand_id:            ${rowsMissingBrand}`);
console.log(`Missing retailer_id:         ${rowsMissingRetailer}`);

// Preview 3 insert rows that have both IDs
console.log("\n" + "═".repeat(72));
console.log("PREVIEW (3 rows with both brand_id + retailer_id)");
console.log("═".repeat(72));
const preview = insertRows.filter((r) => r.brand_id && r.retailer_id).slice(0, 3);
for (const p of preview) {
  console.log(JSON.stringify(p, null, 2));
}

if (!WIPE) {
  console.log("\n[DRY RUN] No changes made. Re-run with --wipe to delete existing rows and insert all.\n");
  process.exit(0);
}

// ── Wipe + Insert ─────────────────────────────────────────────────────────────

console.log("\n⚠ --wipe flag set. Deleting all existing rows from promotions table…");
const { error: wipeErr } = await supabase.from("promotions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
if (wipeErr) {
  console.error("Wipe failed:", wipeErr.message);
  process.exit(1);
}
console.log("Wipe complete.\n");

console.log(`Inserting ${insertRows.length} rows…`);
const BATCH = 200;
let inserted = 0;
let errors = 0;

for (let i = 0; i < insertRows.length; i += BATCH) {
  const batch = insertRows.slice(i, i + BATCH);
  const { error } = await supabase.from("promotions").insert(batch);
  if (error) {
    console.error(`  Batch ${i}–${i + batch.length - 1} error:`, error.message);
    errors++;
  } else {
    inserted += batch.length;
  }
  process.stdout.write(`\r  Inserted ${inserted} / ${insertRows.length}…`);
}

console.log(`\n\nDone. Inserted: ${inserted}, Batch errors: ${errors}`);
