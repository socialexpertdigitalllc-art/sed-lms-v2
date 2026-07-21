-- 0047_generation_heartbeat.sql — proof that a generation is actually running
--
-- THE INCIDENT THIS FIXES. A generation sat at status='building',
-- current_step='verify', control='pause', with a `template_gen_queue` row wedged
-- at 'processing'. Nothing was running: the runner had been killed by a deploy
-- restart. The operator pressed Stop again and again; /cancel wrote the flag
-- correctly, but the flag is only a MESSAGE — it needs a live runner to read it.
-- There was none, so the row stayed "building" forever, the queue stayed wedged
-- behind it, and the UI span an endless spinner on a build that was long dead.
--
-- Why a new column rather than reusing `updated_at`: `updated_at` is written by
-- everything, including /pause and /cancel themselves. In the incident it looked
-- recent purely because the operator kept clicking Stop, while the runner had
-- been dead for hours. A liveness signal must be written by exactly ONE writer —
-- the runner — so this column is it. Nothing else in the codebase may set it.
--
-- Additive only: nullable, no default. Every existing row reads back null, which
-- the orphan check (lib/template-engine/liveness.ts) deliberately treats as
-- "unknown — fall back to the row's age", so rows written before this feature
-- existed are still recoverable instead of being permanently unstoppable.
alter table public.template_generations
  add column if not exists heartbeat_at timestamptz;

-- No index. Every read of this column is either by primary key (the pause/cancel
-- routes and the wizard already fetch the generation row by id) or across the
-- handful of generations behind a `processing` queue row, which is at most a few
-- rows and is already reached through template_gen_queue_generation_idx (0044).
-- An index on a column rewritten every 10 seconds by the active run would cost
-- more in write amplification than it could ever save on those lookups.
