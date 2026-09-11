-- 0077_lead_area_category.sql — manual area override + lead categories.
--
-- AREA: leads.custom_area. The region a lead files under has always been
-- derived from the phone's area code (lib/geo), but a customer sometimes
-- keeps a number from somewhere they no longer live. When set, this manual
-- state wins everywhere the derived region was used (filters, facets).
--
-- CATEGORY: a shared, growing catalog. Starts empty; agents add names at
-- submission time when the list lacks one (case-insensitively unique). The
-- lead carries the NAME as text, not an FK — the catalog is a suggestion
-- list, and a catalog row deleted later must not blank historical leads.
--
-- RLS on lead_categories: enabled with NO policies — all access via the
-- service-role client behind explicit permission checks (same posture as
-- studio_* / form_*).

alter table public.leads
  add column if not exists custom_area text,
  add column if not exists category text;

comment on column public.leads.custom_area is
  'Manual area (US state) override — wins over the phone-derived region when set.';
comment on column public.leads.category is
  'Business category name, from the shared lead_categories catalog (stored as text).';

create table if not exists public.lead_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists lead_categories_name_ci on public.lead_categories (lower(name));

alter table public.lead_categories enable row level security;
