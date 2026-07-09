-- 0018_ticket_v2.sql — attachments, SLA/retention, due-date/escalation

create table if not exists public.ticket_item_attachments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.ticket_items(id) on delete cascade,
  path text not null,
  mime text,
  size int,
  created_at timestamptz not null default now()
);
create index if not exists ticket_item_attachments_item_idx on public.ticket_item_attachments (item_id);
alter table public.ticket_item_attachments enable row level security;
create policy "read ticket item attachments" on public.ticket_item_attachments for select to authenticated
  using (exists (
    select 1 from public.ticket_items ti
    join public.lead_tickets t on t.id = ti.ticket_id
    where ti.id = item_id));

alter table public.lead_tickets
  add column if not exists due_date timestamptz,
  add column if not exists escalated_at timestamptz;

alter table public.app_settings
  add column if not exists ticket_sla jsonb not null default '{"Low":168,"Normal":72,"High":24}',
  add column if not exists ticket_retention_days int not null default 0;

insert into storage.buckets (id, name, public)
values ('ticket-attachments', 'ticket-attachments', false)
on conflict (id) do nothing;
