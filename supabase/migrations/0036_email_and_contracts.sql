-- 0036_email_and_contracts.sql — company mailbox linking + contract management
-- ADDITIVE ONLY. Shared prod DB (ikuvbxjkoojtgekapbul): new tables + buckets +
-- permission rows only. No column drops, no type changes, no destructive edits.

-- Sub-project 1: linked company mailboxes. Credential is AES-256-GCM ciphertext
-- (encrypted app-side) — this column is NEVER selected into a client response.
create table if not exists public.company_mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email_address text not null unique,
  display_name text not null default '',
  imap_host text not null default 'imap.hostinger.com',
  imap_port int not null default 993,
  smtp_host text not null default 'smtp.hostinger.com',
  smtp_port int not null default 465,
  encrypted_password text not null,
  status text not null default 'unverified' check (status in ('unverified','verified','error')),
  last_verified_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists company_mailboxes_user_idx on public.company_mailboxes (user_id);

-- Sub-project 2: contracts. Field snapshot is captured at creation and never
-- mutated — a later lead edit cannot change a sent contract. Resend = new row.
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  mailbox_id uuid references public.company_mailboxes(id) on delete set null,
  template_key text not null default 'standard',
  business_name text not null default '',
  business_phone text,
  business_email text,
  one_time_price numeric(10,2),
  yearly_price numeric(10,2),
  agent_name text not null default '',
  contract_date date not null default current_date,
  message_body text not null default '',
  recipient_email text,
  pdf_path text,
  status text not null default 'draft' check (status in ('draft','sent')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists contracts_lead_idx on public.contracts (lead_id, created_at desc);
create index if not exists contracts_sent_idx on public.contracts (lead_id) where status = 'sent';

-- Per-user signature asset (uploaded PNG preferred, typed name fallback).
create table if not exists public.user_signatures (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  signature_image_path text,
  typed_name text,
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.company_mailboxes enable row level security;
alter table public.contracts enable row level security;
alter table public.user_signatures enable row level security;

-- company_mailboxes: NO policies. Holds a credential — service-role only, all
-- access via the admin client in permission-gated routes/pages.

-- contracts: readable by users who can view or send contracts; writes via service role.
create policy "read contracts" on public.contracts for select to authenticated
  using (public.has_permission('contracts.view') or public.has_permission('contracts.send'));

-- user_signatures: a user reads/writes only their own row.
create policy "read own signature" on public.user_signatures for select to authenticated
  using (user_id = auth.uid());
create policy "insert own signature" on public.user_signatures for insert to authenticated
  with check (user_id = auth.uid());
create policy "update own signature" on public.user_signatures for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- storage buckets (private)
insert into storage.buckets (id, name, public) values
  ('contracts','contracts', false),
  ('signatures','signatures', false)
on conflict (id) do nothing;

-- permissions
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('mail.manage','Manage Company Mailboxes',null,'mail',true),
  ('contracts.view','View Contracts',null,'contracts',false),
  ('contracts.send','Create & Send Contracts',null,'contracts',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('contracts.view'),('contracts.send')) as k(key)
  where d.slug in ('sales','closing','admin')
on conflict do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'mail.manage' from public.departments d where d.slug in ('admin')
on conflict do nothing;
