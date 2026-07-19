-- 0040_mail_notifications.sql — cron mail poller watermark + routing rules for the
-- email/contract notification events. Additive only: no drops, no column changes.

-- Highest INBOX UID already notified about, per mailbox. NULL = never polled;
-- the poller treats that as a first run (records a watermark, notifies nobody).
alter table public.company_mailboxes
  add column if not exists last_notified_uid bigint;

-- notify() no-ops for any event without a rule row, so every new event needs one.
insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes) values
  ('contract_sent',               true, '{}', '{}', '{lead_agent,contract_creator}', 0),
  ('contract_send_failed',        true, '{}', '{}', '{contract_creator}',            0),
  ('mail_received',               true, '{}', '{}', '{mailbox_owner}',               0),
  ('mailbox_verification_failed', true, '{}', '{}', '{mailbox_owner}',               0)
on conflict (event_key) do nothing;
