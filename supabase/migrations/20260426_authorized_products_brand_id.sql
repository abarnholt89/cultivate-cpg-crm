-- Add brand_id to authorized_products so SKU modal can query by brand+retailer directly
-- instead of joining via UPC through brand_products.
alter table public.authorized_products
  add column if not exists brand_id uuid references public.brands(id) on delete set null;

create index if not exists authorized_products_brand_retailer_idx
  on public.authorized_products (brand_id, retailer_id);
