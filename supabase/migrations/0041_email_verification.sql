-- 0041_email_verification.sql — email verification engine (local checks + Verifalia/Reoon).
-- ADDITIVE ONLY. Shared prod DB: new tables only. No drops, no type changes,
-- no edits to existing columns.

-- One row per normalized address. `normalized_email` is UNIQUE and IS the cache
-- key: a given address is never billed to a provider twice. The verdict is
-- derived data — `provider_raw` keeps the vendor's untouched payload so a
-- future change to our mapping can be replayed offline, without re-billing.
create table if not exists public.email_verifications (
  id uuid primary key default gen_random_uuid(),
  normalized_email text not null unique,
  domain text not null,
  local_result jsonb not null default '{}'::jsonb,
  provider text,
  provider_status text,
  provider_raw jsonb,
  verdict text not null check (verdict in ('BLOCK','WARN','OK')),
  reasons text[] not null default '{}',
  verified_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists email_verifications_domain_idx on public.email_verifications (domain);
create index if not exists email_verifications_verified_at_idx on public.email_verifications (verified_at desc);

-- Per-DOMAIN DNS cache. Twenty leads at one company cost one MX lookup.
create table if not exists public.email_domain_dns (
  domain text primary key,
  has_mx boolean not null default false,
  null_mx boolean not null default false,
  has_addr boolean not null default false,
  checked_at timestamptz not null default now()
);

-- Provider quota bookkeeping. `exhausted_until` is set REACTIVELY from the
-- provider's own quota response (authoritative) and lifts when the free-tier
-- period rolls over; `period_key` + `calls_used` are our PROACTIVE counter
-- (Verifalia 25/day, Reoon 600/month), which may drift and therefore loses
-- to the provider whenever the two disagree.
create table if not exists public.email_verify_provider_state (
  provider text primary key,
  exhausted_until timestamptz,
  last_error text,
  period_key text not null default '',
  calls_used integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.email_verify_provider_state (provider) values ('verifalia'), ('reoon')
on conflict (provider) do nothing;

-- RLS
alter table public.email_verifications enable row level security;
alter table public.email_domain_dns enable row level security;
alter table public.email_verify_provider_state enable row level security;

-- Reads for signed-in users, mirroring the contract_templates pattern in 0037.
-- All writes go through the service role inside the auth-gated API route.
create policy "read email verifications" on public.email_verifications for select to authenticated
  using (true);

create policy "read email domain dns" on public.email_domain_dns for select to authenticated
  using (true);

-- Provider state is operational plumbing (and holds vendor error text):
-- service-role only, no select policy.
