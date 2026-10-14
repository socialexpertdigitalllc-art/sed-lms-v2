-- 0087_assistant_actions.sql — SED AI action mode: the assistant proposes a
-- change, the person confirms it, and the app makes it as them.
--
-- FILE ONLY. Do NOT apply — the operator's DB is production; they apply this
-- after review.
--
-- ADDITIVE ONLY. New tables, two permission seeds and one private storage
-- bucket. No drops, no type changes, no edits to existing columns or data.
--
-- HOW AN ACTION FLOWS. The assistant fills an action's fields from the
-- conversation and checks them with the same rules as the app's own forms.
-- When everything required is there it records a PROPOSAL here (status
-- 'proposed') and shows it as a card. Nothing changes until the person presses
-- Confirm; the confirm route then runs the app's own endpoint for that change,
-- signed in as them, so the usual permission checks, notifications and
-- activity log all apply. Every row is the audit trail of what SED AI did,
-- for whom, and when — and what undoing it needs.
--
-- All writes go through the service role behind an ownership (or approver)
-- check in /api/assistant/*. The select policies are defence in depth.

-- ------------------------------------------------------------------ actions
create table if not exists public.assistant_actions (
  id uuid primary key default gen_random_uuid(),
  -- Who asked for it (and on whose behalf it runs, unless an approver does).
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.assistant_conversations(id) on delete set null,
  turn_id uuid,
  tool_call_id text,
  -- Multi-step plans: the steps of one plan share plan_id, in plan_index order.
  plan_id uuid,
  plan_index int,
  plan_title text,
  action_key text not null check (char_length(action_key) between 3 and 80),
  title text not null check (char_length(title) between 1 and 300),
  risk text not null default 'standard' check (risk in ('standard', 'sensitive', 'critical')),
  -- The values as checked and shown on the card. Never a password.
  input jsonb not null default '{}'::jsonb,
  -- What the card shows: fields, before → after changes, bulk items, warnings.
  card jsonb not null default '{}'::jsonb,
  -- The record as it was when proposed: the stale check and the undo source.
  before_state jsonb,
  -- Critical actions (money, security) are confirmed by typing this.
  confirm_phrase text,
  status text not null default 'proposed' check (status in (
    'proposed', 'executing', 'done', 'failed', 'cancelled', 'expired', 'undone',
    'awaiting_approval', 'rejected'
  )),
  result jsonb,
  error text,
  -- Where the request came from.
  source text not null default 'chat' check (source in ('chat', 'telegram', 'whatsapp', 'rule', 'suggestion', 'recipe', 'scheduler')),
  -- "Ask an admin": who decided, and what they said.
  approver_id uuid references public.profiles(id) on delete set null,
  approval_note text,
  decided_at timestamptz,
  -- When the outcome was handed back to the assistant (so it knows next turn).
  reported_at timestamptz,
  undo_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  executed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '1 day')
);
create index if not exists assistant_actions_user_recent_idx on public.assistant_actions (user_id, created_at desc);
create index if not exists assistant_actions_conversation_idx on public.assistant_actions (conversation_id, created_at);
create index if not exists assistant_actions_open_idx on public.assistant_actions (status, expires_at)
  where status in ('proposed', 'awaiting_approval', 'executing');
create index if not exists assistant_actions_plan_idx on public.assistant_actions (plan_id, plan_index) where plan_id is not null;
create index if not exists assistant_actions_recent_idx on public.assistant_actions (created_at desc);

-- ------------------------------------------------------ per-action switches
-- Admins turn single actions off (or back on) without a code change. No row
-- means on. Who may use action mode at all is the assistant.act permission.
create table if not exists public.assistant_action_settings (
  action_key text primary key check (char_length(action_key) between 3 and 80),
  enabled boolean not null default true,
  -- Everyone must ask an approver for this one, even with the permission.
  require_approval boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- reminders
-- "Remind me tomorrow at 10am to call Jumbo's": a bell at that time.
create table if not exists public.assistant_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  remind_at timestamptz not null,
  lead_id uuid references public.leads(id) on delete set null,
  ticket_id uuid,
  target_url text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  action_id uuid references public.assistant_actions(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists assistant_reminders_due_idx on public.assistant_reminders (remind_at) where status = 'pending';
create index if not exists assistant_reminders_user_idx on public.assistant_reminders (user_id, remind_at desc);

-- ---------------------------------------------------------- saved shortcuts
-- A routine someone repeats, saved under a command: "/google-lead".
create table if not exists public.assistant_recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  command text not null check (command ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  prompt text not null check (char_length(prompt) between 1 and 4000),
  mode text not null default 'act' check (mode in ('ask', 'act')),
  uses int not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, command)
);

-- --------------------------------------------------------- holiday handover
-- "Give my leads to Sara until Monday": moved now, moved back at ends_at by
-- the scheduler — only the leads still with Sara then.
create table if not exists public.assistant_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  from_agent uuid not null references public.profiles(id) on delete cascade,
  to_agent uuid not null references public.profiles(id) on delete cascade,
  lead_ids uuid[] not null default '{}',
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'returned', 'cancelled', 'failed')),
  returned_count int not null default 0,
  error text,
  action_id uuid references public.assistant_actions(id) on delete set null,
  created_at timestamptz not null default now(),
  returned_at timestamptz
);
create index if not exists assistant_handoffs_due_idx on public.assistant_handoffs (ends_at) where status = 'active';

-- ------------------------------------------------------------ standing rules
-- Rules a person approves once, run by the scheduler: "after 3 no-pickups in a
-- row, move the lead to Long Term". `template` names one of the fixed rule
-- kinds in lib/assistant/rules.ts — never free-form code.
create table if not exists public.assistant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  template text not null check (char_length(template) between 1 and 60),
  params jsonb not null default '{}'::jsonb,
  -- {"every":"hour"} | {"every":"day","at":"09:00"} | {"every":"week","weekday":1,"at":"09:00"}
  schedule jsonb not null default '{"every":"day","at":"09:00"}'::jsonb,
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_result jsonb,
  runs int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assistant_rules_due_idx on public.assistant_rules (next_run_at) where enabled;
create index if not exists assistant_rules_user_idx on public.assistant_rules (user_id);

-- ---------------------------------------------------- phone channel links
-- A person's Telegram chat or WhatsApp number, linked from inside the app with
-- a one-time code, so messages from it reach THEIR assistant.
create table if not exists public.assistant_channel_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'whatsapp')),
  external_id text not null check (char_length(external_id) between 1 and 120),
  label text,
  conversation_id uuid references public.assistant_conversations(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (channel, external_id)
);
create index if not exists assistant_channel_links_user_idx on public.assistant_channel_links (user_id);

create table if not exists public.assistant_link_codes (
  code text primary key check (code ~ '^[0-9]{6}$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('telegram', 'whatsapp')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ uploads
-- Files dropped into the chat (a logo, ticket screenshots), kept privately
-- until an action attaches them to a lead or ticket.
create table if not exists public.assistant_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid references public.assistant_conversations(id) on delete set null,
  path text not null,
  name text not null check (char_length(name) between 1 and 200),
  mime text not null,
  size_bytes int not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);
create index if not exists assistant_uploads_user_idx on public.assistant_uploads (user_id, created_at desc);

insert into storage.buckets (id, name, public)
values ('assistant-uploads', 'assistant-uploads', false)
on conflict (id) do nothing;

-- -------------------------------------------------------------------- RLS
alter table public.assistant_actions enable row level security;
alter table public.assistant_action_settings enable row level security;
alter table public.assistant_reminders enable row level security;
alter table public.assistant_recipes enable row level security;
alter table public.assistant_handoffs enable row level security;
alter table public.assistant_rules enable row level security;
alter table public.assistant_channel_links enable row level security;
alter table public.assistant_link_codes enable row level security;
alter table public.assistant_uploads enable row level security;

drop policy if exists "read own or managed assistant actions" on public.assistant_actions;
create policy "read own or managed assistant actions" on public.assistant_actions
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission('assistant.actions.manage'));

drop policy if exists "read assistant action settings" on public.assistant_action_settings;
create policy "read assistant action settings" on public.assistant_action_settings
  for select to authenticated using (true);

drop policy if exists "read own assistant reminders" on public.assistant_reminders;
create policy "read own assistant reminders" on public.assistant_reminders
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "read own assistant recipes" on public.assistant_recipes;
create policy "read own assistant recipes" on public.assistant_recipes
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "read own assistant handoffs" on public.assistant_handoffs;
create policy "read own assistant handoffs" on public.assistant_handoffs
  for select to authenticated using (user_id = auth.uid() or from_agent = auth.uid() or to_agent = auth.uid());

drop policy if exists "read own assistant rules" on public.assistant_rules;
create policy "read own assistant rules" on public.assistant_rules
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "read own assistant channel links" on public.assistant_channel_links;
create policy "read own assistant channel links" on public.assistant_channel_links
  for select to authenticated using (user_id = auth.uid());

-- Link codes are only ever read by the service role.

drop policy if exists "read own assistant uploads" on public.assistant_uploads;
create policy "read own assistant uploads" on public.assistant_uploads
  for select to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------ permissions
-- Action mode starts with the Tech department only. Admins widen it from the
-- usual permission screens — per department, per person, or as a trial with
-- an expiry date — without a code change. Each action ALSO needs the
-- permission for the change itself (creating a lead needs "Create Lead").
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('assistant.act', 'Use SED AI action mode',
   'Let SED AI make changes for you — create leads, log calls, open tickets — after you confirm each one', 'assistant', true),
  ('assistant.actions.manage', 'Manage SED AI actions',
   'Switch single actions on or off, see the action report, and approve requests people send for actions they cannot do themselves', 'assistant', true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'assistant.act' from public.departments d where d.slug = 'tech'
on conflict do nothing;

-- Admin does not pick up new keys by itself (seed.sql granted the catalogue
-- once): name it explicitly.
insert into public.department_permissions (department_id, permission_key)
  select d.id, 'assistant.actions.manage' from public.departments d where d.slug = 'admin'
on conflict do nothing;
