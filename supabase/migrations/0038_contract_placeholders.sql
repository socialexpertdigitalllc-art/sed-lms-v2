-- 0038_contract_placeholders.sql — custom lead-field placeholders for contracts
-- ADDITIVE ONLY. Shared prod DB: one new table + one nullable column. No drops,
-- no type changes, no destructive edits.

-- Operator-defined `{{token}}` → lead column bindings. The token is canonical
-- (`{{lower_snake}}`, enforced app-side by normalizeToken) and unique across the
-- registry; lead_field must be one of the whitelisted, client-safe lead columns
-- in lib/contracts/placeholders.ts (LEAD_FIELD_SOURCES).
create table if not exists public.contract_placeholders (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  lead_field text not null,
  label text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Snapshot of the custom values merged into a generated contract, so a contract
-- stays explainable after its placeholder definitions change. Nullable => the
-- react-pdf path (which fills nothing custom) is unaffected.
alter table public.contracts
  add column if not exists custom_fields jsonb;

-- RLS: mirrors contract_templates — readable by users who can send contracts or
-- manage integrations; writes go through the service role in gated routes.
alter table public.contract_placeholders enable row level security;

drop policy if exists "read contract placeholders" on public.contract_placeholders;
create policy "read contract placeholders" on public.contract_placeholders for select to authenticated
  using (public.has_permission('contracts.send') or public.has_permission('integrations.manage'));
