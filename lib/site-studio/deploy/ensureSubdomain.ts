/**
 * "Make sure this subdomain exists on the hosting" — the one step both deploy
 * engines (`lib/site-studio/deploy/deployRun.ts` and
 * `lib/site-builder/deploy.ts`) must get right before they touch any files.
 *
 * WHY THIS IS ITS OWN MODULE, and why it re-checks:
 *
 * DirectAdmin's `CMD_API_SUBDOMAINS action=create` does not just write a
 * config line — it provisions the vhost and issues the certificate before it
 * answers, which takes 30-60s on this server (see the note at the top of
 * `lib/template-engine/directadmin.ts`). Our client used to abort at 30s, so
 * on the slow half of those calls the deploy was told "This operation was
 * aborted" while DA calmly went on to create the subdomain. Auto-deploy then
 * reported failure, rolled the run back to review, and the operator's manual
 * retry rolled a FRESH random slug — leaving the created-but-abandoned
 * subdomain behind. Two of them were still sitting on the hosting when this
 * was diagnosed (2026-08-31).
 *
 * So: a create that reports failure has not necessarily failed. Before
 * believing it, look. The call timeout is now generous enough that the abort
 * should be rare (see CREATE_SUBDOMAIN_TIMEOUT_MS), and this re-check covers
 * whatever slips past it.
 *
 * `existed: true` on the recovered path is deliberate — the caller uses it to
 * decide whether to clear the docroot first, and a docroot DA just created
 * holds DA's own placeholder page. Clearing it is correct.
 */

export interface EnsureSubdomainDeps {
  subdomainExists: (sub: string) => Promise<boolean>;
  createSubdomain: (sub: string) => Promise<{ error: boolean; text: string; details: string }>;
  /** Injected only by tests, which must not spend real seconds waiting. */
  wait?: (ms: number) => Promise<void>;
}

export type EnsureSubdomainOutcome = { ok: true; existed: boolean } | { ok: false; error: string };

/** How long to keep looking for a subdomain whose create call reported
 *  failure. DA finishes provisioning within seconds of giving up on us. */
const RECHECK_ATTEMPTS = 2;
const RECHECK_DELAY_MS = 5000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** "subdomain already exists" comes back as an error from `createSubdomain`
 *  on a rare random collision — that is a race won by someone/something else
 *  between the existence check and the create call, not a real failure. */
function isAlreadyExistsError(r: { text: string; details: string }): boolean {
  return /exist/i.test(`${r.text} ${r.details}`);
}

/** Never throws: every failure is a typed `{ ok: false }` refusal. */
export async function ensureSubdomain(
  deps: EnsureSubdomainDeps,
  sub: string,
): Promise<EnsureSubdomainOutcome> {
  const wait = deps.wait ?? sleep;
  try {
    if (await deps.subdomainExists(sub)) return { ok: true, existed: true };

    const created = await deps.createSubdomain(sub);
    if (!created.error) return { ok: true, existed: false };
    if (isAlreadyExistsError(created)) return { ok: true, existed: true };

    // Reported failure — but DA may have finished the job after it stopped
    // answering us. Look before believing it.
    for (let attempt = 0; attempt < RECHECK_ATTEMPTS; attempt++) {
      await wait(RECHECK_DELAY_MS);
      if (await deps.subdomainExists(sub)) return { ok: true, existed: true };
    }

    // Both halves, because DA splits the useful part off: `text` is usually
    // the bare word "Error" and `details` carries the actual reason.
    const message = [created.text, created.details].map((s) => s.trim()).filter(Boolean).join(": ");
    return { ok: false, error: message || "subdomain creation failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "subdomain creation failed" };
  }
}
