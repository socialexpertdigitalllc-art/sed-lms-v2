-- 0092_assistant_tasks.sql — SED AI background tasks: a job too big for one
-- answer ("categorise every lead") keeps going on its own, run after run, with
-- nobody watching, until it is done (lib/assistant/tasks.ts, taskRunner.ts).
-- ADDITIVE ONLY (shared prod DB): one new table, no drops.
--
-- The row IS the task's memory between runs: what it is for (goal), how far it
-- got (progress, written by SED AI each run) and the runner's bookkeeping. A
-- run that dies with the server (a restart, a deploy) stops sending heartbeats;
-- the next sweep sees that and runs the task again.

create table if not exists public.assistant_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  -- the whole job, in the person's terms (their rules included)
  goal text not null check (char_length(goal) between 1 and 4000),
  -- what is done and what is left, as of the last run
  progress text not null default '' check (char_length(progress) <= 4000),
  -- running: it carries on by itself · done · blocked: it needs the person ·
  -- stopped: the person (or its run limit) stopped it · failed: kept erroring
  status text not null default 'running' check (status in ('running', 'done', 'blocked', 'stopped', 'failed')),
  -- the permission mode it was started under (re-clamped to the company limit each run)
  permission_mode text check (permission_mode in ('ask', 'auto_safe', 'auto')),
  runs integer not null default 0,
  max_runs integer not null default 40,
  -- runs in a row that changed nothing (a stuck task stops itself)
  idle_runs integer not null default 0,
  -- runs in a row that errored
  failures integer not null default 0,
  -- changes made over all runs
  changes integer not null default 0,
  next_run_at timestamptz not null default now(),
  -- the run in progress, and its last sign of life
  claim_id uuid,
  heartbeat_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live task per chat.
create unique index if not exists assistant_tasks_one_running_per_chat
  on public.assistant_tasks (conversation_id) where status = 'running';
-- The runner's sweep: live tasks by when they are due.
create index if not exists assistant_tasks_due_idx
  on public.assistant_tasks (next_run_at) where status = 'running';
create index if not exists assistant_tasks_conversation_idx
  on public.assistant_tasks (conversation_id, created_at desc);

-- Same posture as the other assistant tables: owners may read their own; all
-- writes go through the service role behind the checks in /api/assistant/*.
alter table public.assistant_tasks enable row level security;
drop policy if exists "read own assistant tasks" on public.assistant_tasks;
create policy "read own assistant tasks" on public.assistant_tasks
  for select to authenticated using (user_id = auth.uid());
