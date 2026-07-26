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
  | { ok: true; url: string; sub: string; reused: boolean; existed: boolean }
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
    // clearDocroot+upload runs. A LIVE row under a different lead is the
    // only case that blocks: taken_down/failed rows are history and may be
    // reclaimed by a new lead reusing the same slugified name.
    const { data: existingDeployment } = await admin
      .from("studio_deployments")
      .select("*")
      .eq("subdomain", sub)
      .maybeSingle();
    if (
      existingDeployment &&
      existingDeployment.status === "live" &&
      existingDeployment.lead_id &&
      existingDeployment.lead_id !== run.lead_id
    ) {
      return fail(
        409,
        `Subdomain "${sub}" is already live for a different lead (${existingDeployment.lead_id}). ` +
          `Refusing to deploy — this would overwrite that lead's site.`,
      );
    }

    // deploy:subdomain ---------------------------------------------------
    let existed: boolean;
    if (reused) {
      // One live site per lead: the lead's website_link already resolved to
      // THIS subdomain, so it exists by construction — no creation call.
      existed = true;
    } else {
      existed = await deps.subdomainExists(sub);
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
    }

    // On a redeploy, clear stale files FIRST so a regeneration that dropped
    // pages never leaves them lingering — this must happen before upload,
    // never after (see this module's own doc comment / Task 9 spec). Clear
    // failure is reported but non-fatal: extraction overwrites same-named
    // files regardless, matching the v2 route's own tradeoff.
    let clearNote = "";
    if (existed) {
      const cleared = await deps.clearDocroot(sub);
      if (!cleared.ok) clearNote = ` (stale files kept: ${cleared.message ?? "clear failed"})`;
    }
    void clearNote; // surfaced only in the (currently unused) step-log path; kept for parity with v2's messaging

    // deploy:upload --------------------------------------------------------
    const url = `https://${sub}.${deps.daDomain}`;
    const docroot = deps.docrootFor(sub);

    const { data: zipBlob, error: zipErr } = await admin.storage.from(SITES_BUCKET).download(run.zip_path);
    if (zipErr || !zipBlob) {
      await upsertDeployment(admin, { sub, docroot, url, status: "failed", runId, leadId: run.lead_id });
      return fail(500, "Site zip not found in storage");
    }
    const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
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
    await upsertDeployment(admin, { sub, docroot, url, status: "live", runId, leadId: run.lead_id });

    await admin
      .from("studio_runs")
      .update({ deployed_url: url, updated_at: new Date().toISOString() })
      .eq("id", runId)
      .select("*")
      .single();
    await admin.from("leads").update({ website_link: url }).eq("id", run.lead_id);
    await admin.from("activity_log").insert({
      user_id: actorUserId,
      action: "studio.run.deployed",
      entity_type: "studio_run",
      entity_id: runId,
      new_value: { url, subdomain: sub, lead_id: run.lead_id },
    });

    return { ok: true, url, sub, reused, existed };
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "Deploy failed unexpectedly");
  }
}

async function upsertDeployment(
  admin: SupabaseClient,
  args: { sub: string; docroot: string; url: string; status: "live" | "failed"; runId: string; leadId: string | null },
): Promise<void> {
  await admin
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
      },
      { onConflict: "subdomain" },
    )
    .select()
    .single();
}
