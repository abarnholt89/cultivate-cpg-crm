-- Per-user opt-out flag for outbound email notifications.
-- Defaults to true so existing brand_users keep receiving emails;
-- users (or admins) can flip to false to silence emails for that
-- brand_user pairing without losing access to the brand in the app.
ALTER TABLE brand_users
  ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean DEFAULT true;
