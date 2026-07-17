/**
 * Pure status/step helpers for the 5-step generation wizard (design §10).
 * The generation row is the wizard's single source of truth; everything here
 * derives UI state from `template_generations.status` and friends. No I/O.
 */

/** Statuses with a finished, downloadable/deployable site zip. "review" is the
 *  v2 terminal build status; "ready_for_review" is v1-legacy (old rows only). */
export const DEPLOYABLE_STATUSES = ["review", "ready_for_review", "deployed"] as const;

export function isDeployableStatus(status: string): boolean {
  return (DEPLOYABLE_STATUSES as readonly string[]).includes(status);
}
