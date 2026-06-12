-- Tighten the "standard retailer set" used by seed_brand_retailer_timing_for_brand
-- so it never auto-seeds rows against zombie/one-off retailers (rows in the
-- retailers table whose rep_owner_user_id IS NULL — historical imports, dead
-- accounts, etc). The previous definition only filtered on the >=60 distinct
-- brands threshold, which happily included these zombies if they happened to
-- appear in brand_retailer_timing for enough brands.
--
-- Function shape is otherwise unchanged: same signature, same SECURITY DEFINER,
-- same NOT EXISTS dedupe on (brand_id, retailer_id, universal_category).

create or replace function public.seed_brand_retailer_timing_for_brand(p_brand_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.brand_retailer_timing
    (brand_id, retailer_id, universal_category, account_status)
  select
    p_brand_id,
    r.retailer_id,
    c.universal_category,
    'awaiting_submission_opportunity'
  from (
    -- Standard retailer set: retailers that
    --   (a) appear in brand_retailer_timing for >= 60 distinct brands AND
    --   (b) are assigned to a rep (rep_owner_user_id IS NOT NULL).
    select brt.retailer_id
    from public.brand_retailer_timing brt
    join public.retailers ret on ret.id = brt.retailer_id
    where ret.rep_owner_user_id is not null
    group by brt.retailer_id
    having count(distinct brt.brand_id) >= 60
  ) as r
  cross join (
    select universal_category
    from public.brand_category_access
    where brand_id = p_brand_id
      and universal_category is not null
  ) as c
  where not exists (
    select 1
    from public.brand_retailer_timing existing
    where existing.brand_id = p_brand_id
      and existing.retailer_id = r.retailer_id
      and existing.universal_category = c.universal_category
  );
end;
$$;
