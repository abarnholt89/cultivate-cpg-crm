create table public.tasks (
  id           uuid        primary key default gen_random_uuid(),
  title        text        not null,
  notes        text,
  due_date     date,
  assigned_to  uuid        references public.profiles(id),
  created_by   uuid        references public.profiles(id),
  brand_id     uuid        references public.brands(id),
  retailer_id  uuid        references public.retailers(id),
  status       text        not null default 'open',
  created_at   timestamptz not null default now(),
  constraint tasks_status_check check (status in ('open', 'done'))
);

create index tasks_assigned_to_status_idx on public.tasks (assigned_to, status);
create index tasks_due_date_idx on public.tasks (due_date);
