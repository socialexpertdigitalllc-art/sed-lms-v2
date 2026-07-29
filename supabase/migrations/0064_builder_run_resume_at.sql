-- 0064_builder_run_resume_at.sql — when a parked builder run should resume.
--
-- ADDITIVE ONLY. Shared prod DB: one nullable column and one partial index,
-- no drops, no type changes, no edits to existing columns or data.
--
-- WHY. When a provider's plan-quota window (MiniMax's 5-hour / weekly Token
-- Plan windows) is exhausted, retrying a run burns attempts against a wall
-- that will not move until the window resets. The run loop now PARKS such a
-- run instead, recording here when that window resets so the background
-- processor can resume it automatically — the operator's explicit request:
-- "if the user needs to keep an eye on each run and stop and retry manually,
-- what's the point of the rate limiting?"
--
-- NULL means "not parked". That is correct for every existing row — none was
-- parked before this column existed — so applying this changes no behaviour.
--
-- A parked run's status stays `failed` deliberately: no status-constraint
-- migration, and every existing gate (retry, regenerate, recover) already
-- treats `failed` as actionable, so all of them keep working on a parked run
-- with zero changes. `resume_at` is an annotation on that failure, not a new
-- state.
alter table public.builder_runs
  add column if not exists resume_at timestamptz;

-- The background processor polls for runs whose resume time has passed. The
-- predicate makes this a partial index over only parked rows — at any moment
-- a handful at most — so the poll never scans the (ever-growing) mass of
-- ordinary runs where resume_at is null.
create index if not exists builder_runs_resume_due
  on public.builder_runs (resume_at)
  where resume_at is not null;
