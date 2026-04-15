-- Allow any authenticated user to read profiles where role is rep or admin.
-- This is needed so that admin users can populate the "Filter by rep" dropdown
-- on the board page with all team members, not just their own profile.
-- Without this policy the client-side Supabase query returns only the current
-- user's own row due to the existing "users can view own profile" RLS policy.

DROP POLICY IF EXISTS "Authenticated users can read rep and admin profiles" ON profiles;

CREATE POLICY "Authenticated users can read rep and admin profiles"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (role IN ('rep', 'admin'));
