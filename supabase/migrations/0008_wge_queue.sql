-- WGE-2: website-generation queue (serial, in-app processor)

create table if not exists public.wge_queue (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tool text not null,
  model text not null,
  status text not null default 'pending',  -- pending | processing | done | failed
  attempts integer not null default 0,
  generation_id uuid references public.ai_generations(id) on delete set null,
  error text,
  enqueued_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create unique index if not exists uniq_wge_queue_active_lead
  on public.wge_queue (lead_id) where status in ('pending','processing');
create index if not exists idx_wge_queue_status_created on public.wge_queue (status, created_at);
create index if not exists idx_wge_queue_enqueued_by on public.wge_queue (enqueued_by);

alter table public.wge_queue enable row level security;

create policy "read wge_queue own or manage" on public.wge_queue for select to authenticated
  using (enqueued_by = auth.uid() or public.has_permission('wge.manage'));

create or replace function public.wge_reclaim_stale() returns void
language sql security definer set search_path = public as $$
  update public.wge_queue
     set status = 'pending', error = 'reclaimed after timeout'
   where status = 'processing' and started_at < now() - interval '10 minutes';
$$;

create or replace function public.wge_claim_next() returns setof public.wge_queue
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(8273);
  return query
  update public.wge_queue q
     set status = 'processing', started_at = now(), attempts = attempts + 1
   where q.id = (
     select c.id from public.wge_queue c
      where c.status = 'pending'
        and not exists (select 1 from public.wge_queue p where p.status = 'processing')
      order by c.created_at
      limit 1
      for update skip locked
   )
  returning q.*;
end;
$$;
