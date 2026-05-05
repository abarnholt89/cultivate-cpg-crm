-- Add distributor-specific pricing columns to brand_products
ALTER TABLE brand_products
  ADD COLUMN IF NOT EXISTS kehe_cost numeric,
  ADD COLUMN IF NOT EXISTS unfi_cost numeric;
