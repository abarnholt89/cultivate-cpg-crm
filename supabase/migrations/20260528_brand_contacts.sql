-- Internal brand contacts directory. Admin/rep-only — clients and owners
-- must not see any of this. RLS is the sole enforcement; no app-level
-- filter is trusted.
create table public.brand_contacts (
  id              uuid        primary key default gen_random_uuid(),
  brand_name      text,
  cultivate_lead  text,
  status          text,
  contact_name    text,
  role            text,
  notes           text,
  email           text,
  phone           text,
  is_day_to_day   boolean     default false,
  website         text,
  created_at      timestamptz not null default now()
);

create index brand_contacts_brand_name_idx on public.brand_contacts (brand_name);
create index brand_contacts_cultivate_lead_idx on public.brand_contacts (cultivate_lead);

alter table public.brand_contacts enable row level security;

-- Admin/rep only — the EXISTS-on-profiles pattern matches other internal
-- gates in this project. Clients/owners get nothing.
create policy brand_contacts_select
  on public.brand_contacts
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'rep')
    )
  );

create policy brand_contacts_insert
  on public.brand_contacts
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'rep')
    )
  );

create policy brand_contacts_update
  on public.brand_contacts
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'rep')
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'rep')
    )
  );

create policy brand_contacts_delete
  on public.brand_contacts
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'rep')
    )
  );
