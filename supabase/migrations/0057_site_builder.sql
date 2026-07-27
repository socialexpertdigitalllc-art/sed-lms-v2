-- 0057_site_builder.sql — Site Builder: two small tables, service-role only.
--
-- FILE ONLY. Do NOT apply — the operator's DB is production; they apply this
-- after review (see AGENTS.md task brief).
--
-- Site Builder is a deliberately small system: the template zip goes to the
-- AI as reference and the AI returns the finished HTML for each page. There
-- is no compiler, no manifest, no tokens, no health/certification gate — see
-- docs/superpowers/plans/2026-07-28-site-builder.md. These two tables are
-- correspondingly small: a template row records nothing about a template's
-- HTML beyond which files are pages and which are assets; a run row records
-- per-page generation state as plain jsonb, not a step machine.
--
-- RLS: enabled, NO policies — service-role routes only, the same posture as
-- every studio_ table (see 0051_studio_templates.sql, 0053_studio_runs.sql).

create table public.builder_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- where the original uploaded zip lives in the builder-templates bucket
  storage_path text not null,
  -- entries from the zip ending in .html — pages the AI rewrites
  page_files text[] not null default '{}',
  -- every other entry (css/js/img/fonts/...) — copied through untouched
  asset_files text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.builder_templates enable row level security;

create table public.builder_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete set null,
  -- not null + restrict: a run is meaningless without the template it was
  -- built from, and must never be silently orphaned from it
  template_id uuid not null references public.builder_templates (id) on delete restrict,
  status text not null default 'queued'
    check (status in ('queued','generating','review','approved','deployed','failed')),
  -- operator choices for this run (e.g. which requested pages to build)
  options jsonb not null default '{}'::jsonb,
  -- images the operator chose for this site: [{ url, purpose }, ...]
  images jsonb not null default '[]'::jsonb,
  -- per-page generation state, keyed by output filename:
  -- { "<file>": { status: "ok"|"failed", kind: "existing"|"new", name?, html?, error? } }
  -- a failed page does not fail the run — the operator regenerates it alone.
  pages jsonb not null default '{}'::jsonb,
  -- storage key of the assembled site zip in builder-sites, once any page succeeds
  output_path text,
  deployed_url text,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index builder_runs_template on public.builder_runs (template_id);
create index builder_runs_lead on public.builder_runs (lead_id);
create index builder_runs_status_created on public.builder_runs (status, created_at desc);

alter table public.builder_runs enable row level security;

-- private buckets: template zips, and assembled output site zips
insert into storage.buckets (id, name, public)
values ('builder-templates', 'builder-templates', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('builder-sites', 'builder-sites', false)
on conflict (id) do nothing;
