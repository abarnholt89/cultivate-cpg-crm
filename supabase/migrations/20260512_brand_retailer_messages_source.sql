-- Add source column to track message origin (e.g. 'gmail_addon')
ALTER TABLE brand_retailer_messages ADD COLUMN IF NOT EXISTS source text;

-- Backfill existing Gmail add-on mirrored messages
UPDATE brand_retailer_messages
SET source = 'gmail_addon'
WHERE body ILIKE '%Your Cultivate rep made an introduction%'
   OR body ILIKE '%Your Cultivate rep followed up%'
   OR body ILIKE '%Your Cultivate rep submitted%';
