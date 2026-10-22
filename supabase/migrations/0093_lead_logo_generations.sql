-- 0093_lead_logo_generations.sql — the AI logo generator on the lead page
-- (lib/logos/*). Each press of "Generate logo" (or a Retry) is one row: what
-- was asked, the designs MiniMax drew for it, how each one checked out, and
-- which one (if any) was accepted into the lead's logo_link.
-- ADDITIVE ONLY (shared prod DB): one new table, no drops.
--
-- The drawn designs themselves are PNG files in the public `branding` bucket
-- under lead-logos/<lead>/<generation>/; the accepted one is uploaded to the
-- image host (imgbb) and its direct link goes into leads.logo_link.

create table if not exists public.lead_logo_generations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- new: fresh designs · idea: from the person's own concept · refine: change one design
  mode text not null check (mode in ('new', 'idea', 'refine')),
  -- the generation and design a refine started from
  parent_id uuid references public.lead_logo_generations(id) on delete set null,
  parent_index integer,
  -- the person's words (what to change, or their idea)
  instructions text check (instructions is null or char_length(instructions) <= 1000),
  -- exactly the words on the logo
  logo_text text not null check (char_length(logo_text) between 1 and 80),
  -- running → ready | failed | cancelled
  status text not null default 'running' check (status in ('running', 'ready', 'failed', 'cancelled')),
  -- while running: concepts · drawing · checking · redrawing · finishing
  stage text,
  concepts jsonb not null default '[]'::jsonb,
  candidates jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  -- designs drawn (the company's daily image allowance is counted from this)
  images_drawn integer not null default 0,
  error text,
  accepted_index integer,
  accepted_url text,
  accepted_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One generation at a time per lead.
create unique index if not exists lead_logo_generations_one_running
  on public.lead_logo_generations (lead_id) where status = 'running';
create index if not exists lead_logo_generations_lead_idx
  on public.lead_logo_generations (lead_id, created_at desc);
-- The company's daily image count.
create index if not exists lead_logo_generations_created_idx
  on public.lead_logo_generations (created_at desc);
-- The per-person hourly limit.
create index if not exists lead_logo_generations_user_idx
  on public.lead_logo_generations (user_id, created_at desc);

-- Reads and writes go through the service role behind the checks in
-- /api/leads/[id]/logo/* (lead editing rights); people may read their own.
alter table public.lead_logo_generations enable row level security;
drop policy if exists "read own logo generations" on public.lead_logo_generations;
create policy "read own logo generations" on public.lead_logo_generations
  for select to authenticated using (user_id = auth.uid());
