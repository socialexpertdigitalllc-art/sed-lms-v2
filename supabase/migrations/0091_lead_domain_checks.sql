-- 0091_lead_domain_checks.sql — "is the business's exact name free as a .com?"
-- Checked when a lead turns Ready and kept fresh while it stays Ready
-- (lib/domains/leadCheck.ts); shown on the lead's Domain card.
-- ADDITIVE ONLY (shared prod DB): one new table, no drops.
--
-- One row per lead, replaced on each check. Kept off `leads` on purpose: a
-- check must not bump the lead's updated_at or fire the leads realtime feed.

create table if not exists public.lead_domain_checks (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  -- the exact-name .com that was checked (abcconstruction.com)
  domain text not null,
  -- null = the registrar gave no answer; `error` says why
  available boolean,
  -- why it can't be bought: 'Taken', a premium price, …
  reason text,
  registration_cents integer,
  renewal_cents integer,
  currency text not null default 'USD',
  registrar text check (registrar in ('cloudflare', 'hostinger')),
  error text,
  checked_at timestamptz not null default now()
);

-- Same posture as client_domains: RLS on, no policies — the service role
-- reads and writes it behind the permission checks in /api/leads/[id]/domain-check.
alter table public.lead_domain_checks enable row level security;
