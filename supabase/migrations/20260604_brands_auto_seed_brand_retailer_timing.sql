-- Auto-seed brand_retailer_timing rows when a new brand is inserted, AND
-- whenever a new category is granted to a brand via brand_category_access.
--
-- Two triggers, one shared seeder function:
--   * brands AFTER INSERT — catches the rare case where brand_category_access
--     rows are inserted in the same transaction (or already exist) before the
--     brand row. Usually a no-op.
--   * brand_category_access AFTER INSERT — the realistic seed moment. Fires
--     once per category granted, seeding (standard retailers × that category)
--     for the brand. NOT EXISTS dedupes so previously-seeded combos are
--     skipped silently.
--
-- Seeded rows use:
--   account_status     = 'awaiting_submission_opportunity'
--   universal_category = each row from brand_category_access for the brand
--   retailer_id        = each retailer in the "standard set"
--
-- "Standard set" = retailers that appear in brand_retailer_timing for >= 60
-- distinct brands, recomputed at each trigger fire. This adapts as the org
-- grows; if a new chain crosses the threshold, future brand creations include
-- it automatically.
--
-- Duplicates are guarded with NOT EXISTS on (brand_id, retailer_id,
-- universal_category) rather than ON CONFLICT, because we don't know that a
-- unique constraint exists on that triple.

-- ── 1. Reusable seeder function ──────────────────────────────────────────
-- SECURITY DEFINER so it bypasses RLS on brand_retailer_timing — the trigger
-- needs to write regardless of who created the brand. search_path is pinned
-- to public to prevent search-path injection.
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
    -- Standard retailer set: retailers used by >= 60 distinct brands
    select retailer_id
    from public.brand_retailer_timing
    group by retailer_id
    having count(distinct brand_id) >= 60
  ) as r
  cross join (
    -- The new brand's allowed categories
    select universal_category
    from public.brand_category_access
    where brand_id = p_brand_id
      and universal_category is not null
  ) as c
  where not exists (
    -- Skip (brand, retailer, category) combos that already have a row
    select 1
    from public.brand_retailer_timing existing
    where existing.brand_id = p_brand_id
      and existing.retailer_id = r.retailer_id
      and existing.universal_category = c.universal_category
  );
end;
$$;

-- ── 2. Trigger wrapper on brands ────────────────────────────────────────
create or replace function public.tg_brands_seed_timing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_brand_retailer_timing_for_brand(new.id);
  return new;
end;
$$;

drop trigger if exists brands_seed_timing_trigger on public.brands;
create trigger brands_seed_timing_trigger
  after insert on public.brands
  for each row
  execute function public.tg_brands_seed_timing();

-- ── 3. Trigger wrapper on brand_category_access ─────────────────────────
-- The realistic seed moment — fires whenever a category is granted to a
-- brand. Reuses the same seeder so the NOT EXISTS guard prevents duplicates
-- if the brands trigger already seeded something.
create or replace function public.tg_brand_category_access_seed_timing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_brand_retailer_timing_for_brand(new.brand_id);
  return new;
end;
$$;

drop trigger if exists brand_category_access_seed_timing_trigger on public.brand_category_access;
create trigger brand_category_access_seed_timing_trigger
  after insert on public.brand_category_access
  for each row
  execute function public.tg_brand_category_access_seed_timing();
