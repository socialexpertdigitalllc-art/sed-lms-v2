-- 0089_contract_edits_and_payment_plans.sql — payment schedules, in-dashboard
-- editing and uploaded PDFs for contracts.
-- ADDITIVE ONLY (shared prod DB): nullable columns, no drops, no type changes.

alter table public.contracts
  -- How the client pays the one-time fee (lib/contracts/payments.ts):
  -- { payments: [{ amount, due: { kind, count?, date?, text? }, label? }] }.
  -- Null = paid in full upon signing (every contract before this).
  add column if not exists payment_plan jsonb,
  -- Set when the PDF is a file someone uploaded instead of a generated one
  -- (template_key 'upload', or a generated draft whose PDF was replaced).
  add column if not exists pdf_uploaded_name text,
  -- Last time the wording was edited from the dashboard (or the PDF refreshed
  -- from the Google Doc). Also busts the preview's cache.
  add column if not exists edited_at timestamptz;
