-- 0037_google_templates_and_mailbox.sql — Google Docs contract templates + full mailbox
-- ADDITIVE ONLY. Shared prod DB (ikuvbxjkoojtgekapbul): new tables + nullable
-- columns + permission rows only. No drops, no type changes, no destructive edits.

-- App-wide single Google OAuth connection. The refresh token is AES-256-GCM
-- ciphertext (encrypted app-side) and is NEVER selected into a client response.
-- `singleton` enforces exactly one active row (upsert onConflict, like app_settings).
create table if not exists public.google_connection (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique,
  account_email text,
  encrypted_refresh_token text not null,
  scope text,
  connected_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Registry of Google Docs templates pulled from the configured Drive folder.
-- google_doc_id UNIQUE => a doc can be registered at most once (409 on dup add).
create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  google_doc_id text not null unique,
  name text not null default '',
  placeholders text[] not null default '{}',
  synced_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Contracts: link the chosen Google template + the generated Drive doc. All
-- nullable => a react-pdf contract (google_template_id null) still works.
alter table public.contracts
  add column if not exists google_template_id uuid references public.contract_templates(id) on delete set null,
  add column if not exists generated_doc_id text,
  add column if not exists generated_doc_url text;

-- Drive folder id holding the template docs — a single editable setting.
alter table public.app_settings
  add column if not exists contract_templates_folder_id text;

-- RLS
alter table public.google_connection enable row level security;
alter table public.contract_templates enable row level security;

-- google_connection: NO policies. Holds a credential — service-role only.

-- contract_templates: readable by users who can send contracts or manage
-- integrations; writes via the service role in permission-gated routes.
create policy "read contract templates" on public.contract_templates for select to authenticated
  using (public.has_permission('contracts.send') or public.has_permission('integrations.manage'));

-- permissions
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('integrations.manage','Manage Integrations (Google, Templates)',null,'integrations',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'integrations.manage' from public.departments d where d.slug in ('admin')
on conflict do nothing;
