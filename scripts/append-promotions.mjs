/**
 * Append promotions from two supplemental files — NO wipe.
 *
 * File 1: upload 4.27.xlsx          — same schema as main import, brand col = "brand_supplier name"
 * File 2: NEW Sprouts promos_...    — different schema, Sprouts-only
 *
 * Usage:
 *   node scripts/append-promotions.mjs            # dry run (default)
 *   node scripts/append-promotions.mjs --insert   # append to promotions table
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

const INSERT = process.argv.includes("--insert");

const FILE1 = "/Users/aaronbarnholt/Downloads/upload 4.27.xlsx";
const FILE2 = "/Users/aaronbarnholt/Downloads/NEW Sprouts promos_updated_with_CRM_upload_filled_dates.xlsx";

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

/** Convert Excel serial date → ISO string, or pass through if already a string date. */
function toISODate(val) {
  if (val == null || val === "") return null;
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  const n = Number(val);
  if (isNaN(n)) return null;
  const d = new Date((n - 25569) * 86400 * 1000);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Parse "25%" or 0.25 or 25 → integer percent (e.g. 25). */
function parsePercent(val) {
  if (val == null || val === "") return null;
  const s = String(val).trim();
  if (s.endsWith("%")) return Math.round(parseFloat(s)) || null;
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  // If stored as decimal fraction (e.g. 0.25) convert to whole-number percent
  return n > 0 && n <= 1 ? Math.round(n * 100) : Math.round(n);
}

/**
 * Normalize promo_status to a value allowed by the DB check constraint.
 * Allowed: submitted, approved, completed, cancelled, live
 */
function normalizeStatus(val) {
  if (val == null) return "submitted";
  const s = String(val).trim().toLowerCase();
  if (s === "submitted") return "submitted";
  if (s === "approved") return "approved";
  if (s === "executed" || s === "execuated" || s === "complete" || s === "completed") return "completed";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "active" || s === "live") return "live";
  if (s === "upcoming" || s.startsWith("upcoming")) return "submitted";
  // Date strings like "05/01/2026" accidentally in status field → submitted
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return "submitted";
  return "submitted"; // safe default for anything unrecognized
}

/** Validate promo_year — must be a 4-digit year. Returns 2026 as fallback. */
function parseYear(val) {
  if (val == null) return null;
  const n = Number(val);
  if (isNaN(n) || n < 2000 || n > 2100) return 2026; // junk value → default to current year
  return Math.round(n);
}

/**
 * Normalize promo_type to DB allowed values: TPR, Display, Demo, Feature, Digital, Other.
 * MCB / OI / Scan / SRP are all price-reduction trade mechanics → map to TPR.
 */
function normalizePromoType(val) {
  if (val == null || val === "") return "Other";
  const s = String(val).trim().toUpperCase();
  if (s === "TPR") return "TPR";
  if (s === "MCB" || s === "OI" || s === "OI " || s === "SCAN" || s === "SRP") return "TPR";
  if (s === "DISPLAY") return "Display";
  if (s === "DEMO") return "Demo";
  if (s === "FEATURE") return "Feature";
  if (s === "DIGITAL") return "Digital";
  return "Other"; // Active, Submitted, anything unrecognized
}

const MONTH_NUM = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function monthToNum(val) {
  if (val == null) return null;
  const n = Number(val);
  if (!isNaN(n)) return n;
  return MONTH_NUM[String(val).trim().toLowerCase()] ?? null;
}

// ── Brand NAME_MAP (same as import-promotions.mjs) ────────────────────────────

const BRAND_NAME_MAP = {
  "Bearded Brothers - Bearded Brothers LLC": "Bearded Brothers - Bearded Brothers LLC",
  "Bearded Bros": "Bearded Brothers - Bearded Brothers LLC",
  "BEARDED BROTHERS": "Bearded Brothers - Bearded Brothers LLC",
  "B.T.R. Nation": "B.T.R. - Better Brownie Bites INC",
  "B.T.R. NATION": "B.T.R. - Better Brownie Bites INC",
  "B.T.R. Nation - Better Brownie Bites": "B.T.R. - Better Brownie Bites INC",
  "BTR": "B.T.R. - Better Brownie Bites INC",
  "B.T.R.": "B.T.R. - Better Brownie Bites INC",
  "Alice": "Alice - Alice Mushrooms",
  "Alice Mushrooms": "Alice - Alice Mushrooms",
  "Aplós": "Aplos",
  "Aplós ": "Aplos",
  "Aplos": "Aplos",
  "American Salmon": "American Tuna",
  "American Tuna - American Salmon": "American Tuna",
  "American Tuna - P&L": "American Tuna",
  "American Tuna ": "American Tuna",
  "Cravings by Chrissy": "Cravings by Chrissy - Chrissy's Cravings",
  "Cravings By Chrissy Teigen": "Cravings by Chrissy - Chrissy's Cravings",
  "CRAVINGS BY CHRISSY TEIGEN": "Cravings by Chrissy - Chrissy's Cravings",
  "Verve Coffee - Verve LLC": "Verve",
  "VERVE LLC": "Verve",
  "VERVE COFFEE ROASTERS": "Verve",
  "Verve": "Verve",
  "Naked & Saucy": "Naked & Saucy - Naked and Saucy Inc.",
  "NAKED AND SAUCY": "Naked & Saucy - Naked and Saucy Inc.",
  "NAKD": "Naked & Saucy - Naked and Saucy Inc.",
  "Puravida": "PuraVida",
  "PuraVida": "PuraVida",
  "Zahav": "Zahav Foods",
  "Zahav Foods, LLC": "Zahav Foods",
  "Ripi - Ripi Foods": "ripi",
  "RIPI": "ripi",
  "ripi": "ripi",
  "Organic Traditions- Health Matters - Sunset": "Organic Traditions",
  "Organic Traditions - Health Matters": "Organic Traditions",
  "ORGANIC TRADITIONS": "Organic Traditions",
  "Organic Traditions": "Organic Traditions",
  "Bim Bam Boo - Zogo": "Bim Bam Boo",
  "Hedgehog Foods": "Hedgehog - Hedgehog Foods LLC",
  "HOMIAH INC.": "Homiah",
  "Japan Gold - Muso": "Japan Gold",
  "Japan Gold - Ohsawa": "Japan Gold",
  "NaturSource": "Naturesource - Naturesource Inc.",
  "naturSource": "Naturesource - Naturesource Inc.",
  "OKO Blends": "Oko Foods",
  "Queen St. Bakery": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "QUEEN STREET BAKERY": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "Queen Street Gluten Free": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "Queen Street Gluten Free Inc": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "Queen Street Gluten Free Inc.": "Queen Street Bakery - Queen Street Gluten Free Inc.",
  "Seven Teas": "Seven Teas - Tea Horse Rd",
  "Seven Teas & Lemonade": "Seven Teas - Tea Horse Rd",
  "SEVEN ADE": "Seven Teas - Tea Horse Rd",
  "CON-CRĒT®": "Vireo - Con-Crete/Sanz",
  "Dr Emil Nutrition": "Dr. Emil - Brand Holdings",
  "pH-D Feminine Health": "pH-D Feminine Health",
  "ph-D Feminine Health": "pH-D Feminine Health",
  "Yesly ": "YESLY",
  "Yesly": "YESLY",
  "COAQUA": "CoAqua",
  "Allergy Smart": "Allergy Smart",
  "ALLERGY SMART": "Allergy Smart",
  "Freestyle Snacks": null,
  "Crate 61": null,
  "Rif Care": null,
  "Sap's - Craft Hydration LLC": null,
  "Purplesful": null,
  "Blue Durango": null,
  "Zee Test Brand": null,
  "Clean Roots": null,
  "Little Inca": null,
};

// ── Retailer NAME_MAP (same as import-promotions.mjs) ─────────────────────────

const RETAILER_NAME_MAP = {
  "Whole Foods Market": "Whole Foods",
  "Whole Foods": "Whole Foods",
  "Whole Foods (SP & NC regions)": "Whole Foods",
  "Whole Foods (SoCal, NorCal, NE)": "Whole Foods",
  "Whole Foods- SoPac Only": "Whole Foods",
  "Whole Foods SoPac": "Whole Foods",
  "WFM": "Whole Foods",
  "Kroger": "Kroger",
  "Kroger Divisions: Col, Mich, Central, Delta, SW": "Kroger",
  "Kroger Central": "Kroger",
  "Kroger SW": "Kroger",
  "King Soopers": "Kroger",
  "King Soopers / Fred Meyers/ QFC": "Kroger",
  "Fred Meyer": "Kroger",
  "QFC": "Kroger",
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
  "AJ's": "AJ's - Bashas",
  "Aj's - Bashas": "AJ's - Bashas",
  "AJ's - Bashas": "AJ's - Bashas",
  "NW Grocer": "Northwest Grocers",
  "NW Grocers": "Northwest Grocers",
  "NorthWest Grocers Corp": "Northwest Grocers",
  "Sprouts": "Sprouts Farmers Market",
  "Sprouts Farmers Market": "Sprouts Farmers Market",
  "Natural Grocers": "Natural Grocers",
  "Natural Grocers - Vitamin Cottage": "Natural Grocers",
  "Town and Country": "Town and Country",
  "Town and Country Markets": "Town and Country",
  "Market District": "Giant Eagle & Market District",
  "Giant Eagle": "Giant Eagle & Market District",
  "Giant Eagle & Market District": "Giant Eagle & Market District",
  "Rosauers": "Rosauers",
  "Rosauers / Huckleberrys": "Rosauers",
  "Skogen": "Skogen's Festival Foods",
  "Skogen's Festival Foods": "Skogen's Festival Foods",
  "Lazy Acres": "New Leaf/Lazy Acres",
  "New Leaf": "New Leaf/Lazy Acres",
  "D'Agostinos": "DiAgostino's/Grisede's",
  "D'Agostino's": "DiAgostino's/Grisede's",
  "Gristede's": "DiAgostino's/Grisede's",
  "Fresh Market": "The Fresh Market",
  "Schnuck's": "Shnuck's",
  "Schnucks": "Shnuck's",
  "Kowalksi's": "Kowalskis",
  "Kowalski's": "Kowalskis",
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
  "Lowe's Foods": "Lowes Foods",
  "Lowes Foods": "Lowes Foods",
  "Plum Market": "Plum Market",
  "Hy-Vee": "Hy-Vee",
  "Jewel": null,
  "Jewel-Osco": null,
  "Healthy Edge": null,
  "Vitacost": null,
  "Lowe's": null,
  "Price Chopper": null,
};

// ── Connect + load DB ─────────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const [{ data: brands, error: brandsErr }, { data: retailers, error: retailersErr }] =
  await Promise.all([
    supabase.from("brands").select("id,name"),
    supabase.from("retailers").select("id,name,banner"),
  ]);

if (brandsErr) { console.error("brands:", brandsErr.message); process.exit(1); }
if (retailersErr) { console.error("retailers:", retailersErr.message); process.exit(1); }

console.log(`Loaded ${brands.length} brands, ${retailers.length} retailers.\n`);

// ── Resolution caches ─────────────────────────────────────────────────────────

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
      bestMatch(mapped, retailers, (r) => r.name)?.item ?? null;
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

// ── Process File 1: upload 4.27.xlsx ─────────────────────────────────────────

console.log("═".repeat(72));
console.log("FILE 1: upload 4.27.xlsx");
console.log("═".repeat(72));

const wb1 = XLSX.readFile(FILE1);
const ws1 = wb1.Sheets[wb1.SheetNames[0]];
const raw1 = XLSX.utils.sheet_to_json(ws1, { defval: null });
console.log(`Rows: ${raw1.length}`);

const inserts1 = [];
const brandMisses1 = new Map();
const retailerMisses1 = new Map();

for (const raw of raw1) {
  const brandName = String(raw["brand_supplier name"] ?? raw["brand_name"] ?? "").trim();
  const retailerName = String(raw.retailer_name ?? "").trim();
  const dbBrand = resolveDbBrand(brandName);
  const dbRetailer = resolveDbRetailer(retailerName);

  if (!dbBrand && brandName) brandMisses1.set(brandName, (brandMisses1.get(brandName) ?? 0) + 1);
  if (!dbRetailer && retailerName) retailerMisses1.set(retailerName, (retailerMisses1.get(retailerName) ?? 0) + 1);

  inserts1.push({
    brand_id: dbBrand?.id ?? null,
    retailer_id: dbRetailer?.id ?? null,
    brand_name: brandName || null,
    retailer_name: retailerName || null,
    retailer_banner: dbRetailer?.banner ?? null,
    distributor: raw.distributor ?? null,
    cultivate_rep: raw.cultivate_rep ?? null,
    sku_description: raw.sku_description ?? null,
    unit_upc: raw.unit_upc != null ? String(raw.unit_upc) : null,
    promo_year: parseYear(raw.promo_year),
    promo_month: raw.promo_month != null
      ? Number(raw.promo_month)
      : raw.start_date ? new Date((Number(raw.start_date) - 25569) * 86400000).getMonth() + 1 : 1,
    promo_name: raw.promo_name ?? null,
    promo_type: normalizePromoType(raw.promo_type),
    promo_status: normalizeStatus(raw.promo_status),
    start_date: toISODate(raw.start_date),
    end_date: toISODate(raw.end_date),
    discount_percent: parsePercent(raw.discount_percent),
    discount_amount: raw.discount_amount != null ? Number(raw.discount_amount) : null,
    promo_text_raw: raw.promo_text_raw ?? null,
    notes: raw.notes ?? null,
  });
}

const f1BothIds = inserts1.filter((r) => r.brand_id && r.retailer_id).length;
console.log(`Brand matched:    ${inserts1.filter(r => r.brand_id).length} / ${raw1.length}`);
console.log(`Retailer matched: ${inserts1.filter(r => r.retailer_id).length} / ${raw1.length}`);
console.log(`Both matched:     ${f1BothIds} / ${raw1.length}`);
if (brandMisses1.size) {
  console.log("Unmatched brands:");
  for (const [n, c] of [...brandMisses1.entries()].sort((a,b) => b[1]-a[1]))
    console.log(`  ✗ "${n}" (${c})`);
}
if (retailerMisses1.size) {
  console.log("Unmatched retailers:");
  for (const [n, c] of [...retailerMisses1.entries()].sort((a,b) => b[1]-a[1]))
    console.log(`  ✗ "${n}" (${c})`);
}

// ── Process File 2: NEW Sprouts promos ───────────────────────────────────────

console.log("\n" + "═".repeat(72));
console.log("FILE 2: NEW Sprouts promos_updated_with_CRM_upload_filled_dates.xlsx");
console.log("═".repeat(72));

const wb2 = XLSX.readFile(FILE2);
const ws2 = wb2.Sheets[wb2.SheetNames[0]];
const raw2 = XLSX.utils.sheet_to_json(ws2, { defval: null });
console.log(`Rows: ${raw2.length}`);

// Sprouts retailer is fixed — look it up once
const sproutsRetailer = resolveDbRetailer("Sprouts Farmers Market");
if (!sproutsRetailer) {
  console.error("Could not find 'Sprouts Farmers Market' in retailers table!");
  process.exit(1);
}
console.log(`Sprouts retailer: "${sproutsRetailer.name}" (${sproutsRetailer.id})`);

const inserts2 = [];
const brandMisses2 = new Map();

for (const raw of raw2) {
  const brandName = String(raw["Brand"] ?? raw["brand"] ?? "").trim();
  const dbBrand = resolveDbBrand(brandName);

  if (!dbBrand && brandName) brandMisses2.set(brandName, (brandMisses2.get(brandName) ?? 0) + 1);

  const startDate = toISODate(raw["Promo Start Date"]);
  const promoYear = startDate ? parseInt(startDate.slice(0, 4), 10) : null;
  const promoMonth = monthToNum(raw["Month"]);

  // Discount Present is like "25%" — store as discount_percent
  const discountPct = parsePercent(raw["Discount Present"]);

  inserts2.push({
    brand_id: dbBrand?.id ?? null,
    retailer_id: sproutsRetailer.id,
    brand_name: brandName || null,
    retailer_name: "Sprouts Farmers Market",
    retailer_banner: sproutsRetailer.banner ?? null,
    distributor: raw["Distributor"] ?? null,
    cultivate_rep: null,
    sku_description: "",
    unit_upc: raw["UPC"] != null ? String(raw["UPC"]) : null,
    promo_year: promoYear,
    promo_month: promoMonth,
    promo_name: null,
    promo_type: "Other",
    promo_status: normalizeStatus(raw["Promo Status"]),
    start_date: startDate,
    end_date: toISODate(raw["Promo End Date"]),
    discount_percent: discountPct,
    discount_amount: null,
    promo_text_raw: raw["Promo Text"] ?? null,
    notes: null,
  });
}

const f2BothIds = inserts2.filter((r) => r.brand_id && r.retailer_id).length;
console.log(`Brand matched:    ${inserts2.filter(r => r.brand_id).length} / ${raw2.length}`);
console.log(`Retailer matched: ${inserts2.filter(r => r.retailer_id).length} / ${raw2.length} (all Sprouts)`);
console.log(`Both matched:     ${f2BothIds} / ${raw2.length}`);
if (brandMisses2.size) {
  console.log("Unmatched brands:");
  for (const [n, c] of [...brandMisses2.entries()].sort((a,b) => b[1]-a[1]))
    console.log(`  ✗ "${n}" (${c})`);
}

// ── Preview ───────────────────────────────────────────────────────────────────

console.log("\n" + "═".repeat(72));
console.log("PREVIEW — File 1 (first matched row)");
console.log("═".repeat(72));
const p1 = inserts1.find(r => r.brand_id && r.retailer_id);
if (p1) console.log(JSON.stringify(p1, null, 2));

console.log("\n" + "═".repeat(72));
console.log("PREVIEW — File 2 (first matched row)");
console.log("═".repeat(72));
const p2 = inserts2.find(r => r.brand_id && r.retailer_id);
if (p2) console.log(JSON.stringify(p2, null, 2));

console.log("\n" + "═".repeat(72));
console.log("TOTALS");
console.log("═".repeat(72));
console.log(`File 1: ${inserts1.length} rows total, ${f1BothIds} with both IDs`);
console.log(`File 2: ${inserts2.length} rows total, ${f2BothIds} with both IDs`);
console.log(`Combined append: ${inserts1.length + inserts2.length} rows`);

if (!INSERT) {
  console.log("\n[DRY RUN] Pass --insert to append these rows to the promotions table.\n");
  process.exit(0);
}

// ── Insert ────────────────────────────────────────────────────────────────────

const allInserts = [...inserts1, ...inserts2];
console.log(`\nAppending ${allInserts.length} rows to promotions table…`);

const BATCH = 200;
let inserted = 0;
let errors = 0;

for (let i = 0; i < allInserts.length; i += BATCH) {
  const batch = allInserts.slice(i, i + BATCH);
  const { error } = await supabase.from("promotions").insert(batch);
  if (error) {
    console.error(`  Batch error at ${i}:`, error.message);
    errors++;
  } else {
    inserted += batch.length;
  }
  process.stdout.write(`\r  Inserted ${inserted} / ${allInserts.length}…`);
}

console.log(`\n\nDone. Inserted: ${inserted}, Batch errors: ${errors}`);
