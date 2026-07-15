-- 0034_template_engine_v2.sql — content-model engine + curation + gates

-- v2 pipeline state. v1 rows keep 'ready_for_review'/'deployed'.
-- The old constraint was created inline in 0026 and auto-named by Postgres.
alter table public.template_generations drop constraint if exists template_generations_status_check;
alter table public.template_generations add constraint template_generations_status_check
  check (status in ('queued','running','planning','curating','building','review','ready_for_review','deployed','failed'));

alter table public.template_generations
  add column if not exists brief jsonb,           -- frozen full-lead snapshot used for this run
  add column if not exists content_model jsonb,   -- the editable source of truth
  add column if not exists image_slots jsonb,     -- Phase 2 curation state
  add column if not exists options jsonb not null default '{"exclude_people": true}'::jsonb,
  add column if not exists gate_results jsonb;    -- verification report

-- Demo identity tokens auto-derived at template upload; the leak gate fails the
-- build if ANY of these survive into generated output.
alter table public.website_templates
  add column if not exists demo_tokens jsonb not null default '[]'::jsonb;

-- Reserved for the deferred image-preservation library (unused for now).
create table if not exists public.curated_images (
  id uuid primary key default gen_random_uuid(),
  service_key text not null,
  business_type text,
  url text not null,
  thumb text,
  source text not null default 'pexels',
  vision jsonb,
  approved_by uuid references public.profiles(id) on delete set null,
  times_used int not null default 0,
  created_at timestamptz not null default now(),
  unique (service_key, url)
);
create index if not exists curated_images_lookup_idx on public.curated_images (service_key, business_type);
alter table public.curated_images enable row level security;
drop policy if exists "read curated images" on public.curated_images;
create policy "read curated images" on public.curated_images for select to authenticated
  using (public.has_permission('templates.generate') or public.has_permission('templates.manage'));
drop policy if exists "write curated images" on public.curated_images;
create policy "write curated images" on public.curated_images for all to authenticated
  using (public.has_permission('templates.manage')) with check (public.has_permission('templates.manage'));
