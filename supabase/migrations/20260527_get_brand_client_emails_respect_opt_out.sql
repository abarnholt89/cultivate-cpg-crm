-- Redefine get_brand_client_emails to skip brand_users who have opted out
-- of email notifications. Used by /api/run-promo-alerts when picking promo
-- alert recipients. Returns one row per opted-in user with a usable email.
--
-- NOTE: the prior definition lived only in the Supabase project (not in this
-- repo), so this replacement assumes the simplest reasonable shape:
-- brand_users → auth.users join, filtered by brand_id and the new
-- email_notifications_enabled flag. If the original had additional logic
-- (e.g., role filtering, bounce suppression), reapply it here.
CREATE OR REPLACE FUNCTION public.get_brand_client_emails(p_brand_id uuid)
RETURNS TABLE(email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.email::text
  FROM brand_users bu
  JOIN auth.users u ON u.id = bu.user_id
  WHERE bu.brand_id = p_brand_id
    AND COALESCE(bu.email_notifications_enabled, true) = true
    AND u.email IS NOT NULL;
$$;
