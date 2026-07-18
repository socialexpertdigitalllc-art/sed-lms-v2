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
  // URL never changes). Otherwise pick the business slug, suffixing only when
  // a different lead already owns it.
  await begin("deploy:subdomain", "Preparing subdomain");
  const linkSub = subFromWebsiteLink(typeof lead.website_link === "string" ? lead.website_link : null, domain);
  let sub: string;
  let inPlace = false;
  if (linkSub && (await subdomainExists(linkSub))) {
    sub = linkSub;
    inPlace = true;
  } else {
    sub = base;
    if (await subdomainExists(sub)) sub = `${base}-${idPart}`;
    if (await subdomainExists(sub)) inPlace = true; // prior partial attempt left it — reuse
  }

  if (inPlace) {
    // Empty the docroot first so pages removed by a regeneration never linger.
    const cleared = await clearDocroot(sub);
    if (!cleared.ok) {
      await failStep(cleared.message ?? "could not clear the existing site");
      return NextResponse.json(
        { error: `Could not clear the existing site for redeploy: ${cleared.message ?? "unknown"}` },
        { status: 502 }
      );
    }
  } else {
    const created = await createSubdomain(sub);
    if (created.error) {
      const text = `${created.text} ${created.details}`.toLowerCase();
      if (text.includes("exist")) {
        // creation race — it exists now; clear and continue in place
        const cleared = await clearDocroot(sub);
        if (!cleared.ok) {
          await failStep(cleared.message ?? "could not clear the existing site");
          return NextResponse.json(
            { error: `Could not clear the existing site for redeploy: ${cleared.message ?? "unknown"}` },
            { status: 502 }
          );
        }
      } else {
        const message = created.text || created.details || "subdomain creation failed";
        await failStep(message);
        return NextResponse.json({ error: `Could not create subdomain: ${message}` }, { status: 502 });
      }
    }
  }
  await end("done", `${sub}.${domain}${inPlace ? " (redeployed in place)" : ""}`);

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
  // A fresh subdomain serves http within seconds; the automatic cert lands
  // ~30-60s later (after which http 301s to https). Poll patiently and prefer
  // the https URL — that is the durable address for the lead's website_link.
  await begin("deploy:verify", "Verifying site (waiting for HTTPS)");
  const host = `${sub}.${domain}`;
  const url = `https://${host}`; // the durable address (http 301s here once the cert lands)
  let verified = false;
  const verifyDeadline = Date.now() + 90000;
  while (Date.now() < verifyDeadline && !verified) {
    for (const scheme of ["https", "http"] as const) {
      try {
        const res = await fetch(`${scheme}://${host}/`, { signal: AbortSignal.timeout(8000) });
        if (res.ok || res.status === 301 || res.status === 308) {
          verified = true;
          break;
        }
      } catch {
        // not up yet on this scheme
      }
    }
    if (!verified) await new Promise((r) => setTimeout(r, 10000));
  }
  await end(verified ? "done" : "partial", verified ? url : `site did not respond within 90s — using ${url}`);

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
        }
      );
    } catch {}
  }
  state.currentKey = null;
  await end("done", url); // status/deployed_url were already CAS-flipped above

  return NextResponse.json({ url });
}
