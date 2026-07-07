-- Append-only lead follow-up log + denormalized signals on leads.
create table if not exists public.lead_follow_ups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  fu_status text not null,                 -- 'Pickup' | 'No Pickup'
  comments text,
  next_follow_up_time timestamptz,
  status_change text,
  created_at timestamptz not null default now()
);
create index if not exists lead_follow_ups_lead_created_idx
  on public.lead_follow_ups (lead_id, created_at desc);

alter table public.leads add column if not exists last_followup_status text;
alter table public.leads add column if not exists no_pickup_streak int not null default 0;

alter table public.lead_follow_ups enable row level security;
drop policy if exists "read lead follow-ups" on public.lead_follow_ups;
create policy "read lead follow-ups" on public.lead_follow_ups
  for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('leads.followup','Log Lead Follow-ups','Record follow-up calls and outcomes on leads','leads',false)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
select distinct department_id, 'leads.followup' from public.department_permissions
where permission_key in ('pre_leads.followup','leads.edit')
on conflict do nothing;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lead_follow_ups') then
    alter publication supabase_realtime add table public.lead_follow_ups;
  end if;
end $$;
alter table public.lead_follow_ups replica identity full;
