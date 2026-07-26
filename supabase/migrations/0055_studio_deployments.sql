-- 0055_studio_deployments.sql — Site Studio Phase 4a: deployed sites.
--
-- One row per deployed client site (spec §10). New Site Studio runs write here;
-- at cutover (Phase 4b) v2's live deployment records are seeded into this same
-- table, so the deployments board manages old and new sites through one
-- surface and takedown/redeploy of pre-v3 sites keeps working forever.
--
-- `subdomain` is unique: one live site per subdomain, and the ON CONFLICT path
-- is what makes redeploy idempotent. `lead_id` is NOT unique — a lead's
-- history may include a taken-down site and its replacement — but the partial
-- index below enforces one LIVE site per lead, which is the real invariant.
--
-- RLS: enabled, no policies — service-role routes only, matching every other
-- studio_ table.

create table public.studio_deployments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete set null,
  -- the run that produced this deployment; null for rows seeded from v2 at
  -- cutover, which have no studio run behind them
  run_id uuid references public.studio_runs (id) on delete set null,
  subdomain text not null unique,
  docroot text not null,
  url text not null,
  status text not null default 'live' check (status in ('live','taken_down','failed')),
  -- 'studio' for rows this phase writes, 'v2_import' for cutover-seeded rows,
  -- so a post-mortem can always tell where a site came from
  origin text not null default 'studio' check (origin in ('studio','v2_import')),
  deployed_at timestamptz not null default now(),
  taken_down_at timestamptz,
  deployed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One LIVE site per lead. Taken-down and failed rows accumulate as history.
create unique index studio_deployments_one_live_per_lead
  on public.studio_deployments (lead_id)
  where status = 'live' and lead_id is not null;

create index studio_deployments_status on public.studio_deployments (status, deployed_at desc);
create index studio_deployments_run on public.studio_deployments (run_id);

alter table public.studio_deployments enable row level security;
