-- Tracks which distributor DCs (UNFI / KeHE) carry each brand product
create table if not exists public.distributor_dc_listings (
  id                uuid        primary key default gen_random_uuid(),
  brand_product_id  uuid        not null references public.brand_products(id) on delete cascade,
  distributor       text        not null,   -- 'UNFI' or 'KeHE'
  dc_code           text        not null,   -- e.g. 'ATL', 'AUR'
  dc_name           text,                   -- e.g. 'Atlanta, GA'
  listed            boolean     not null default false,
  created_at        timestamptz not null default now(),
  constraint distributor_dc_listings_uq unique (brand_product_id, distributor, dc_code)
);

create index if not exists distributor_dc_listings_brand_idx
  on public.distributor_dc_listings (brand_product_id);

-- RLS: mirror brand_products policies
alter table public.distributor_dc_listings enable row level security;

create policy "distributor_dc_listings_select" on public.distributor_dc_listings
  for select using (true);

create policy "distributor_dc_listings_all" on public.distributor_dc_listings
  for all using (true) with check (true);
