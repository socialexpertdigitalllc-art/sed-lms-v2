-- 0049_template_delete.sql — make a website template safely hard-deletable
--
-- GOAL. Deleting a `website_templates` row must be able to succeed even though
-- every template has `template_generations` rows referencing it. Today it
-- cannot: the FK created inline in 0026 —
--     template_id uuid not null references public.website_templates(id) on delete restrict
-- — is ON DELETE RESTRICT, so `delete from website_templates` is BLOCKED while a
-- single generation still points at it, and in prod they all do.
--
-- WHY THIS IS ADDITIVE / WIDENING-SAFE (RESTRICT -> SET NULL). A completed
-- generation holds its OWN brief, content_model, image_slots, zip_path and
-- deployed_url — it built its site already and never reads the template again.
-- So deleting a template should UNLINK those rows (template_id -> null) rather
-- than be refused. RESTRICT and SET NULL behave IDENTICALLY for every operation
-- except one: a delete of the referenced parent row. RESTRICT forbids that
-- delete; SET NULL performs the unlink instead. This migration therefore
-- STRICTLY WIDENS what is permitted — no INSERT, UPDATE or SELECT that was valid
-- before becomes invalid, and applying it does not touch, rewrite or invalidate
-- any existing row. The two prerequisites for a SET NULL action are established
-- below:
--   1. template_id must be NULLABLE (it is NOT NULL today) — step 1;
--   2. the constraint's ON DELETE action must be SET NULL — step 2.
--
-- The guard that stops a template being pulled out from under an ACTIVELY
-- BUILDING generation is NOT here — it lives in the DELETE route (a 409 on any
-- generation in queued/running/planning/building/curating/paused). This
-- migration only makes the terminal-row unlink structurally possible.

-- Step 1 — drop NOT NULL on template_id so the SET NULL action has somewhere to
-- land. Verified against migration 0026 (line 19, `template_id uuid not null
-- references ...`) and every later migration that touches this table (0034,
-- 0035, 0044, 0045, 0047 — none alter the column): the column is currently
-- NOT NULL, so the relaxing statement below is required and is emitted. It is
-- also idempotent — `drop not null` is a no-op if the column is already
-- nullable — so re-applying the migration is harmless.
alter table public.template_generations
  alter column template_id drop not null;

-- Step 2 — recreate the FK as ON DELETE SET NULL. The original was created
-- inline in 0026 with no explicit name, so Postgres auto-named it by its
-- <table>_<column>_fkey convention — confirmed by the same-convention constraint
-- renames in 0003 (e.g. `activity_log_user_id_fkey`, `leads_agent_id_fkey`):
-- the real name is `template_generations_template_id_fkey`. Drop it by that name
-- (`if exists` keeps the drop safe should it ever have been renamed) and add the
-- widened one back.
alter table public.template_generations
  drop constraint if exists template_generations_template_id_fkey;
alter table public.template_generations
  add constraint template_generations_template_id_fkey
  foreign key (template_id) references public.website_templates(id) on delete set null;
