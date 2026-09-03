import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSubdomain, reusableSubdomain, InvalidSlugError } from "@/lib/site-studio/deploy/slug";
import { baseSubdomain, firstFreeVersion } from "@/lib/site-studio/deploy/naming";
import { claimedByAnotherLead } from "@/lib/site-studio/deploy/claimed";
import { ensureSubdomain } from "@/lib/site-studio/deploy/ensureSubdomain";
import { BUILDER_SITES_BUCKET } from "./run";

/**
 * Deploy handoff for Site Builder — the same DirectAdmin primitives and the
 * same `resolveSubdomain` one-live-site-per-lead rule `lib/site-studio/deploy/
 * deployRun.ts` uses, adapted to `builder_runs`/its own status machine
 * instead of `studio_runs`. Writes to the SAME `studio_deployments` table
 * (see 0058_site_builder_deployment_origin.sql) so the one existing
 * deployments board keeps managing every deployed site, old and new alike.
 *
 * Two real differences from `deployRun.ts`, both forced by the schema:
 *  - `builder_runs` has no `site_slug` column (nothing in Site Builder needs
 *    one until deploy time) — the subdomain is derived here, once, from the
 *    lead's business name via the shared `naming.ts` scheme: the clean name,
 *    counting up only when the hosting says it is taken.
 *  - `builder_runs.status` HAS a `deployed` value (unlike `studio_runs`,
 *    which never leaves deployment as a bare "ready" run) — a successful
 *    deploy here moves the run to `deployed`; a later redeploy for the same
 *    lead is a NEW run (new template pick, new pages, new images), not a
 *    second deploy of this one.
 */
export interface DeployBuilderRunDeps {
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
  /** Optional, and injected only by tests: the pause `ensureSubdomain` takes
   *  between re-checks after a create reports failure. Production leaves it
   *  unset and gets real seconds. */
  wait?: (ms: number) => Promise<void>;
}

export type DeployBuilderRunOutcome =
  | { ok: true; url: string; sub: string; reused: boolean; existed: boolean; clearWarning?: string }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): DeployBuilderRunOutcome => ({ ok: false, status, error });

/**
 * The subdomain a first deploy gets: the business name, clean, and nothing
 * else. It used to carry six random base36 characters to guarantee
 * uniqueness, which made every link we send a client look like a phishing
 * URL. Uniqueness now comes from asking who OWNS the name (see claimed.ts) and
 * counting up only when another lead's live site holds it.
 *
 * Redeploys never reach this: `resolveSubdomain` reuses the subdomain already
 * in the lead's `website_link` (written back at the end of a successful
 * deploy), so an existing site keeps its name.
 */
async function freeSubdomainFor(
  admin: SupabaseClient,
  businessName: string,
  leadId: string | null,
): Promise<string> {
  return firstFreeVersion(baseSubdomain(businessName), (s) => claimedByAnotherLead(admin, s, leadId));
}

async function upsertDeployment(
  admin: SupabaseClient,
  args: { sub: string; docroot: string; url: string; status: "live" | "failed"; leadId: string | null },
): Promise<{ error: { message: string } | null }> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("studio_deployments")
    .upsert(
      {
        lead_id: args.leadId,
        // No `studio_runs` row backs a Site Builder deploy — same NULL
        // convention 0055 already uses for `origin:'v2_import'` rows.
        run_id: null,
        subdomain: args.sub,
        docroot: args.docroot,
        url: args.url,
        status: args.status,
        origin: "builder",
        taken_down_at: null,
        deployed_at: now,
        updated_at: now,
      },
      { onConflict: "subdomain" },
    )
    .select()
    .single();
  return { error: error ?? null };
}

/** Never throws — every failure mode is a typed `{ok:false}` refusal or a
 *  caught exception turned into one (same discipline as `deployRun.ts`). */
export async function deployBuilderRun(
  admin: SupabaseClient,
  runId: string,
  deps: DeployBuilderRunDeps,
  actorUserId: string | null,
): Promise<DeployBuilderRunOutcome> {
  try {
    if (!deps.daConfigured()) {
      return fail(422, "Deployment is not configured. Set DA_HOST, DA_USERNAME, DA_LOGIN_KEY, DA_DOMAIN.");
    }

    const { data: runData, error: runErr } = await admin.from("builder_runs").select("*").eq("id", runId).single();
    if (runErr || !runData) return fail(404, "Run not found");
    const run = runData as Record<string, unknown>;

    if (run.status !== "approved" || !run.output_path) {
      const reason = run.status !== "approved" ? `this run is "${run.status}"` : "it has no packaged zip";
      return fail(409, `Cannot deploy: ${reason}.`);
    }
    const leadId = run.lead_id as string | null;
    if (!leadId) return fail(422, "This run has no lead");

    // Transient claim (CAS on updated_at) — same shape deployRun.ts uses,
    // so two deploy clicks on the same run can't race clearDocroot+upload
    // against each other on the same docroot.
    const { data: claimed, error: claimErr } = await admin
      .from("builder_runs")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("updated_at", run.updated_at as string)
      .select("*")
      .single();
    if (claimErr || !claimed) {
      return fail(409, "A deploy is already running for this run. Wait for it to finish, then try again.");
    }

    const { data: leadData, error: leadErr } = await admin.from("leads").select("*").eq("id", leadId).single();
    if (leadErr || !leadData) return fail(404, "Lead not found");
    const lead = leadData as Record<string, unknown>;

    let resolved: { sub: string; reused: boolean };
    try {
      const websiteLink = typeof lead.website_link === "string" ? lead.website_link : null;
      // A redeploy keeps the subdomain it is already live on, so only a FIRST
      // deploy pays for the free-name lookup against the hosting.
      const siteSlug = reusableSubdomain(websiteLink, deps.daDomain)
        ? ""
        : await freeSubdomainFor(admin, String(lead.business_name ?? ""), leadId);
      resolved = resolveSubdomain({
        leadWebsiteLink: websiteLink,
        siteSlug,
        daDomain: deps.daDomain,
      });
    } catch (e) {
      return fail(422, e instanceof InvalidSlugError ? e.message : "Could not resolve a subdomain for this deploy");
    }
    const { sub, reused } = resolved;

    // Cross-lead conflict guard — before any DirectAdmin call (same as
    // deployRun.ts's own guard, and against the same table).
    const { data: existingDeployment } = await admin
      .from("studio_deployments")
      .select("*")
      .eq("subdomain", sub)
      .maybeSingle();
    if (existingDeployment && existingDeployment.status === "live" && existingDeployment.lead_id !== leadId) {
      const owner = existingDeployment.lead_id ? `a different lead (${existingDeployment.lead_id})` : "an unlinked deployment";
      return fail(
        409,
        `Subdomain "${sub}" is already live for ${owner}. Refusing to deploy — this would overwrite that site. ` +
          `Take the existing deployment down from the deployments board first, then retry.`,
      );
    }

    const ensured = await ensureSubdomain(deps, sub);
    if (!ensured.ok) return fail(502, `Could not create subdomain: ${ensured.error}`);
    const existed = ensured.existed;

    // Fetch and validate the zip BEFORE touching the live docroot — a
    // storage failure must never leave a live site wiped with nothing to
    // replace it.
    const url = `https://${sub}.${deps.daDomain}`;
    const docroot = deps.docrootFor(sub);
    const outputPath = run.output_path as string;
    const { data: zipBlob, error: zipErr } = await admin.storage.from(BUILDER_SITES_BUCKET).download(outputPath);
    if (zipErr || !zipBlob) {
      await upsertDeployment(admin, { sub, docroot, url, status: "failed", leadId });
      return fail(500, "Site zip not found in storage — the live site (if any) was not touched.");
    }
    const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());

    let clearWarning: string | undefined;
    if (existed) {
      const cleared = await deps.clearDocroot(sub);
      if (!cleared.ok) {
        clearWarning = `Could not clear the previous site's files before uploading (${cleared.message ?? "clear failed"}) — the live site may now be a mix of the old and new generation.`;
      }
    }

    const uploaded = await deps.uploadZipAndExtract(sub, zipBytes, "site.zip");
    if (!uploaded.ok && uploaded.failedStep !== "delete") {
      await upsertDeployment(admin, { sub, docroot, url, status: "failed", leadId });
      const message = `${uploaded.failedStep}: ${uploaded.message ?? "failed"}`;
      return fail(502, `Deployment failed at ${message}`);
    }

    // Retire any OTHER live row for this lead first — the partial unique
    // index (one live row per lead) would otherwise reject this upsert.
    const { data: siblings, error: siblingsErr } = await admin
      .from("studio_deployments")
      .select("*")
      .eq("lead_id", leadId);
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

    const { error: upsertErr } = await upsertDeployment(admin, { sub, docroot, url, status: "live", leadId });
    if (upsertErr) {
      return fail(
        500,
        `Deployed to ${url}, but recording it in studio_deployments failed: ${upsertErr.message}. ` +
          `The site IS live — please check studio_deployments manually.`,
      );
    }

    const { error: runUpdErr } = await admin
      .from("builder_runs")
      .update({ status: "deployed", deployed_url: url, updated_at: new Date().toISOString() })
      .eq("id", runId)
      .select("*")
      .single();
    if (runUpdErr) {
      return fail(500, `Deployed to ${url}, but could not record it on the run: ${runUpdErr.message}. The site IS live.`);
    }

    const { error: leadUpdErr } = await admin.from("leads").update({ website_link: url }).eq("id", leadId);
    if (leadUpdErr) {
      return fail(500, `Deployed to ${url}, but could not update the lead's website_link: ${leadUpdErr.message}. The site IS live.`);
    }

    const { error: logErr } = await admin.from("activity_log").insert({
      user_id: actorUserId,
      action: "site_builder.run.deployed",
      entity_type: "builder_run",
      entity_id: runId,
      new_value: { url, subdomain: sub, lead_id: leadId },
    });
    if (logErr) {
      return fail(500, `Deployed to ${url}, but could not write the activity log entry: ${logErr.message}. The site IS live.`);
    }

    // Tell the lead's agent their site is live. Best-effort by design: the
    // site IS deployed and every record is written by this point, so a
    // notification problem must never turn a successful deploy into a
    // failure. Lives HERE rather than in the route so the headless
    // auto-deploy path (lib/site-builder/autoDeploy.ts) delivers exactly the
    // same notification as an operator's manual deploy click.
    try {
      const { notify } = await import("@/lib/notifications/notify");
      await notify(
        "website_link_added",
        {
          leadId,
          lead: { agent_id: lead.agent_id as string | null, closed_by: lead.closed_by as string | null },
          actorId: actorUserId,
        },
        {
          title: "Website live",
          body: `${String(lead.business_name ?? "This lead")}'s website is live: ${url}`,
          dedupKey: `website_link_added:${leadId}:${url}`,
          targetUrl: `/leads/${leadId}`,
          websiteUrl: url,
        },
      );
    } catch {
      /* notification is never worth failing a live deploy over */
    }

    return { ok: true, url, sub, reused, existed, clearWarning };
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "Deploy failed unexpectedly");
  }
}
