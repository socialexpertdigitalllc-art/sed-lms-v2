-- 0080_domain_management.sql — manage every domain from the dashboard
-- (expired ones included) and measure them: registrar facts kept in sync,
-- site health checks with history, and alerts for renewals and outages.
-- ADDITIVE ONLY. Shared prod DB (ikuvbxjkoojtgekapbul): new nullable columns
-- on client_domains, one new table, two read functions, two notification-rule
-- rows. No drops, no type changes, no constraint changes — the deployed code
-- keeps working before the new code ships. Applied via the Supabase MCP
-- BEFORE the code deploy.

-- Registrar facts, refreshed by the background sync -------------------------
alter table public.client_domains
  -- the registration as the registrar reports it: active | expired | pending |
  -- missing (no longer in the account — moved, transferred out or deleted)
  add column if not exists registrar_status text,
  add column if not exists registered_at timestamptz,
  -- when the registrar next charges for the renewal (Hostinger bills 27 days
  -- before expiry; Cloudflare at expiry)
  add column if not exists next_billing_at timestamptz,
  add column if not exists synced_at timestamptz,
  -- registrar settings snapshot: lock, privacy, nameservers, subscription
  -- status, an outgoing move in progress, …
  add column if not exists details jsonb not null default '{}'::jsonb,
  -- latest site health check: up | down | ssl_error | parked | no_dns
  add column if not exists health_state text,
  add column if not exists health jsonb not null default '{}'::jsonb,
  add column if not exists health_checked_at timestamptz;

-- Site health history (one row per check; kept 90 days) -----------------------
create table if not exists public.client_domain_checks (
  id bigint generated always as identity primary key,
  domain_id uuid not null references public.client_domains(id) on delete cascade,
  checked_at timestamptz not null default now(),
  state text not null check (state in ('up','down','ssl_error','parked','no_dns')),
  http_status int,
  ms int,
  ssl_valid_to timestamptz,
  error text
);

create index if not exists client_domain_checks_domain_time
  on public.client_domain_checks (domain_id, checked_at desc);
create index if not exists client_domain_checks_time
  on public.client_domain_checks (checked_at);

-- Same posture as client_domains: RLS on, no policies — the service-role
-- client behind an explicit permission check is the only reader/writer.
alter table public.client_domain_checks enable row level security;

-- Uptime per domain since a moment. "counted" leaves out checks where there is
-- no site to measure (parked / no DNS).
create or replace function public.client_domain_uptime(since timestamptz)
returns table (domain_id uuid, checks bigint, up bigint, counted bigint, avg_ms numeric, last_down_at timestamptz)
language sql stable
set search_path = public
as $$
  select c.domain_id,
         count(*),
         count(*) filter (where c.state = 'up'),
         count(*) filter (where c.state in ('up','down','ssl_error')),
         round(avg(c.ms) filter (where c.state = 'up')),
         max(c.checked_at) filter (where c.state in ('down','ssl_error'))
  from public.client_domain_checks c
  where c.checked_at >= since
  group by c.domain_id
$$;

-- Portfolio-wide uptime per UTC day since a moment.
create or replace function public.client_domain_uptime_daily(since timestamptz)
returns table (day date, up bigint, counted bigint, avg_ms numeric)
language sql stable
set search_path = public
as $$
  select (c.checked_at at time zone 'utc')::date,
         count(*) filter (where c.state = 'up'),
         count(*) filter (where c.state in ('up','down','ssl_error')),
         round(avg(c.ms) filter (where c.state = 'up'))
  from public.client_domain_checks c
  where c.checked_at >= since
  group by 1
  order by 1
$$;

-- Server-only, like the table they read.
revoke execute on function public.client_domain_uptime(timestamptz) from public, anon, authenticated;
revoke execute on function public.client_domain_uptime_daily(timestamptz) from public, anon, authenticated;
grant execute on function public.client_domain_uptime(timestamptz) to service_role;
grant execute on function public.client_domain_uptime_daily(timestamptz) to service_role;

-- Alerts ----------------------------------------------------------------------
insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes) values
  ('domain_renewal_due', true, '{Admin}', '{}', '{}', 0),
  ('domain_site_down',   true, '{Admin}', '{}', '{}', 0)
on conflict (event_key) do nothing;
