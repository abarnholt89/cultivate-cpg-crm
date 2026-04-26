/**
 * Import brand_category_access from spreadsheet.
 *
 * Usage:
 *   node scripts/import-brand-category-access.mjs          # dry run (default)
 *   node scripts/import-brand-category-access.mjs --insert # actually upsert
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

// Load credentials from .env.local (same pattern as other import scripts)
function loadDotEnv() {
  try {
    const env = readFileSync(".env.local", "utf8");
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

const XLSX_PATH = "/Users/aaronbarnholt/Downloads/brand category access - category universe.xlsx";
const CAT_COLS = ["Category 1", "Category 2", "Category 3", "Category 4", "Category 5", "Category 6"];

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── helpers ──────────────────────────────────────────────────────────────────

function normalize(s) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Extract the part before the first " - " (the "friendly" brand name)
function shortName(s) {
  const idx = s.indexOf(" - ");
  return idx === -1 ? s.trim() : s.slice(0, idx).trim();
}

function bestMatch(sheetName, brands) {
  const norm = normalize(sheetName);
  const short = normalize(shortName(sheetName));

  // 1. Exact normalize match against full brand name
  let hit = brands.find((b) => normalize(b.name) === norm);
  if (hit) return { brand: hit, how: "exact" };

  // 2. Exact normalize match against short name (before " - ")
  hit = brands.find((b) => normalize(b.name) === short);
  if (hit) return { brand: hit, how: "short-name" };

  // 3. brands.name starts-with short name (handles "Allergy Smart" → "Allergy Smart")
  hit = brands.find((b) => normalize(b.name).startsWith(short) || short.startsWith(normalize(b.name)));
  if (hit) return { brand: hit, how: "prefix" };

  // 4. Short name of sheet row matches short name of brand name
  const brandsShort = brands.map((b) => ({ b, s: normalize(shortName(b.name)) }));
  hit = brandsShort.find(({ s }) => s === short)?.b;
  if (hit) return { brand: hit, how: "short-short" };

  return null;
}

// ── main ─────────────────────────────────────────────────────────────────────

const INSERT = process.argv.includes("--insert");

const wb = XLSX.readFile(XLSX_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const sheetRows = XLSX.utils.sheet_to_json(ws);

// Fetch all brands from Supabase
const { data: brands, error: brandsErr } = await supabase.from("brands").select("id, name");
if (brandsErr) { console.error("Failed to fetch brands:", brandsErr.message); process.exit(1); }

console.log(`\nLoaded ${sheetRows.length} spreadsheet rows, ${brands.length} brands from DB.\n`);
console.log("═".repeat(72));
console.log("MATCH REPORT");
console.log("═".repeat(72));

const matched = [];   // { sheetName, brand, categories }
const unmatched = []; // sheetName strings

for (const row of sheetRows) {
  const sheetName = (row.brand_name ?? "").trim();
  if (!sheetName) continue;

  const categories = CAT_COLS
    .map((c) => (row[c] ?? "").toString().trim())
    .filter(Boolean);

  const result = bestMatch(sheetName, brands);
  if (result) {
    matched.push({ sheetName, brand: result.brand, how: result.how, categories });
    const flag = result.how === "exact" ? "  " : "~ ";
    console.log(`${flag}${sheetName.padEnd(45)} → "${result.brand.name}" (${result.how})`);
    categories.forEach((c) => console.log(`    • ${c}`));
  } else {
    unmatched.push(sheetName);
  }
}

console.log("\n" + "═".repeat(72));
if (unmatched.length === 0) {
  console.log("✓ All brands matched.");
} else {
  console.log(`✗ UNMATCHED (${unmatched.length}) — these will NOT be inserted:`);
  unmatched.forEach((n) => console.log(`  ✗ ${n}`));
}

// Summary
const totalRows = matched.reduce((s, m) => s + m.categories.length, 0);
console.log(`\nWould upsert ${totalRows} rows across ${matched.length} brands.`);
console.log("═".repeat(72));

if (!INSERT) {
  console.log("\nDRY RUN complete. Re-run with --insert to write to the database.\n");
  process.exit(0);
}

// ── Upsert ──────────────────────────────────────────────────────────────────

console.log("\nInserting…");
let inserted = 0;
let errors = 0;

for (const { brand, categories } of matched) {
  const rows = categories.map((universal_category) => ({
    brand_id: brand.id,
    universal_category,
  }));

  const { error } = await supabase
    .from("brand_category_access")
    .upsert(rows, { onConflict: "brand_id,universal_category", ignoreDuplicates: true });

  if (error) {
    console.error(`  ✗ ${brand.name}: ${error.message}`);
    errors++;
  } else {
    console.log(`  ✓ ${brand.name} (${rows.length} categories)`);
    inserted += rows.length;
  }
}

console.log(`\nDone. ${inserted} rows upserted, ${errors} errors, ${unmatched.length} brands skipped.\n`);
