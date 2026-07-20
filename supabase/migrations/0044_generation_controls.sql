-- 0044_generation_controls.sql — cooperative pause / resume / stop for a run
--
-- A generation runs inside one long server task (plan -> images -> curate, or
-- prepare -> per-file build -> verify -> finalize). Killing that task mid-write
-- would strand half-written zips, orphaned storage objects and an inconsistent
-- `template_generations` row, so control is COOPERATIVE instead: an API route
-- writes a flag here, and the runner polls it at checkpoints where the
-- persisted state is already coherent and stops there.
--
-- Additive only: every new column is nullable with no default, so existing rows
-- read back as `control = null` (= "run normally"), which is exactly today's
-- behaviour. The single non-additive-looking statement is the status CHECK
-- rebuild below, which STRICTLY WIDENS the allowed set (see the comment there).

alter table public.template_generations
  -- null = run normally. 'pause' = stop at the next safe checkpoint and keep
  -- everything (resumable). 'cancel' = stop at the next safe checkpoint and
  -- leave artefacts as-is (terminal, but still retryable via /retry).
  add column if not exists control text,
  -- when the runner actually came to rest at a checkpoint (not when the
  -- operator clicked Pause) — the flag and the halt are not simultaneous.
  add column if not exists paused_at timestamptz;

alter table public.template_generations
  drop constraint if exists template_generations_control_check;
alter table public.template_generations
  add constraint template_generations_control_check
  check (control is null or control in ('pause', 'cancel'));

-- `status` carries a CHECK constraint (created inline in 0026, rebuilt by name
-- in 0034). Postgres has no "add a value to a CHECK", so it is dropped and
-- recreated — safe here because the new list is a strict SUPERSET of 0034's:
-- every previously-valid status is still valid, and only 'paused' + 'cancelled'
-- are added. No existing row can be invalidated by this statement.
alter table public.template_generations drop constraint if exists template_generations_status_check;
alter table public.template_generations add constraint template_generations_status_check
  check (status in (
    'queued','running','planning','curating','building',
    'review','ready_for_review','deployed','failed',
    'paused','cancelled'
  ));

-- The processor claims queue rows by status alone; a paused/cancelled run's
-- pending rows are deleted by /cancel or skipped by processTemplateQueue().
-- This index keeps that per-generation lookup cheap.
create index if not exists template_gen_queue_generation_idx
  on public.template_gen_queue (generation_id, status);
