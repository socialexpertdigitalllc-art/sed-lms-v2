-- 0035_tge_build_phase.sql — split the template-gen queue into plan/build phases
--
-- Phase 2 (image curation) splits one generation run into two queued phases
-- around a human pause: a 'plan' row runs planContent -> buildInitialSlots and
-- stops at template_generations.status='curating'; a 'build' row (enqueued by
-- the operator-triggered /build API once image_slots.selected is populated)
-- runs regenerate -> verify -> finalize and reaches 'review'/'failed'. The
-- queue row's `kind` is how queue.ts's processTemplateQueue dispatches to the
-- right runner entry point (runTemplateGenerationV2 vs buildFromSelection).
--
-- Existing/omitted inserts (e.g. app/api/template-engine/generate/route.ts)
-- keep working unchanged: they default to 'plan', which is today's only phase.

alter table public.template_gen_queue
  add column if not exists kind text not null default 'plan'
    check (kind in ('plan','build'));
