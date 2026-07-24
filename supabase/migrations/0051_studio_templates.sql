-- 0051_studio_templates.sql — Site Studio (template engine v3) Phase 2a.
--
-- The v3 rebuild's first table. Coexists with the old engine's
-- website_templates: zero shared objects, studio_ prefix throughout, so the
-- eventual old-engine teardown is a grep. Spec:
-- docs/superpowers/specs/2026-07-23-site-studio-design.md §10.
--
-- A row is a TEMPLATE PACKAGE in one of six states:
--   uploaded      source.zip stored; not yet compiled (or last compile hit
--                 blocker diagnostics — the diagnostics column says which)
--   needs_review  compiled clean; awaiting human review / AI enrichment
--   certified     human pressed Certify; usable for generation (Phase 3)
--   rejected      human rejected the template outright
--   disabled      certified but withheld from new runs
--
-- The compiled package's MANIFEST lives here (jsonb — it is the contract the
-- board and the renderer read constantly); the package's page/fragment/asset
-- FILES live in the studio-templates bucket under {id}/package/*, with the
-- original upload immutable at {id}/source.zip (re-compile anytime).
--
-- RLS: enabled with NO policies — service-role routes only, same posture as
-- the rest of the app's server-owned tables.

create table public.studio_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded','needs_review','certified','rejected','disabled')),
  -- bumped on every re-compile; generations (Phase 3) record the version used
  version int not null default 1,
  storage_prefix text not null,
  niche_tags text[] not null default '{}',
  -- the compiled TemplateManifest (lib/site-studio/schema.ts) — null until
  -- the first successful compile
  manifest jsonb,
  -- full Diagnostic[] from the last compile + enrichments, newest run replaces
  diagnostics jsonb not null default '[]'::jsonb,
  compiled_at timestamptz,
  identity_enriched_at timestamptz,
  semantics_enriched_at timestamptz,
  certified_by uuid references auth.users (id) on delete set null,
  certified_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.studio_templates enable row level security;

-- private bucket for source zips + compiled packages
insert into storage.buckets (id, name, public)
values ('studio-templates', 'studio-templates', false)
on conflict (id) do nothing;
