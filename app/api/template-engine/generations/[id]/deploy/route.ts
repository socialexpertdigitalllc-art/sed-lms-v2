import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { notify } from "@/lib/notifications/notify";
import {
  daConfigured,
  createSubdomain,
  subdomainExists,
  uploadZipAndExtract,
  subFromWebsiteLink,
  clearDocroot,
} from "@/lib/template-engine/directadmin";
import { businessSlug, websiteId } from "@/lib/template-engine/slug";
import { DEPLOYABLE_STATUSES, isDeployableStatus } from "@/lib/template-engine/wizard";
import type { GenStep } from "@/lib/template-engine/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.deploy")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!daConfigured()) {
    return NextResponse.json(
      { error: "Deployment is not configured. Set DA_HOST, DA_USERNAME, DA_LOGIN_KEY, DA_DOMAIN." },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data: gen } = await admin
    .from("template_generations")
    .select("id, lead_id, status, steps, site_slug, zip_path, gate_results")
    .eq("id", id)
    .maybeSingle();
  if (!gen) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  if (!isDeployableStatus(gen.status)) {
    return NextResponse.json({ error: "Generation is not ready to deploy" }, { status: 409 });
  }
  const gr = gen.gate_results as { ok?: boolean } | null;
  if (gr && gr.ok === false) {
    return NextResponse.json(
      { error: "Verification gates failed — rebuild before deploying" },
      { status: 409 },
    );
  }
  if (!gen.zip_path) {
    return NextResponse.json({ error: "This generation has no packaged zip" }, { status: 409 });
  }
  const { data: lead } = await admin
    .from("leads")
    .select("id, business_name, agent_id, closed_by, website_link")
    .eq("id", gen.lead_id)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // step machinery — appends to the generation's timeline with the same
  // write-through the runner uses (previous deploy attempts are pruned)
  const steps: GenStep[] = (Array.isArray(gen.steps) ? (gen.steps as GenStep[]) : []).filter(
    (s) => !String(s.key).startsWith("deploy:")
  );
  const state = { currentKey: null as string | null, stepStart: 0 };
  const write = async (extra?: Record<string, unknown>) => {
    await admin
      .from("template_generations")
      .update({ steps, current_step: state.currentKey, updated_at: new Date().toISOString(), ...(extra ?? {}) })
      .eq("id", id);
  };
  const begin = async (key: string, label: string) => {
    steps.push({ key, label, status: "running", started_at: new Date().toISOString() });
    state.currentKey = key;
    state.stepStart = Date.now();
    await write();
  };
  const end = async (status: "done" | "partial", detail?: string, extra?: Record<string, unknown>) => {
    const step = steps[steps.length - 1];
    step.status = status;
    step.ms = Date.now() - state.stepStart;
    if (detail) step.detail = detail;
    await write(extra);
  };
  const failStep = async (detail: string) => {
    const step = steps[steps.length - 1];
    step.status = "failed";
    step.ms = Date.now() - state.stepStart;
    step.detail = detail.slice(0, 300);
    await write();
  };

  const domain = process.env.DA_DOMAIN ?? "";
  const base = businessSlug(String(lead.business_name ?? ""));
  const siteSlug: string = typeof gen.site_slug === "string" ? gen.site_slug : "";
  const idPart = siteSlug.includes("-") ? siteSlug.slice(siteSlug.lastIndexOf("-") + 1) : websiteId();

  // deploy:subdomain -----------------------------------------------------------
  // One live site per lead: when the lead's website_link already points at one
  // of our subdomains, redeploy IN PLACE on that same subdomain (the client's
  // URL never changes). Otherwise the business slug, suffixed only when a
  // different lead already owns it. Kept to at most one DirectAdmin call so the
  // request stays short (a subdomain LIST of ~700 entries was seconds wasted).
  await begin("deploy:subdomain", "Preparing subdomain");
  const linkSub = subFromWebsiteLink(typeof lead.website_link === "string" ? lead.website_link : null, domain);
  const existsErr = (r: { text: string; details: string }) => /exist/.test(`${r.text} ${r.details}`.toLowerCase());
  let sub: string;
  let existed: boolean;
  if (linkSub && (await subdomainExists(linkSub))) {
    sub = linkSub;
    existed = true;
  } else {
    sub = base;
    const created = await createSubdomain(sub);
    if (!created.error) {
      existed = false; // freshly created
    } else if (existsErr(created)) {
      // the business slug is owned by another lead — use a unique suffixed one
      sub = `${base}-${idPart}`;
      const c2 = await createSubdomain(sub);
      if (c2.error && !existsErr(c2)) {
        const message = c2.text || c2.details || "subdomain creation failed";
        await failStep(message);
        return NextResponse.json({ error: `Could not create subdomain: ${message}` }, { status: 502 });
      }
      existed = c2.error; // "exists" (rare random collision) → redeploy in place
    } else {
      const message = created.text || created.details || "subdomain creation failed";
      await failStep(message);
      return NextResponse.json({ error: `Could not create subdomain: ${message}` }, { status: 502 });
    }
  }

  // On a redeploy, clear stale files first so pages dropped by a regeneration
  // don't linger — but BEST-EFFORT: extract overwrites same-named files anyway,
  // so a clear hiccup must never fail the whole deploy.
  let clearNote = "";
  if (existed) {
    const cleared = await clearDocroot(sub);
    if (!cleared.ok) clearNote = ` (stale files kept: ${cleared.message ?? "clear failed"})`;
  }
  await end("done", `${sub}.${domain}${existed ? " (redeploy" + clearNote + ")" : " (new)"}`);

  // deploy:upload --------------------------------------------------------------
  await begin("deploy:upload", "Uploading site");
  const { data: zipBlob, error: zipErr } = await admin.storage.from("template-sites").download(gen.zip_path);
  if (zipErr || !zipBlob) {
    await failStep("site zip missing from storage");
    return NextResponse.json({ error: "Site zip not found in storage" }, { status: 500 });
  }
  const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
  const uploaded = await uploadZipAndExtract(sub, zipBytes, "site.zip");
  if (!uploaded.ok && uploaded.failedStep !== "delete") {
    const message = `${uploaded.failedStep}: ${uploaded.message ?? "failed"}`;
    await failStep(message);
    return NextResponse.json({ error: `Deployment failed at ${message}` }, { status: 502 });
  }
  // failedStep "delete" = the site IS live, only the zip cleanup failed — non-fatal
  await end(
    uploaded.ok ? "done" : "partial",
    uploaded.ok ? undefined : `zip cleanup failed (site is live): ${uploaded.message ?? ""}`
  );

  // deploy:verify ----------------------------------------------------------------
  // A SINGLE quick reachability check — never a long poll. The files are already
  // deployed; whether DirectAdmin has finished provisioning the vhost + cert
  // (which can take a minute+ on a fresh subdomain) is its OWN async job. The
  // old 90s poll blocked the response so long the hosting proxy cut the browser
  // off — a false "error" on a deploy that actually succeeded. So we report
  // reachability but never gate on it; the durable URL is always the https one.
  await begin("deploy:verify", "Checking the site");
  const host = `${sub}.${domain}`;
  const url = `https://${host}`;
  let reachable = false;
  for (const scheme of ["https", "http"] as const) {
    try {
      const res = await fetch(`${scheme}://${host}/`, { signal: AbortSignal.timeout(4000) });
      if (res.ok || res.status === 301 || res.status === 308) {
        reachable = true;
        break;
      }
    } catch {
      // still provisioning — expected on a brand-new subdomain
    }
  }
  await end("done", reachable ? url : `${url} — provisioning, usually live within a minute or two`);

  // deploy:link --------------------------------------------------------------------
  await begin("deploy:link", "Saving website link");
  // Guard against a mid-deploy reopen: CAS the status flip FIRST — only a
  // still-deployable run may become "deployed" and have the lead's website
  // link overwritten. If the operator reopened the run (review → curating)
  // while the upload was in flight, stop here: the uploaded site sits unused
  // on the subdomain, exactly like any failed deploy attempt.
  const { data: flipped, error: flipErr } = await admin
    .from("template_generations")
    .update({ status: "deployed", deployed_url: url, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", [...DEPLOYABLE_STATUSES])
    .select("id")
    .maybeSingle();
  if (flipErr) {
    await failStep(flipErr.message);
    return NextResponse.json({ error: flipErr.message }, { status: 400 });
  }
  if (!flipped) {
    await failStep("Run was reopened during deploy — link not saved");
    return NextResponse.json(
      { error: "Run was reopened during the deploy — the site was uploaded but not linked. Rebuild and deploy again." },
      { status: 409 }
    );
  }
  const { error: linkErr } = await admin.from("leads").update({ website_link: url }).eq("id", gen.lead_id);
  if (linkErr) {
    await failStep(linkErr.message);
    return NextResponse.json({ error: `Deployed, but saving the lead link failed: ${linkErr.message}` }, { status: 500 });
  }
  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "lead.website_link_set",
    entity_type: "lead",
    entity_id: gen.lead_id,
    new_value: { website_link: url, generation_id: id },
  });
  if (url !== lead.website_link) {
    try {
      await notify(
        "website_link_added",
        { leadId: gen.lead_id, lead: { agent_id: lead.agent_id, closed_by: lead.closed_by }, actorId: user.id },
        {
          title: "Website live",
          body: `${lead.business_name}'s website is live: ${url}`,
          dedupKey: `website_link_added:${gen.lead_id}:${new Date().toISOString()}`,
          targetUrl: `/leads/${gen.lead_id}`,
          websiteUrl: url,
        }
      );
    } catch {}
  }
  state.currentKey = null;
  await end("done", url); // status/deployed_url were already CAS-flipped above

  return NextResponse.json({ url, provisioning: !reachable });
}
