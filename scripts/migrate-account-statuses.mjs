/**
 * Migrate brand_retailer_timing.account_status to new status codes.
 *
 * Mapping:
 *   active_account                           → awaiting_submission_opportunity
 *   upcoming_review                          → awaiting_submission_opportunity
 *   waiting_for_retailer_to_publish_review   → awaiting_submission_opportunity
 *   open_review                              → in_process
 *   under_review                             → in_process
 *   cultivate_does_not_rep                   → not_a_target_account
 *   (keep) retailer_declined                 → retailer_declined (unchanged)
 *   (keep) not_a_target_account              → not_a_target_account (unchanged)
 *   (keep) working_to_secure_anchor_account  → working_to_secure_anchor_account (unchanged)
 *
 * Step 1 – dry run (default):
 *   node scripts/migrate-account-statuses.mjs
 *
 * Step 2 – apply:
 *   node scripts/migrate-account-statuses.mjs --apply
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

const STATUS_MAP = {
  active_account:                          "awaiting_submission_opportunity",
  upcoming_review:                         "awaiting_submission_opportunity",
  waiting_for_retailer_to_publish_review:  "awaiting_submission_opportunity",
  open_review:                             "in_process",
  under_review:                            "in_process",
  cultivate_does_not_rep:                  "not_a_target_account",
};

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Fetch all rows to migrate
let allRows = [];
let from = 0;
while (true) {
  const { data, error } = await supabase
    .from("brand_retailer_timing")
    .select("id,account_status")
    .range(from, from + 999);
  if (error) { console.error("Fetch error:", error.message); process.exit(1); }
  if (!data?.length) break;
  allRows.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

console.log(`\nLoaded ${allRows.length} brand_retailer_timing rows.\n`);

// Group by old status
const byOld = {};
for (const row of allRows) {
  const old = row.account_status ?? "(null)";
  if (!byOld[old]) byOld[old] = [];
  byOld[old].push(row.id);
}

console.log("Current status distribution:");
for (const [status, ids] of Object.entries(byOld)) {
  const newStatus = STATUS_MAP[status];
  const marker = newStatus ? `→ ${newStatus}` : "(no change)";
  console.log(`  ${status}: ${ids.length} rows  ${marker}`);
}

const toMigrate = Object.entries(STATUS_MAP).filter(([old]) => byOld[old]?.length > 0);
const totalToUpdate = toMigrate.reduce((sum, [old]) => sum + (byOld[old]?.length ?? 0), 0);

console.log(`\n${totalToUpdate} rows will be updated.`);

if (!APPLY) {
  console.log("\n[DRY RUN] Pass --apply to apply these changes.\n");
  process.exit(0);
}

// Apply updates grouped by new status (batch via .in())
const BATCH = 500;
let updatedTotal = 0;

for (const [oldStatus, newStatus] of Object.entries(STATUS_MAP)) {
  const ids = byOld[oldStatus] ?? [];
  if (ids.length === 0) continue;

  console.log(`\nUpdating ${ids.length} rows: "${oldStatus}" → "${newStatus}"…`);
  let updated = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const { error } = await supabase
      .from("brand_retailer_timing")
      .update({ account_status: newStatus })
      .in("id", batch);
    if (error) { console.error("  Update error:", error.message); }
    else { updated += batch.length; }
    process.stdout.write(`\r  Updated ${updated} / ${ids.length}…`);
  }
  console.log(`\n  Done. ${updated} rows updated.`);
  updatedTotal += updated;
}

console.log(`\n\nAll done. ${updatedTotal} rows migrated.\n`);
