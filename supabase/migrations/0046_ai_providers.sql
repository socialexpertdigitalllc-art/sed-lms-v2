-- 0046_ai_providers.sql — operator-managed AI providers and per-task model
-- routing for the Template Engine.
-- ADDITIVE ONLY. Shared prod DB: new tables only. No drops, no type changes,
-- no edits to existing columns.

-- --------------------------------------------------------------- providers
-- One row per AI provider (gemini, deepseek, webcraft/Kimi, minimax, …).
-- THIS TABLE HOLDS CREDENTIALS: `encrypted_credentials` is a JSON object of the
-- registry's credential fields (normally {"api_key": "..."}), AES-256-GCM
-- encrypted with MAILBOX_ENC_KEY (lib/mail/crypto.ts), stored as
-- `iv:tag:ciphertext`.
--
-- The DB is authoritative. Environment variables (GEMINI_API_KEY,
-- DEEPSEEK_API_KEY, KIMI_API_KEY, MINIMAX_API_KEY) are only ever a ONE-TIME
-- SEED: the app inserts a row from them the first time it reads and finds none,
-- with `on conflict do nothing`, so an existing deployment keeps working
-- without anyone touching the settings page. After that the row wins.
--
-- `provider_key` is deliberately free text rather than an enum: adding a
-- provider is meant to be a one-descriptor change in
-- lib/ai-tools/providers/registry.ts, never a migration.
create table if not exists public.ai_providers (
  provider_key text primary key,
  enabled boolean not null default true,
  encrypted_credentials text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------- assignments
-- Which provider/model serves each AI task. One row per task; a task with no
-- row runs the registry default (today's hardcoded Gemini behaviour), and so
-- does a task whose row no longer passes the registry's capability check —
-- resolveTaskModel() drops an unusable assignment rather than failing a
-- generation. Deleting the row IS the "reset to default" action.
--
-- No FK to ai_providers: an assignment may name a provider whose credentials
-- have not been entered yet, and that case is handled in code (fall back).
create table if not exists public.ai_task_assignments (
  task_key text primary key,
  provider_key text not null,
  model text not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists ai_task_assignments_provider_idx
  on public.ai_task_assignments (provider_key);

-- --------------------------------------------------------------------- RLS
alter table public.ai_providers enable row level security;
alter table public.ai_task_assignments enable row level security;

-- ai_providers holds CREDENTIALS: service-role only, deliberately NO select
-- policy. Everything the UI needs (configured?, masked hint, enabled) is
-- assembled server-side in the auth-gated admin route.

-- Assignments are not secret — they are just "which model runs which task" —
-- but they are an admin-only concern and every write goes through the service
-- role behind an `integrations.manage` check, so this table gets no select
-- policy either. The admin page reads it server-side.
