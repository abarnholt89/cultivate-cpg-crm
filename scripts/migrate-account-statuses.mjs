/**
 * Generate SQL to migrate brand_retailer_timing.account_status to new status codes.
 *
 * This script PRINTS SQL — paste the output into the Supabase SQL editor and run it.
 * It does not connect to the database itself.
 *
 * Usage:
 *   node scripts/migrate-account-statuses.mjs
 *
 * What the generated SQL does (all in one transaction):
 *   1. Drops the existing account_status CHECK constraint
 *   2. Remaps old status values to new codes
 *   3. Maps 'unassigned' → NULL (blank)
 *   4. Adds a new CHECK constraint with only the new allowed values
 */

const SQL = `
-- ══════════════════════════════════════════════════════════════════
-- Account status migration — paste into Supabase SQL editor and run
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- Step 1: Drop the existing check constraint so updates are not blocked
ALTER TABLE public.brand_retailer_timing
  DROP CONSTRAINT IF EXISTS brand_retailer_timing_account_status_check;

-- Step 2: Remap old status values to new codes
UPDATE public.brand_retailer_timing
  SET account_status = 'awaiting_submission_opportunity'
  WHERE account_status IN (
    'active_account',
    'upcoming_review',
    'waiting_for_retailer_to_publish_review'
  );

UPDATE public.brand_retailer_timing
  SET account_status = 'in_process'
  WHERE account_status IN (
    'open_review',
    'under_review'
  );

UPDATE public.brand_retailer_timing
  SET account_status = 'not_a_target_account'
  WHERE account_status = 'cultivate_does_not_rep';

-- Step 3: Map 'unassigned' → NULL (blank / no status)
UPDATE public.brand_retailer_timing
  SET account_status = NULL
  WHERE account_status = 'unassigned';

-- Step 4: Verify — should show only the new allowed values (or NULL)
SELECT account_status, COUNT(*) AS count
  FROM public.brand_retailer_timing
  GROUP BY account_status
  ORDER BY count DESC;

-- Step 5: Add new check constraint
ALTER TABLE public.brand_retailer_timing
  ADD CONSTRAINT brand_retailer_timing_account_status_check
  CHECK (account_status IS NULL OR account_status IN (
    'awaiting_submission_opportunity',
    'in_process',
    'retailer_declined',
    'not_a_target_account',
    'working_to_secure_anchor_account'
  ));

COMMIT;
`;

console.log(SQL);
