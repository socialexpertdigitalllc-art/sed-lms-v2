-- 0017_tickets.sql — lead ticketing system

create table if not exists public.lead_tickets (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  category text not null check (category in ('Changes','Improvement')),
  signature text not null check (signature in ('Agent','Closer')),
  priority text not null default 'Normal' check (priority in ('Low','Normal','High')),
  status text not null default 'Open' check (status in ('Open','Assigned','In Progress','Resolved')),
  assigned_to uuid references public.profiles(id) on delete set null,
  title text,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);
create index if not exists lead_tickets_lead_created_idx on public.lead_tickets (lead_id, created_at desc);
create index if not exists lead_tickets_status_idx on public.lead_tickets (status);
create index if not exists lead_tickets_assigned_idx on public.lead_tickets (assigned_to);

create table if not exists public.ticket_items (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.lead_tickets(id) on delete cascade,
  body text not null,
  is_done boolean not null default false,
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ticket_items_ticket_sort_idx on public.ticket_items (ticket_id, sort);

alter table public.lead_tickets enable row level security;
alter table public.ticket_items enable row level security;
create policy "read tickets" on public.lead_tickets for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy "read ticket items" on public.ticket_items for select to authenticated
  using (exists (select 1 from public.lead_tickets t join public.leads l on l.id = t.lead_id where t.id = ticket_id));

alter table public.notifications add column if not exists target_url text;

alter table public.lead_tickets replica identity full;
alter table public.ticket_items replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.lead_tickets;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.ticket_items;
exception when duplicate_object then null; end $$;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('tickets.view','View Tickets',null,'tickets',false),
  ('tickets.create','Open Tickets',null,'tickets',false),
  ('tickets.assign','Assign Tickets',null,'tickets',true),
  ('tickets.resolve','Resolve Tickets',null,'tickets',false)
on conflict (key) do nothing;
insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('tickets.view'),('tickets.create'),('tickets.assign'),('tickets.resolve')) as k(key)
  where (d.slug, k.key) in (
    ('sales','tickets.view'),('sales','tickets.create'),
    ('tech','tickets.view'),('tech','tickets.resolve'),
    ('management','tickets.view'),('management','tickets.assign'),
    ('admin','tickets.view'),('admin','tickets.create'),('admin','tickets.assign'),('admin','tickets.resolve')
  )
on conflict do nothing;
