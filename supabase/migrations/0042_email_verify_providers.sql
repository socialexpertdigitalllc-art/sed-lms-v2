-- 0042_email_verify_providers.sql — user-managed email-verification providers,
-- live balance caching, and bounce capture for the accuracy scorecard.
-- ADDITIVE ONLY. Shared prod DB: new tables + `add column if not exists` only.
-- No drops, no type changes, no edits to existing columns.

-- ---------------------------------------------------------------- providers
-- One row per provider. THIS TABLE HOLDS CREDENTIALS: `encrypted_credentials`
-- is a JSON object of the registry's credential fields, AES-256-GCM encrypted
-- with MAILBOX_ENC_KEY (lib/mail/crypto.ts), stored as `iv:tag:ciphertext`.
--
-- The DB is authoritative. Environment variables (VERIFALIA_USERNAME/…,
-- REOON_API_KEY) are only ever a ONE-TIME SEED: the app inserts a row from them
-- the first time it reads and finds none, with `on conflict do nothing`.
create table if not exists public.email_verify_providers (
  provider_key text primary key,
  enabled boolean not null default true,
  -- Ascending: 0 is tried first. Matches RECOMMENDED_ORDER on seed.
  priority integer not null default 0,
  encrypted_credentials text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists email_verify_providers_priority_idx
  on public.email_verify_providers (priority asc);

-- ------------------------------------------------------------ send outcomes
-- Ground truth for the scorecard: an address we sent to that bounced. Written
-- by the cron mail poller when it recognises an NDR in a linked mailbox.
-- 5.x.x → hard_bounce (the address is dead), 4.x.x and anything ambiguous →
-- soft_bounce (never counted against a provider).
create table if not exists public.email_send_outcomes (
  id uuid primary key default gen_random_uuid(),
  normalized_email text not null,
  outcome text not null check (outcome in ('hard_bounce','soft_bounce')),
  detected_at timestamptz not null default now(),
  mailbox_id uuid references public.company_mailboxes(id) on delete set null,
  source text not null default 'mail_poll'
);

create index if not exists email_send_outcomes_email_idx
  on public.email_send_outcomes (normalized_email);
create index if not exists email_send_outcomes_detected_at_idx
  on public.email_send_outcomes (detected_at desc);

-- --------------------------------------------------- provider state additions
-- Live remaining-credit cache (~60s TTL) so a settings page cannot hammer the
-- vendor's balance endpoint, plus a last-success marker for the health badge.
alter table public.email_verify_provider_state
  add column if not exists balance_remaining integer;
alter table public.email_verify_provider_state
  add column if not exists balance_checked_at timestamptz;
alter table public.email_verify_provider_state
  add column if not exists last_success_at timestamptz;

-- ------------------------------------------------------------ notification
-- notify() no-ops for any event without a rule row, so the new event needs one.
-- Targeted at the admin department: quota is an operational concern, not a
-- per-lead one, so there is no contextual role to hang it on.
insert into public.notification_rules
  (event_key, enabled, target_departments, target_users, target_roles, delay_minutes)
values
  ('email_verify_quota_low', true, '{admin}', '{}', '{}', 0)
on conflict (event_key) do nothing;

-- ---------------------------------------------------------------------- RLS
alter table public.email_verify_providers enable row level security;
alter table public.email_send_outcomes enable row level security;

-- email_verify_providers holds CREDENTIALS: service-role only, deliberately NO
-- select policy. Everything the UI needs (configured?, masked hint, enabled,
-- priority) is assembled server-side in the auth-gated admin route.

-- Outcomes are just bounce facts — readable by any signed-in user, mirroring
-- email_verifications in 0041. All writes go through the service role.
create policy "read email send outcomes" on public.email_send_outcomes for select to authenticated
  using (true);
