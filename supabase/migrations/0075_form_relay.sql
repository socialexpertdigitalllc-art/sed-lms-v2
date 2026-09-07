-- 0075_form_relay.sql — self-hosted form submission service (web3forms replacement).
-- ADDITIVE ONLY. Shared prod DB (ikuvbxjkoojtgekapbul): new tables, one new
-- app_settings column, permission + notification-rule rows. No drops, no
-- type changes. The controller applies this via the Supabase MCP after
-- review, BEFORE the code deploy (the submit route reads these tables).
--
-- RLS is enabled with NO policies on both tables: every read/write goes
-- through the service-role client behind an explicit permission check
-- (same posture as studio_* / builder_*). The public ingest route is
-- authenticated by the endpoint's access_key, not by a user session.

create table if not exists public.form_endpoints (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  name text not null,
  access_key text not null unique,
  to_emails text[] not null default '{}',
  subject_template text not null default '',
  mailbox_id uuid references public.company_mailboxes(id) on delete set null,
  allowed_origins text[] not null default '{}',
  daily_limit int not null default 200,
  success_redirect_url text,
  status text not null default 'active' check (status in ('active','paused')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists form_endpoints_lead_idx on public.form_endpoints (lead_id);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.form_endpoints(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  payload jsonb not null default '[]',
  subject text not null default '',
  submitter_name text,
  submitter_email text,
  ip text,
  user_agent text,
  origin text,
  referer text,
  is_spam boolean not null default false,
  spam_reason text check (spam_reason is null or spam_reason in ('honeypot','origin','rate_ip','rate_daily','manual')),
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sending','sent','failed','skipped')),
  delivery_attempts int not null default 0,
  claimed_at timestamptz,
  cc_email text,
  last_error text,
  delivered_at timestamptz,
  mailbox_id uuid references public.company_mailboxes(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists form_submissions_endpoint_idx on public.form_submissions (endpoint_id, created_at desc);
create index if not exists form_submissions_lead_idx on public.form_submissions (lead_id, created_at desc);
create index if not exists form_submissions_pending_idx on public.form_submissions (created_at)
  where delivery_status in ('pending','failed');
-- Stale in-flight claims: a worker that died mid-send leaves 'sending'; the
-- sweep reclaims them once claimed_at is old enough.
create index if not exists form_submissions_sending_idx on public.form_submissions (claimed_at)
  where delivery_status = 'sending';
-- Unread badge: the nav-counts poller counts unread, non-spam rows (optionally
-- per lead). Partial index keeps that count off the heap — this table grows
-- with every visitor submission, and badge counts poll on a short cadence
-- (disk-IO budget incident, 2026-08-17). The daily-limit count reuses
-- form_submissions_endpoint_idx (endpoint_id + created_at range, no ordering).
create index if not exists form_submissions_unread_idx on public.form_submissions (lead_id)
  where read_at is null and is_spam = false;

alter table public.form_endpoints enable row level security;
alter table public.form_submissions enable row level security;

alter table public.app_settings
  add column if not exists form_default_mailbox_id uuid references public.company_mailboxes(id) on delete set null;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('forms.view',   'View Form Submissions',  'See form endpoints and submissions for leads you can see.', 'forms', false),
  ('forms.manage', 'Manage Form Endpoints',  'Create/edit endpoints, resend, mark spam, delete submissions.', 'forms', true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'forms.view' from public.departments d where d.slug in ('sales','closing','admin')
on conflict do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'forms.manage' from public.departments d where d.slug in ('admin')
on conflict do nothing;

insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes) values
  ('form_submission_received', true, '{}', '{}', '{lead_agent}', 0)
on conflict (event_key) do nothing;
