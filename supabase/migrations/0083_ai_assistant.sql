-- 0083_ai_assistant.sql — the AI Assistant: each user's chats with it, the
-- messages in those chats, and the long-term memories it keeps about the user.
--
-- FILE ONLY. Do NOT apply — the operator's DB is production; they apply this
-- after review.
--
-- ADDITIVE ONLY. Shared prod DB: three new tables and one permission seed. No
-- drops, no type changes, no edits to existing columns or data.
--
-- PRIVACY MODEL. Every row here belongs to exactly one user, and only that
-- user can read it. What the assistant may LOOK UP follows the user's own
-- permissions (an admin's assistant sees every agent's leads; an agent's sees
-- only their own) — but a chat itself is private: nobody, admins included,
-- reads another user's conversations or memories through the app.
--
-- All writes go through the service role behind an ownership check in
-- /api/assistant/*. The owner-only select policies below are defence in
-- depth, and let a future realtime subscription work without a new policy.

-- ----------------------------------------------------------- conversations
create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'New chat' check (char_length(title) between 1 and 200),
  pinned boolean not null default false,
  -- What answered most recently, for display ("MiniMax · MiniMax-M3").
  -- Never a credential.
  last_provider text,
  last_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists assistant_conversations_user_recent_idx
  on public.assistant_conversations (user_id, last_message_at desc);

-- ---------------------------------------------------------------- messages
-- One row per WIRE message, in the OpenAI chat shape the assistant speaks:
--   user      — what the person typed
--   assistant — the model's reply; when it looked data up, `tool_calls` holds
--               the calls VERBATIM (vendor extras included — Gemini's thought
--               signatures live there and must round-trip unchanged)
--   tool      — the result of one of those calls, answering `tool_call_id`
-- Every row produced in answer to one user message shares that message's id
-- as `turn_id`, so a turn can be shown (and trimmed from history) as a unit.
create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  -- Insertion order. created_at can tie inside one turn; this cannot.
  seq bigint generated always as identity,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  turn_id uuid,
  role text not null check (role in ('user', 'assistant', 'tool')),
  -- What the person sees: the reply with any model "thinking" removed.
  content text not null default '',
  -- The model's visible reasoning, when it emitted any (MiniMax does).
  reasoning text,
  tool_calls jsonb,
  tool_call_id text,
  tool_name text,
  -- Display-only facts about a tool call (label, ok, summary, duration).
  meta jsonb,
  provider text,
  model text,
  -- The vendor's usage block for this model round, when it sent one.
  usage jsonb,
  status text not null default 'complete' check (status in ('complete', 'error', 'stopped')),
  error text,
  created_at timestamptz not null default now()
);
create index if not exists assistant_messages_conversation_seq_idx
  on public.assistant_messages (conversation_id, seq);
create index if not exists assistant_messages_user_created_idx
  on public.assistant_messages (user_id, created_at desc);

-- ---------------------------------------------------------------- memories
-- Durable facts the assistant keeps about ONE user — goals, preferences, how
-- they work — written by the assistant when it learns something worth keeping,
-- or by the user from the Memory panel. Injected into every new conversation.
create table if not exists public.assistant_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 1000),
  kind text not null default 'fact'
    check (kind in ('preference', 'goal', 'fact', 'strategy', 'note')),
  source text not null default 'assistant' check (source in ('assistant', 'user')),
  -- Where it was learned, when the assistant saved it.
  conversation_id uuid references public.assistant_conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assistant_memories_user_idx
  on public.assistant_memories (user_id, updated_at desc);

-- -------------------------------------------------------------------- RLS
alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_memories enable row level security;

drop policy if exists "read own assistant conversations" on public.assistant_conversations;
create policy "read own assistant conversations" on public.assistant_conversations
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "read own assistant messages" on public.assistant_messages;
create policy "read own assistant messages" on public.assistant_messages
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "read own assistant memories" on public.assistant_memories;
create policy "read own assistant memories" on public.assistant_memories
  for select to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------- permission
-- Default-on for EVERY department (the 0021 convention): everyone gets an
-- assistant, scoped to what they can already see. Revoke it per department
-- or per user in the usual permission screens. Only this one key is granted —
-- never a category-wide cross join, which would undo past revocations.
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('assistant.use', 'Use AI Assistant',
   'Chat with the AI assistant about the data you can already see', 'assistant', false)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'assistant.use' from public.departments d
on conflict do nothing;
