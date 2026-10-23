-- get_rep_aging_accounts was created directly in the database (not through
-- migrations). This file documents the live definition for version control.
-- No behavior change — this CREATE OR REPLACE matches what is already live,
-- including its existing archived/inactive-brand exclusion
-- (coalesce(b.archived, false) = false and coalesce(b.brand_status, '') <> 'Inactive').

CREATE OR REPLACE FUNCTION public.get_rep_aging_accounts(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(brand_retailer_timing_id uuid, brand_id uuid, retailer_id uuid, retailer_name text,
               account_status text, last_activity_at timestamptz, last_status_change_at timestamptz,
               aging_bucket text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = public
AS $function$
  select
    brt.id, brt.brand_id, brt.retailer_id, r.name,
    brt.account_status::text, brt.last_activity_at, brt.last_status_change_at,
    case
      when brt.last_activity_at is not null and brt.last_activity_at < now() - interval '60 days' then '60+ days'
      when brt.last_activity_at is not null and brt.last_activity_at < now() - interval '30 days' then '30+ days'
      when brt.last_activity_at is null and brt.created_at < now() - interval '60 days' then '60+ days'
      when brt.last_activity_at is null and brt.created_at < now() - interval '30 days' then '30+ days'
      else null
    end
  from brand_retailer_timing brt
  join retailers r on r.id = brt.retailer_id
  join brands b on b.id = brt.brand_id
  join profiles me on me.id = auth.uid()
  where me.role in ('rep', 'admin')
    and r.rep_owner_user_id = auth.uid()
    and coalesce(b.archived, false) = false
    and coalesce(b.brand_status, '') <> 'Inactive'
    and brt.account_status in ('open_review','under_review','working_to_secure_anchor_account',
                               'waiting_for_retailer_to_publish_review','upcoming_review')
    and ((brt.last_activity_at is not null and brt.last_activity_at < now() - interval '30 days')
      or (brt.last_activity_at is null and brt.created_at < now() - interval '30 days'))
  order by
    case
      when brt.last_activity_at is not null and brt.last_activity_at < now() - interval '60 days' then 1
      when brt.last_activity_at is null and brt.created_at < now() - interval '60 days' then 1
      else 2
    end,
    brt.last_activity_at asc nulls first
  limit p_limit offset p_offset;
$function$;
