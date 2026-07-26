import type { SupabaseClient } from "@supabase/supabase-js";
import { SITES_BUCKET } from "../run/finalize";
import type { StudioRunRow } from "../run/types";
import { resolveSubdomain, InvalidSlugError } from "./slug";

/**
 * The exact DirectAdmin surface this service needs, injected so tests never
 * touch the network (spec: deploy is a pure handoff, verified against real
 * infra only in Task 12's throwaway-subdomain run). `daDomain` is passed
 * alongside rather than read from `process.env` inside this module so the
 * whole service stays as pure as `resolveSubdomain` itself.
 */
export interface DeployRunDeps {
  daConfigured: () => boolean;
  daDomain: string;
  createSubdomain: (sub: string) => Promise<{ error: boolean; text: string; details: string }>;
  subdomainExists: (sub: string) => Promise<boolean>;
  clearDocroot: (sub: string) => Promise<{ ok: boolean; message?: string }>;
  uploadZipAndExtract: (
    sub: string,
    zipBytes: Uint8Array,
    zipName: string,
  ) => Promise<{ ok: boolean; failedStep?: "upload" | "extract" | "delete"; message?: string }>;
  docrootFor: (sub: string) => string;
}

export type DeployRunOutcome =
  | { ok: true; url: string; sub: string; reused: boolean; existed: boolean; clearWarning?: string }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): DeployRunOutcome => ({ ok: false, status, error });

/** "subdomain already exists" comes back as an error from `createSubdomain`
 *  on a rare random collision — that is a race won by someone/something
 *  else between our `subdomainExists` check and the create call, not a real
 *  failure, so it's treated as "it exists now" and the deploy proceeds. */
function isAlreadyExistsError(r: { text: string; details: string }): boolean {
  return /exist/i.test(`${r.text} ${r.details}`);
}

/**
 * Deploy handoff to the kept DirectAdmin layer (spec §9/§13, Phase 4a Task
 * 9). Re-implements the v2 route's contract
 * (`app/api/template-engine/generations/[id]/deploy/route.ts`) against
 * `studio_runs`/`studio_deployments` instead of `template_generations`.
 *
 * Never throws: every code path below is either a typed `{ ok:false }`
 * refusal or a caught exception turned into one, because a thrown error here
 * would surface as an opaque 500 to an operator who just wants to know why
 * their client's site didn't go live.
 */
export async function deployRun(
  admin: SupabaseClient,
  runId: string,
  deps: DeployRunDeps,
  actorUserId: string | null,
): Promise<DeployRunOutcome> {
  try {
    if (!deps.daConfigured()) {
      return fail(422, "Deployment is not configured. Set DA_HOST, DA_USERNAME, DA_LOGIN_KEY, DA_DOMAIN.");
    }

    const { data: runData, error: runErr } = await admin.from("studio_runs").select("*").eq("id", runId).single();
    if (runErr || !runData) return fail(404, "Run not found");
    const run = runData as unknown as StudioRunRow;

    if (run.status !== "ready" || !run.zip_path) {
      const reason = run.status !== "ready" ? `this run is "${run.status}"` : "it has no packaged zip";
      return fail(409, `Cannot deploy: ${reason}.`);
    }
    if (!run.lead_id) return fail(422, "This run has no lead");

    // Transient claim (review FIX 5) — a single-winner CAS on `updated_at`,
    // the same shape `engine.ts`'s (unexported) `claimRun` uses for step
    // claims. Two deploy clicks (or an impatient double-submit) both read
    // this row at the same `updated_at`; only the first `.eq("updated_at",
    // …)` UPDATE actually matches, so the second gets zero rows back and is
    // told a deploy is already running rather than racing clearDocroot +
    // upload against itself on the SAME docroot. No separate release step is
    // needed: the next legitimate deploy (after this one finishes, success
    // or failure) simply reads the fresh `updated_at` this bump left behind.
    const { data: claimed, error: claimErr } = await admin
      .from("studio_runs")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("updated_at", run.updated_at)
      .select("*")
      .single();
    if (claimErr || !claimed) {
      return fail(409, "A deploy is already running for this run. Wait for it to finish, then try again.");
    }

    const { data: leadData, error: leadErr } = await admin.from("leads").select("*").eq("id", run.lead_id).single();
    if (leadErr || !leadData) return fail(404, "Lead not found");
    const lead = leadData as Record<string, unknown>;

    let resolved: { sub: string; reused: boolean };
    try {
      resolved = resolveSubdomain({
        leadWebsiteLink: typeof lead.website_link === "string" ? lead.website_link : null,
        siteSlug: run.site_slug,
        daDomain: deps.daDomain,
      });
    } catch (e) {
      return fail(422, e instanceof InvalidSlugError ? e.message : "Could not resolve a subdomain for this deploy");
    }
    const { sub, reused } = resolved;

    // Cross-lead conflict guard — BEFORE any DirectAdmin call. Two leads
    // whose business names slugify alike would otherwise land on the same
    // subdomain and physically overwrite each other's live site the moment
    // clearDocroot+upload runs. A LIVE row blocks whenever its `lead_id` is
    // NULL (an orphaned row via `on delete set null`, or an unlinked
    // `v2_import` row Phase 4b will seed) OR belongs to a different lead
    // (review FIX 3) — a null lead_id is not "nobody's site", it's "we don't
    // know whose site this is", and the safe default is to refuse and point
    // the operator at the deployments board rather than risk clobbering a
    // possibly-live v2 client site. Taken_down/failed rows are history and
    // may be reclaimed freely.
    const { data: existingDeployment } = await admin
      .from("studio_deployments")
      .select("*")
      .eq("subdomain", sub)
      .maybeSingle();
    if (existingDeployment && existingDeployment.status === "live" && existingDeployment.lead_id !== run.lead_id) {
      const owner = existingDeployment.lead_id ? `a different lead (${existingDeployment.lead_id})` : "an unlinked deployment";
      return fail(
        409,
        `Subdomain "${sub}" is already live for ${owner}. Refusing to deploy — this would overwrite that site. ` +
          `Take the existing deployment down from the deployments board first, then retry.`,
      );
    }

    // deploy:subdomain — always check-then-create, for BOTH resolution paths
    // (review FIX 6): `reused` only means "this sub came from the lead's own
    // website_link", not "it definitely still exists on DirectAdmin" — it
    // can have been removed out-of-band. Checking uniformly means a vanished
    // reused subdomain is simply recreated instead of failing confusingly
    // deeper in clear/upload.
    let existed = await deps.subdomainExists(sub);
    if (!existed) {
      const created = await deps.createSubdomain(sub);
      if (created.error) {
        if (!isAlreadyExistsError(created)) {
          const message = created.text || created.details || "subdomain creation failed";
          return fail(502, `Could not create subdomain: ${message}`);
        }
        existed = true; // race: it appeared between our check and the create
      }
    }

    // deploy:fetch — download and validate the zip BEFORE touching the live
    // docroot (review FIX 1, CRITICAL). The old ordering cleared the docroot
    // first and only then reached for the zip: a download or upload failure
    // after that point left a client's real site wiped at its real URL with
    // nothing to replace it, while the DB merely said "failed". Fetching
    // first means the worst a storage failure can do is refuse the deploy
    // with the live site UNTOUCHED.
    const url = `https://${sub}.${deps.daDomain}`;
    const docroot = deps.docrootFor(sub);
    const { data: zipBlob, error: zipErr } = await admin.storage.from(SITES_BUCKET).download(run.zip_path);
    if (zipErr || !zipBlob) {
      await upsertDeployment(admin, { sub, docroot, url, status: "failed", runId, leadId: run.lead_id });
      return fail(500, "Site zip not found in storage — the live site (if any) was not touched.");
    }
    const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());

    // deploy:clear — only now, holding the bytes we're about to upload, is
    // it safe to empty a pre-existing docroot so a regeneration that dropped
    // pages doesn't leave them lingering. Best-effort: extraction overwrites
    // same-named files regardless, matching the v2 route's own tradeoff, but
    // the operator is told (review FIX 4) so a mixed-generation site is
    // never silently mistaken for a clean deploy.
    let clearWarning: string | undefined;
    if (existed) {
      const cleared = await deps.clearDocroot(sub);
      if (!cleared.ok) {
        clearWarning = `Could not clear the previous site's files before uploading (${cleared.message ?? "clear failed"}) — the live site may now be a mix of the old and new generation.`;
      }
    }

    // deploy:upload --------------------------------------------------------
    const uploaded = await deps.uploadZipAndExtract(sub, zipBytes, "site.zip");
    if (!uploaded.ok && uploaded.failedStep !== "delete") {
      // failedStep "delete" means the site IS live and only zip cleanup
      // failed — non-fatal, matching v2. Anything else is a real failure:
      // record it and refuse to mark the run deployed.
      await upsertDeployment(admin, { sub, docroot, url, status: "failed", runId, leadId: run.lead_id });
      const message = `${uploaded.failedStep}: ${uploaded.message ?? "failed"}`;
      return fail(502, `Deployment failed at ${message}`);
    }

    // deploy:record ----------------------------------------------------------
    // Retire any OTHER live row for this lead FIRST (review FIX 2a). The
    // partial unique index `studio_deployments_one_live_per_lead` allows only
    // one status='live' row per lead_id, so a drifted `website_link` (this
    // deploy resolving to a DIFFERENT subdomain than the lead's last known
    // live one) must close the old row out before the new one can be
    // upserted live, or the real constraint would reject this write outright
    // — and reject it AFTER the site is already live on DirectAdmin, which
    // is exactly the "silent success, wrong bookkeeping" failure mode this
    // whole fix list exists to close.
    const { data: siblings, error: siblingsErr } = await admin
      .from("studio_deployments")
      .select("*")
      .eq("lead_id", run.lead_id);
    if (siblingsErr) {
      return fail(
        500,
        `Deployed to ${url}, but could not check for a stale live record to retire: ${siblingsErr.message}. ` +
          `The site IS live — please check studio_deployments manually.`,
      );
    }
    const staleLive = (siblings ?? []).filter((d) => d.status === "live" && d.subdomain !== sub);
    for (const stale of staleLive) {
      const { error: closeErr } = await admin
        .from("studio_deployments")
        .update({ status: "taken_down", taken_down_at: new Date().toISOString() })
        .eq("id", stale.id as string);
      if (closeErr) {
        return fail(
          500,
          `Deployed to ${url}, but could not retire the stale live record at "${stale.subdomain}": ${closeErr.message}. ` +
            `The site IS live — please check studio_deployments manually.`,
        );
      }
    }

    const { error: upsertErr } = await upsertDeployment(admin, { sub, docroot, url, status: "live", runId, leadId: run.lead_id });
    if (upsertErr) {
      return fail(
        500,
        `Deployed to ${url}, but recording it in studio_deployments failed: ${upsertErr.message}. ` +
          `The site IS live — please check studio_deployments manually.`,
      );
    }

    const { error: runUpdErr } = await admin
      .from("studio_runs")
      .update({ deployed_url: url, updated_at: new Date().toISOString() })
      .eq("id", runId)
      .select("*")
      .single();
    if (runUpdErr) {
      return fail(500, `Deployed to ${url}, but could not record it on the run: ${runUpdErr.message}. The site IS live.`);
    }

    const { error: leadUpdErr } = await admin.from("leads").update({ website_link: url }).eq("id", run.lead_id);
    if (leadUpdErr) {
      return fail(500, `Deployed to ${url}, but could not update the lead's website_link: ${leadUpdErr.message}. The site IS live.`);
    }

    const { error: logErr } = await admin.from("activity_log").insert({
      user_id: actorUserId,
      action: "studio.run.deployed",
      entity_type: "studio_run",
      entity_id: runId,
      new_value: { url, subdomain: sub, lead_id: run.lead_id },
    });
    if (logErr) {
      return fail(500, `Deployed to ${url}, but could not write the activity log entry: ${logErr.message}. The site IS live.`);
    }

    return { ok: true, url, sub, reused, existed, clearWarning };
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "Deploy failed unexpectedly");
  }
}

async function upsertDeployment(
  admin: SupabaseClient,
  args: { sub: string; docroot: string; url: string; status: "live" | "failed"; runId: string; leadId: string | null },
): Promise<{ error: { message: string } | null }> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("studio_deployments")
    .upsert(
      {
        lead_id: args.leadId,
        run_id: args.runId,
        subdomain: args.sub,
        docroot: args.docroot,
        url: args.url,
        status: args.status,
        origin: "studio",
        taken_down_at: null,
        // Explicit on EVERY successful upsert (review FIX 8) — an ON
        // CONFLICT DO UPDATE that omits a column leaves it FROZEN at
        // whatever it was on first insert in real Postgres; a redeploy must
        // move both, not just whatever the fake happened to force before.
        deployed_at: now,
        updated_at: now,
      },
      { onConflict: "subdomain" },
    )
    .select()
    .single();
  return { error: error ?? null };
}
