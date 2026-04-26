-- brand_products: master SKU catalog per brand
create table if not exists public.brand_products (
  id          uuid        primary key default gen_random_uuid(),
  brand_id    uuid        not null references public.brands(id) on delete cascade,
  description text        not null,
  retail_upc  text,
  size        text,
  srp         numeric,
  cost        numeric,
  status      text        not null default 'active',
  created_at  timestamptz not null default now(),
  constraint brand_products_status_check check (status in ('active', 'archived')),
  unique (brand_id, retail_upc)
);

create index if not exists brand_products_brand_id_idx on public.brand_products (brand_id);
create index if not exists brand_products_brand_status_idx on public.brand_products (brand_id, status);

-- RLS
alter table public.brand_products enable row level security;

create policy "Authenticated users read brand_products"
  on public.brand_products for select
  to authenticated
  using (true);

create policy "Authenticated users insert brand_products"
  on public.brand_products for insert
  to authenticated
  with check (true);

create policy "Authenticated users update brand_products"
  on public.brand_products for update
  to authenticated
  using (true)
  with check (true);

-- Link authorized_products rows to a specific brand_product
alter table public.authorized_products
  add column if not exists brand_product_id uuid references public.brand_products(id);
