-- 0088_push_notifications.sql — desktop / phone push for the notification bell.
--
-- ADDITIVE ONLY: one new table, two nullable columns, one partial index, and a
-- one-off stamp of pushed_at on the rows that already exist (so the dispatcher
-- starts from "now" instead of pushing the whole history).
--
-- How it works (lib/push/*): a browser that turns notifications on registers a
-- Web Push subscription here. The LMS server pushes every notification row once
-- it is due (deliver_after <= now) to each of its owner's subscriptions, then
-- stamps pushed_at. One partial index keeps the "what is due" scan to the
-- handful of rows not yet pushed.

create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  -- The push service URL is unique per browser profile; a second person
  -- signing in on the same browser takes the row over.
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  user_agent      text,
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count   integer not null default 0
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Service-role only (like activity_log): RLS on, no policies. The API routes
-- authenticate the caller and always filter by their user id.
alter table public.push_subscriptions enable row level security;

alter table public.notifications add column if not exists pushed_at timestamptz;

-- History is not news: everything already delivered in-app counts as pushed.
update public.notifications set pushed_at = created_at where pushed_at is null;

create index if not exists notifications_push_due_idx
  on public.notifications (deliver_after)
  where pushed_at is null;

-- The server's Web Push (VAPID) key pair, generated on first use when no
-- VAPID_* environment variables are set: { public_key, private_key_enc, created_at }.
-- The private key is encrypted with MAILBOX_ENC_KEY (lib/mail/crypto.ts).
alter table public.app_settings add column if not exists push_vapid jsonb;
