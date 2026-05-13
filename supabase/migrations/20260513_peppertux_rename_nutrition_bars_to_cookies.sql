-- Rename "Nutrition Bars" → "Cookies" for Peppertux in both tables.
-- brand_id: 8b43d662-563a-4f26-9415-6195155f4b67

BEGIN;

-- 1. Rename in brand_retailer_timing (the rows that drive board display)
UPDATE brand_retailer_timing
SET universal_category = 'Cookies'
WHERE brand_id = '8b43d662-563a-4f26-9415-6195155f4b67'
  AND universal_category = 'Nutrition Bars';

-- 2. Ensure brand_category_access reflects the new set
DELETE FROM brand_category_access
WHERE brand_id = '8b43d662-563a-4f26-9415-6195155f4b67'
  AND universal_category = 'Nutrition Bars';

INSERT INTO brand_category_access (brand_id, universal_category)
VALUES ('8b43d662-563a-4f26-9415-6195155f4b67', 'Cookies')
ON CONFLICT DO NOTHING;

COMMIT;
