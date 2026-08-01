import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import {
  daConfigured,
  subFromWebsiteLink,
  clearDocroot,
  uploadZipAndExtract,
} from "@/lib/template-engine/directadmin";
import { hostingerConfigured, getWebsite } from "@/lib/hostinger/client";
import { deployZipToDir } from "@/lib/template-engine/fsDeploy";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ZIP_BYTES = 60 * 1024 * 1024;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/site-studio/deployments/[id]/upload (multipart { file }) —
 * override a live site's files in place with an uploaded zip. Works for both
 * staging subdomains (DirectAdmin clear + extract) and custom-domain sites
 * (fs write into the Hostinger addon docroot).
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No zip file uploaded" }, { status: 400 });
  if (!/\.zip$/i.test(file.name) && file.type !== "application/zip") {
    return NextResponse.json({ error: "The upload must be a .zip file" }, { status: 422 });
  }
  if (file.size > MAX_ZIP_BYTES) return NextResponse.json({ error: "Zip is too large (max 60MB)" }, { status: 422 });

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("studio_deployments")
    .select("id, subdomain, url, status")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Deployment not found" }, { status: 404 });
  if (row.status !== "live") return NextResponse.json({ error: "Only a live site can be overridden" }, { status: 409 });

  const daDomain = process.env.DA_DOMAIN ?? "";
  const sub = subFromWebsiteLink(row.url, daDomain);
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (sub) {
    if (!daConfigured()) return NextResponse.json({ error: "DirectAdmin is not configured." }, { status: 422 });
    const cleared = await clearDocroot(sub);
    if (!cleared.ok) console.warn(`[override] clearDocroot(${sub}) failed: ${cleared.message}`);
    const uploaded = await uploadZipAndExtract(sub, bytes, "upload.zip");
    if (!uploaded.ok && uploaded.failedStep !== "delete") {
      return NextResponse.json(
        { error: `Upload failed at ${uploaded.failedStep}: ${uploaded.message ?? "failed"}` },
        { status: 502 },
      );
    }
  } else {
    // custom domain — write straight into the addon docroot
    if (!hostingerConfigured()) return NextResponse.json({ error: "Hostinger is not configured." }, { status: 422 });
    let domain: string;
    try {
      domain = new URL(row.url).hostname.toLowerCase();
    } catch {
      return NextResponse.json({ error: "Deployment URL is not valid" }, { status: 409 });
    }
    const site = await getWebsite(domain);
    if (!site) return NextResponse.json({ error: `No hosting website found for ${domain}` }, { status: 502 });
    try {
      await deployZipToDir(bytes, site.root_directory);
    } catch (e) {
      return NextResponse.json(
        { error: `Could not write the site to ${domain}: ${e instanceof Error ? e.message : "write failed"}` },
        { status: 502 },
      );
    }
  }

  const now = new Date().toISOString();
  await admin.from("studio_deployments").update({ deployed_at: now, updated_at: now, deployed_by: auth.userId }).eq("id", id);
  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.deployment.overridden",
    entity_type: "studio_deployment",
    entity_id: id,
    new_value: { url: row.url },
  });

  return NextResponse.json({ ok: true, url: row.url });
}
