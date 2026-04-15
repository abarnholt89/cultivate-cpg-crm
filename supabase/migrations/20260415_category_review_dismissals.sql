-- Allows reps/admins to dismiss a category review row for a specific brand
-- so it no longer appears in the table until un-dismissed.
CREATE TABLE IF NOT EXISTS brand_category_review_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  retailer_name text NOT NULL,
  retailer_id uuid REFERENCES retailers(id) ON DELETE SET NULL,
  universal_category text NOT NULL,
  retailer_category_review_name text NOT NULL DEFAULT '',
  review_date date,
  dismissed_by_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, retailer_name, universal_category, retailer_category_review_name)
);

-- Allows reps/admins to override the review_date / reset_date shown in the UI
-- without touching the underlying source table (brand_category_review_view).
CREATE TABLE IF NOT EXISTS brand_category_review_date_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  retailer_name text NOT NULL,
  retailer_id uuid REFERENCES retailers(id) ON DELETE SET NULL,
  universal_category text NOT NULL,
  retailer_category_review_name text NOT NULL DEFAULT '',
  review_date date,
  reset_date date,
  updated_by_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, retailer_name, universal_category, retailer_category_review_name)
);

-- RLS: allow authenticated users to read/write their own brand's records
ALTER TABLE brand_category_review_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_category_review_date_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth users full access dismissals"
  ON brand_category_review_dismissals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "auth users full access date overrides"
  ON brand_category_review_date_overrides
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
