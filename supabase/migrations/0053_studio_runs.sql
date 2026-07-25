-- 0053_studio_runs.sql — Site Studio Phase 3a: generation runs.
--
-- A RUN turns one lead + one certified template into a rendered website.
-- Spec: docs/superpowers/specs/2026-07-23-site-studio-design.md §7, §10.
--
-- THE EXECUTION MODEL, and why the columns look like this. v2 ran a single
-- long-lived process per generation; when a deploy killed it the row sat in
-- `building` forever and needed a heartbeat column, an orphan reaper and a
-- force-resolve endpoint to dig out. A v3 run is instead a chain of SHORT
-- IDEMPOTENT STEPS: each claims itself, does <=30s of work, persists, exits.
-- Nothing long-lived exists, so nothing can be orphaned — a step that dies is
-- simply run again. That is why there is no heartbeat here.
--
--   status: queued -> preparing -> writing -> rendering -> ready -> (deployed, phase 4)
--           plus failed / cancelled, reachable from any active status.
--
-- `content_doc` is the single source of truth for the site's content (spec §6):
-- identity copied verbatim from the lead, per-page slot text written by AI,
-- provenance per field. It lives in-row because every step reads and writes it
-- and it is only strings — keeping it here makes each step's persistence one
-- UPDATE, which is what makes steps cheap enough to be idempotent.
--
-- `steps` records per-step state (including per-page write results and errors)
-- so the cockpit can show a live per-page view and retry ONE page.
--
-- RLS: enabled, no policies — service-role routes only, same as studio_templates.

create table public.studio_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete set null,
  template_id uuid references public.studio_templates (id) on delete restrict,
  -- the package version actually used; a later re-compile must not silently
  -- change what this run was built from
  template_version int not null,
  status text not null default 'queued'
    check (status in ('queued','preparing','writing','rendering','ready','failed','cancelled')),
  -- operator choices for this run (page selection, fan-out toggles, auto mode)
  options jsonb not null default '{}'::jsonb,
  -- the Content Document (spec §6). null until prepare completes.
  content_doc jsonb,
  -- per-step state: { prepare: {...}, write: { pages: { <page_id>: {...} } }, ... }
  steps jsonb not null default '{}'::jsonb,
  -- the lead's own photos, captured at prepare time so a later lead edit
  -- cannot change what this run was built from (phase 3b offers these first)
  client_photos text[] not null default '{}',
  site_slug text,
  -- set by finalize: storage key of the rendered site zip, ready for the
  -- phase-4 deploy handoff
  zip_path text,
  deployed_url text,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One ACTIVE run per lead. Partial unique index rather than a constraint so
-- finished runs (ready/failed/cancelled) accumulate freely as history — this
-- is the ONLY concurrency lock in the design; runs are otherwise independent
-- (v2's globally single-flight processor meant local testing fought prod).
create unique index studio_runs_one_active_per_lead
  on public.studio_runs (lead_id)
  where status in ('queued','preparing','writing','rendering');

create index studio_runs_template on public.studio_runs (template_id);
create index studio_runs_status_created on public.studio_runs (status, created_at desc);

alter table public.studio_runs enable row level security;

-- Append-only audit/progress log. Powers the cockpit timeline and post-mortems.
create table public.studio_run_events (
  id bigserial primary key,
  run_id uuid not null references public.studio_runs (id) on delete cascade,
  step text not null,
  level text not null default 'info' check (level in ('info','warn','error')),
  message text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index studio_run_events_run on public.studio_run_events (run_id, created_at);

alter table public.studio_run_events enable row level security;

-- private bucket for rendered site zips (phase 4 deploy reads from here)
insert into storage.buckets (id, name, public)
values ('studio-sites', 'studio-sites', false)
on conflict (id) do nothing;
