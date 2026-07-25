-- 0054_studio_assets_and_gate.sql — Site Studio Phase 3b: image library + Gate 1.
--
-- studio_assets is the persistent, human-curated image library (spec §8):
-- every operator-approved image lands here and feeds future runs — library
-- first, Pexels top-up second, NO vision AI in the critical path. Assets are
-- REHOSTED (bytes in our studio-assets bucket), never hot-linked: v2
-- referenced live Pexels URLs and a rotted URL broke a deployed client site.
--
-- kind='client' rows belong to one lead (lead_id set) and must never be
-- offered to any other client; kind='stock' is shared. Enforced by a CHECK
-- here and by every library query filtering (kind = 'stock' or lead_id = X).

create table public.studio_assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('stock','client')),
  -- client-owned assets MUST carry their lead; stock MUST NOT
  lead_id uuid references public.leads (id) on delete set null,
  constraint studio_assets_client_needs_lead
    check ((kind = 'client') = (lead_id is not null)),
  subject text not null default '',
  niche_tags text[] not null default '{}',
  width int not null,
  height int not null,
  source text not null check (source in ('pexels','upload','client_link')),
  pexels_id bigint,
  photographer text,
  storage_path text not null,
  content_type text not null,
  use_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- one library row per Pexels photo — re-picking the same photo reuses the row
create unique index studio_assets_pexels on public.studio_assets (pexels_id)
  where pexels_id is not null;
create index studio_assets_kind_subject on public.studio_assets (kind, subject);
create index studio_assets_lead on public.studio_assets (lead_id) where lead_id is not null;

alter table public.studio_assets enable row level security;

insert into storage.buckets (id, name, public)
values ('studio-assets', 'studio-assets', false)
on conflict (id) do nothing;

-- ---- Gate 1 statuses ------------------------------------------------------
-- 'writing' was only ever assigned at the instant the write phase fully
-- completed; that instant now parks at 'reviewing' (Gate 1) or skips to
-- 'approved' (auto mode). The table is empty pre-cockpit, so the CHECK can
-- simply be replaced. The one-active-per-lead partial index must be recreated
-- to cover the new active statuses, and 'paused' is a flag, not a status —
-- a paused run must remember exactly where it was.

alter table public.studio_runs drop constraint studio_runs_status_check;
alter table public.studio_runs add constraint studio_runs_status_check
  check (status in ('queued','preparing','reviewing','approved','rendering','ready','failed','cancelled'));

drop index public.studio_runs_one_active_per_lead;
create unique index studio_runs_one_active_per_lead
  on public.studio_runs (lead_id)
  where status in ('queued','preparing','reviewing','approved','rendering');

alter table public.studio_runs add column paused boolean not null default false;
