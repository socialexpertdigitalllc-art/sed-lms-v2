-- 0085_payment_receipts.sql — payment receipts generated from a lead and
-- emailed to the client from the billing mailbox.
--
-- FILE ONLY. Do NOT apply — the operator's DB is production; they apply this
-- after review.
--
-- ADDITIVE ONLY. Shared prod DB: one new table + sequence, one private bucket,
-- two nullable app_settings columns, one permission, one notification rule.
-- No drops, no type changes. Until this is applied the receipt UI stays
-- hidden (nobody holds receipts.send) and the receipt settings reader falls
-- back to defaults without touching the rest of app_settings.

-- Receipt numbers: SED-YYYY-MMDD-NNNN. The date is the issue date (UTC) and
-- NNNN is a global running counter, so numbers never collide or repeat.
create sequence if not exists public.receipt_no_seq start 1001;

-- One row per issued receipt. Everything printed on the receipt is
-- snapshotted here at creation and never mutated — a later lead edit cannot
-- change an issued receipt. A correction is a new receipt.
create table if not exists public.lead_receipts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  receipt_no text not null unique default (
    'SED-' || to_char(now() at time zone 'utc', 'YYYY-MMDD') || '-' ||
    lpad(nextval('public.receipt_no_seq')::text, 4, '0')
  ),
  created_by uuid references public.profiles(id) on delete set null,

  -- Bill to
  bill_to_name text not null default '',
  bill_to_business text not null default '',
  bill_to_email text,
  bill_to_phone text,

  -- Project
  project_title text not null default '',
  project_ref text not null default '',

  -- Line items: [{ title, description, term: one_time|monthly|yearly, qty, rate }]
  items jsonb not null default '[]',
  subtotal numeric(10,2) not null default 0,
  discount numeric(10,2) not null default 0,
  tax_rate numeric(5,2) not null default 0,
  tax_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  currency text not null default 'USD',

  -- Payment
  paid_on date not null default current_date,
  payment_method text not null default '',
  payment_reference text,

  -- Coverage / terms lines printed under the totals.
  notes jsonb not null default '[]',
  signer_name text not null default '',

  pdf_path text,

  -- Delivery. Resending updates these; every send is also in activity_log.
  sent_to text,
  sent_at timestamptz,
  sent_by uuid references public.profiles(id) on delete set null,
  mailbox_id uuid references public.company_mailboxes(id) on delete set null,

  created_at timestamptz not null default now()
);
create index if not exists lead_receipts_lead_idx on public.lead_receipts (lead_id, created_at desc);

-- RLS on, NO policies: service role only. Every read/write goes through
-- receipts.send-gated routes and the lead page (admin client after the lead
-- itself was checked as visible to the user).
alter table public.lead_receipts enable row level security;

-- Stored receipt PDFs (private).
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Receipt settings. Nullable, read by their own fallback-safe query
-- (lib/receipts/settings.ts), never by getAppSettings().
alter table public.app_settings
  add column if not exists receipt_signer_name text,
  add column if not exists receipt_mailbox_id uuid references public.company_mailboxes(id) on delete set null;

-- Permission: create, download and email receipts.
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('receipts.send', 'Create & Send Payment Receipts', 'Generate a payment receipt for a lead and email it to the client', 'payments', true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'receipts.send' from public.departments d
  where d.slug in ('tech', 'accounts', 'management', 'admin')
on conflict do nothing;

-- Bell for billing when a lead is closed, so a receipt goes out even when the
-- closer can't send one. notify() no-ops without a rule row. Admins can
-- retarget it from the notification settings.
insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes) values
  ('receipt_needed', true, '{accounts}', '{}', '{}', 0)
on conflict (event_key) do nothing;
