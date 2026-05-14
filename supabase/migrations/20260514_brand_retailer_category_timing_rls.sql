-- RLS policies for brand_retailer_category_timing
-- This table was created outside migrations; adding RLS here so SELECT and
-- upsert work for authenticated reps on the board page.

-- Enable RLS if not already on (safe to run if already enabled)
ALTER TABLE public.brand_retailer_category_timing ENABLE ROW LEVEL SECURITY;

-- Allow any authenticated user to read all rows.
-- Reps need to read rows for any brand they manage, and the table has no
-- sensitive PII — brand/retailer/date data only.
CREATE POLICY "authenticated_select"
  ON public.brand_retailer_category_timing
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert new rows.
CREATE POLICY "authenticated_insert"
  ON public.brand_retailer_category_timing
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update rows.
CREATE POLICY "authenticated_update"
  ON public.brand_retailer_category_timing
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
