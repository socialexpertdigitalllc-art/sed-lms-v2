// Which generation statuses forbid deleting the template they were built from.
//
// Deleting a template unlinks its generations: after migration 0049 the FK
// `template_generations.template_id` is ON DELETE SET NULL, so a template delete
// sets template_id to null on every referencing row rather than being blocked.
// For a FINISHED generation that is exactly right — it already holds its own
// brief, content_model, image_slots, zip and deployed site, and never reads the
// template again, so it survives the delete untouched, merely unlinked.
//
// A generation that has NOT finished building is different: at its next
// checkpoint it may still fetch the template's files out of storage, so removing
// the template (and its storage objects) out from under it would corrupt an
// in-flight build. Those statuses block the delete with a 409:
//
//   queued   — about to be claimed; the runner will fetch template files
//   running  — v1 build in progress
//   planning — v2 building the content model from the template
//   building — v2 exploding pages against the template markup
//   curating — v2 image phase; still resumable into a build
//   paused   — resumable by design; a resume re-enters the build
//
// Everything else is safe to unlink: review / ready_for_review hold a finished
// build awaiting sign-off, and deployed / failed / cancelled are terminal.
//
// NB this is a DELETION concern and deliberately broader than liveness.ts's
// IN_FLIGHT_STATUSES (running/planning/building — "is a runner executing right
// now"). Here queued/curating/paused also block, because the question is not
// "is it running" but "could this run still need the template".

export const LIVE_GENERATION_STATUSES = [
  "queued",
  "running",
  "planning",
  "building",
  "curating",
  "paused",
] as const;

export type LiveGenerationStatus = (typeof LIVE_GENERATION_STATUSES)[number];

/**
 * True when a generation's status means it may still consult the template, so
 * the template must not be deleted (and its generations unlinked) yet. Tolerates
 * junk (null/number/object) coming back from DB JSON — anything that is not one
 * of the named live statuses reads as not-live.
 */
export function isLiveGenerationStatus(status: unknown): boolean {
  return typeof status === "string" && (LIVE_GENERATION_STATUSES as readonly string[]).includes(status);
}
