-- Add per-brand flag to gate outbound message email notifications.
-- Defaults to false so no brand receives notifications until explicitly opted in.
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS message_notifications_enabled boolean NOT NULL DEFAULT false;
