-- 0079_client_domains.sql — client domains: buy (Cloudflare default, Hostinger
-- optional), link to a lead, and let the dashboard connect DNS + hosting + SSL
-- and put the lead's site live on it.
-- ADDITIVE ONLY. Shared prod DB (ikuvbxjkoojtgekapbul): one new table,
-- permission + department-grant + notification-rule rows. No drops, no type
-- changes. Applied via the Supabase MCP BEFORE the code deploy.
--
-- RLS is enabled with NO policies: every read/write goes through the
-- service-role client behind an explicit permission check (same posture as
-- form_* / studio_* / builder_*).

create table if not exists public.client_domains (
  id uuid primary key default gen_random_uuid(),
  -- bare, lowercase apex (www. stripped) — the identity of the row
  domain text not null unique check (domain = lower(domain) and domain !~ '^www\.'),
  registrar text not null check (registrar in ('cloudflare','hostinger')),
  -- 'purchased' through the dashboard, or 'imported' from the registrar account
  origin text not null check (origin in ('purchased','imported')),
  lead_id uuid references public.leads(id) on delete set null,
  -- purchasing        registrar order in flight
  -- setting_up        the pipeline is connecting DNS / hosting / SSL / the site
  -- waiting_for_site  domain is ready; the lead has no live staging site yet
  -- live              the lead's site serves on the domain
  -- connected         imported; already set up by hand (the pipeline never runs)
  -- unassigned        owned, not linked to a lead (nothing runs)
  -- needs_attention   a step failed — a human retries from the dashboard
  -- failed            the purchase itself failed — nothing was bought
  status text not null default 'unassigned' check (status in (
    'purchasing','setting_up','waiting_for_site','live','connected','unassigned','needs_attention','failed')),
  step text,
  -- per-step progress, { "<step>": { "state": "done|running|waiting|failed|skipped", "at": iso, "detail": text } }
  steps jsonb not null default '{}'::jsonb,
  last_error text,
  -- when the background processor should look at this row again
  next_run_at timestamptz,
  -- single-flight claim (same discipline as site_agent_runs)
  claim_id uuid,
  claimed_at timestamptz,
  attempts int not null default 0,
  -- registrar / hosting facts
  cf_zone_id text,
  hosting_username text,
  hostinger_order_id bigint,
  hostinger_subscription_id text,
  registration_cost_cents int,
  renewal_cost_cents int,
  currency text,
  auto_renew boolean,
  expires_at timestamptz,
  -- audit
  purchased_by uuid references public.profiles(id) on delete set null,
  purchased_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One working domain per lead (a failed purchase never blocks the next try).
create unique index if not exists client_domains_one_per_lead
  on public.client_domains (lead_id)
  where lead_id is not null and status <> 'failed';

-- The processor's narrow "what is due" read (disk-IO rule: poll a partial index).
create index if not exists client_domains_due_idx
  on public.client_domains (next_run_at)
  where status in ('purchasing','setting_up','waiting_for_site');

alter table public.client_domains enable row level security;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('domains.view',     'View Domains',  'See client domains, their registrar, expiry and setup progress.', 'domains', false),
  ('domains.manage',   'Manage Domains', 'Import domains from the registrar, link them to leads, retry setup, toggle auto-renew.', 'domains', true),
  ('domains.purchase', 'Buy Domains',   'Buy new domains with the company payment method (non-refundable).', 'domains', true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'domains.view' from public.departments d where d.slug in ('admin','management','sales','closing','tech')
on conflict do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, p.key from public.departments d
  cross join (values ('domains.manage'), ('domains.purchase')) as p(key)
  where d.slug = 'admin'
on conflict do nothing;

insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes) values
  ('domain_needs_attention', true, '{Admin}', '{}', '{}', 0)
on conflict (event_key) do nothing;
