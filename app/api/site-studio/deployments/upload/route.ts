import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import {
  daConfigured,
  createSubdomain,
  deleteSubdomain,
  subdomainExists,
  clearDocroot,
  uploadZipAndExtract,
} from "@/lib/template-engine/directadmin";
import { baseSubdomain, firstFreeVersion, nextVersionSubdomain } from "@/lib/site-studio/deploy/naming";
import { adoptSubdomain } from "@/lib/site-studio/deploy/manage";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ZIP_BYTES = 60 * 1024 * 1024;

/**
 * POST /api/site-studio/deployments/upload (multipart) — the unified board's
 * manual site upload.
 *   file: .zip of a static site (files at the archive root)
 *   mode: "new"      + name       → fresh subdomain {first-2-words}vN (first free)
 *         "override" + subdomain  → clear + re-upload the existing subdomain in place
 *         "version"  + subdomain  → upload to {prev}vN+1, then delete the previous subdomain
 *
 * Every upload is tracked in studio_deployments (origin 'manual' for new
 * adoptions) so the site shows on the board and can be linked to a lead.
 */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  if (!daConfigured()) return NextResponse.json({ error: "Deployment is not configured." }, { status: 422 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload" }, { status: 400 });
  }
  const file = form.get("file");
  const mode = String(form.get("mode") ?? "");
  const targetSub = String(form.get("subdomain") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();

  if (!(file instanceof File)) return NextResponse.json({ error: "No zip file uploaded" }, { status: 400 });
  if (!/\.zip$/i.test(file.name) && file.type !== "application/zip") {
    return NextResponse.json({ error: "The upload must be a .zip file" }, { status: 422 });
  }
  if (file.size > MAX_ZIP_BYTES) return NextResponse.json({ error: "Zip is too large (max 60MB)" }, { status: 422 });
  if (mode !== "new" && mode !== "override" && mode !== "version") {
    return NextResponse.json({ error: "mode must be 'new', 'override' or 'version'" }, { status: 422 });
  }

  const domain = process.env.DA_DOMAIN ?? "";
  const admin = createAdminClient();
  const bytes = new Uint8Array(await file.arrayBuffer());

  let sub: string;
  let previousSub: string | null = null;

  if (mode === "new") {
    if (!name) return NextResponse.json({ error: "Enter a site/business name for the subdomain" }, { status: 422 });
    try {
      sub = await firstFreeVersion(baseSubdomain(name), subdomainExists);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "No free subdomain" }, { status: 502 });
    }
    const created = await createSubdomain(sub);
    if (created.error && !/exist/.test(`${created.text} ${created.details}`.toLowerCase())) {
      return NextResponse.json(
        { error: `Could not create subdomain: ${created.text || created.details || "failed"}` },
        { status: 502 },
      );
    }
  } else {
    if (!targetSub || !/^[a-z0-9-]{1,63}$/.test(targetSub)) {
      return NextResponse.json({ error: "Pick an existing subdomain" }, { status: 422 });
    }
    const exists = await subdomainExists(targetSub);
    if (!exists) {
      return NextResponse.json({ error: `Subdomain "${targetSub}.${domain}" does not exist` }, { status: 404 });
    }
    if (mode === "override") {
      sub = targetSub;
      const cleared = await clearDocroot(sub);
      if (!cleared.ok) console.warn(`[upload] clearDocroot(${sub}) failed: ${cleared.message}`);
    } else {
      // version: fresh {prev}vN+1, bumping past any taken labels
      previousSub = targetSub;
      let candidate = nextVersionSubdomain(targetSub);
      while (await subdomainExists(candidate)) candidate = nextVersionSubdomain(candidate);
      sub = candidate;
      const created = await createSubdomain(sub);
      if (created.error && !/exist/.test(`${created.text} ${created.details}`.toLowerCase())) {
        return NextResponse.json(
          { error: `Could not create subdomain: ${created.text || created.details || "failed"}` },
          { status: 502 },
        );
      }
    }
  }

  const uploaded = await uploadZipAndExtract(sub, bytes, "upload.zip");
  if (!uploaded.ok && uploaded.failedStep !== "delete") {
    if (mode === "version" || mode === "new") await deleteSubdomain(sub); // rollback the fresh label
    return NextResponse.json(
      { error: `Deployment failed at ${uploaded.failedStep}: ${uploaded.message ?? "failed"}` },
      { status: 502 },
    );
  }

  const url = `https://${sub}.${domain}`;
  const now = new Date().toISOString();

  // Track the site on the board. For "version", the previous subdomain's row
  // (if any) is repointed to the new label; otherwise adopt/refresh.
  let deploymentId: string | null = null;
  let leadId: string | null = null;
  let trackingWarning: string | null = null;
  if (mode === "version") {
    const { data: prevRow } = await admin
      .from("studio_deployments")
      .select("id, lead_id, url")
      .eq("subdomain", previousSub as string)
      .maybeSingle();
    const oldUrl = prevRow?.url ?? `https://${previousSub}.${domain}`;
    if (prevRow) {
      await admin
        .from("studio_deployments")
        .update({ subdomain: sub, docroot: `/domains/${sub}.${domain}/public_html`, url, deployed_at: now, updated_at: now })
        .eq("id", prevRow.id);
      deploymentId = prevRow.id;
      leadId = prevRow.lead_id ?? null;
      if (leadId) await admin.from("leads").update({ website_link: url }).eq("id", leadId).eq("website_link", oldUrl);
      await admin.from("builder_runs").update({ deployed_url: url, updated_at: now }).eq("deployed_url", oldUrl);
    } else {
      const adopted = await adoptSubdomain(admin, sub, auth.userId);
      if ("error" in adopted) trackingWarning = adopted.error;
      else deploymentId = adopted.row.id;
    }
    // the new version is live — retire the old subdomain
    await deleteSubdomain(previousSub as string);
  } else {
    const adopted = await adoptSubdomain(admin, sub, auth.userId);
    if ("error" in adopted) trackingWarning = adopted.error;
    else {
      deploymentId = adopted.row.id;
      leadId = adopted.row.lead_id;
      if (mode === "override") {
        await admin.from("studio_deployments").update({ status: "live", deployed_at: now, updated_at: now }).eq("id", adopted.row.id);
      }
    }
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.deployment.uploaded",
    entity_type: "studio_deployment",
    entity_id: deploymentId,
    new_value: { mode, subdomain: sub, previous_subdomain: previousSub, url },
  });

  // quick, non-blocking reachability check
  let reachable = false;
  for (const scheme of ["https", "http"] as const) {
    try {
      const res = await fetch(`${scheme}://${sub}.${domain}/`, { signal: AbortSignal.timeout(4000) });
      if (res.ok || res.status === 301 || res.status === 308) {
        reachable = true;
        break;
      }
    } catch {
      // still provisioning
    }
  }

  return NextResponse.json({
    url,
    subdomain: sub,
    deploymentId,
    leadId,
    provisioning: !reachable,
    trackingWarning,
  });
}
