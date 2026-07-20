-- 0045_generation_redo.sql — per-step redo for a generation
--
-- An operator can re-run ONE step of a run (content, images or build) without
-- cascading into the steps after it. That is deliberate — a redo is surgical —
-- but it can leave later artefacts inconsistent (fresh copy next to images
-- chosen for the old copy). So the later steps are marked STALE instead, and
-- the UI offers a one-click "redo this too".
--
-- Additive only. Nothing here rewrites a row, drops a column, or narrows a
-- constraint; the one dropped CHECK is rebuilt as a strict SUPERSET.

-- Which of the three redoable steps ('content' | 'images' | 'build') have an
-- output that predates a newer upstream redo. Nullable with NO default, so
-- every existing row reads back as "nothing stale" — today's behaviour exactly.
--
-- Why a column and not a marker inside the existing `steps` jsonb: `steps` is
-- keyed by PIPELINE step (`plan`, `images`, `build:index.html`, `verify`,
-- `finalize`), not by the three operator-facing steps, so one stale "build"
-- would have to be smeared across a dozen entries — and every redo/rebuild
-- RESETS those very entries (pruneBuildPhaseSteps deletes the whole build
-- phase), which would silently evaporate the marks exactly when they matter.
alter table public.template_generations
  add column if not exists stale_steps text[];

alter table public.template_generations
  drop constraint if exists template_generations_stale_steps_check;
alter table public.template_generations
  add constraint template_generations_stale_steps_check
  check (
    stale_steps is null
    or stale_steps <@ array['content','images','build']::text[]
  );

-- `template_gen_queue.kind` tells processTemplateQueue which phase to run. It
-- was created in 0035 with check (kind in ('plan','build')). A per-step redo
-- needs two more phases that did not exist before:
--   'content' — re-plan the content model ONLY (leaves image_slots alone)
--   'images'  — re-gather image candidates ONLY (leaves content_model alone)
-- 'plan' keeps its meaning (plan + images together, i.e. a normal full run) and
-- remains the column default, so nothing that enqueues today changes behaviour.
--
-- Postgres has no "add a value to a CHECK", so the constraint is dropped and
-- recreated. Safe: the new list is a strict SUPERSET of 0035's, so no existing
-- queue row can be invalidated by this statement.
alter table public.template_gen_queue
  drop constraint if exists template_gen_queue_kind_check;
alter table public.template_gen_queue
  add constraint template_gen_queue_kind_check
  check (kind in ('plan', 'build', 'content', 'images'));
