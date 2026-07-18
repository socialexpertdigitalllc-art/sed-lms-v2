import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import {
  daConfigured,
  createSubdomain,
  subdomainExists,
  clearDocroot,
  uploadZipAndExtract,
} from "@/lib/template-engine/directadmin";
import { businessSlug } from "@/lib/template-engine/slug";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ZIP_BYTES = 60 * 1024 * 1024; // 60MB — generous for a static site

// POST /api/template-engine/deployments/upload (multipart)
//   file: a .zip of a static site (files at the archive root)
//   mode: "new" | "existing"
//   subdomain: the subdomain label under DA_DOMAIN
//
// Deploy a HAND-BUILT / manually-edited site zip straight to a dmviral
// subdomain, independent of the generator — either standing up a new subdomain
// or overwriting an existing one in place. Same DirectAdmin primitives as the
// generation deploy; verification is a quick non-blocking check (see the deploy
// route for why long polls are avoided).
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.deploy")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!daConfigured()) return NextResponse.json({ error: "Deployment is not configured." }, { status: 422 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload" }, { status: 400 });
  }
  const file = form.get("file");
  const mode = String(form.get("mode") ?? "");
  const rawSub = String(form.get("subdomain") ?? "");
  const sub = businessSlug(rawSub);

  if (!(file instanceof File)) return NextResponse.json({ error: "No zip file uploaded" }, { status: 400 });
  if (!/\.zip$/i.test(file.name) && file.type !== "application/zip") {
    return NextResponse.json({ error: "The upload must be a .zip file" }, { status: 422 });
  }
  if (file.size > MAX_ZIP_BYTES) {
    return NextResponse.json({ error: "Zip is too large (max 60MB)" }, { status: 422 });
  }
  if (!sub) return NextResponse.json({ error: "Enter a valid subdomain name" }, { status: 422 });
  if (mode !== "new" && mode !== "existing") {
    return NextResponse.json({ error: "mode must be 'new' or 'existing'" }, { status: 422 });
  }

  const domain = process.env.DA_DOMAIN ?? "";
  const exists = await subdomainExists(sub);

  if (mode === "existing") {
    if (!exists) {
      return NextResponse.json(
        { error: `Subdomain "${sub}.${domain}" does not exist — switch to "new" to create it.` },
        { status: 404 }
      );
    }
    const cleared = await clearDocroot(sub); // best-effort; extract overwrites same names
    if (!cleared.ok) {
      // don't hard-fail; note it and let the upload overwrite what it can
      console.warn(`[upload] clearDocroot(${sub}) failed: ${cleared.message}`);
    }
  } else {
    if (exists) {
      return NextResponse.json(
        { error: `Subdomain "${sub}.${domain}" already exists — choose "update existing" or a different name.` },
        { status: 409 }
      );
    }
    const created = await createSubdomain(sub);
    if (created.error && !/exist/.test(`${created.text} ${created.details}`.toLowerCase())) {
      const message = created.text || created.details || "subdomain creation failed";
      return NextResponse.json({ error: `Could not create subdomain: ${message}` }, { status: 502 });
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploaded = await uploadZipAndExtract(sub, bytes, "upload.zip");
  if (!uploaded.ok && uploaded.failedStep !== "delete") {
    return NextResponse.json(
      { error: `Deployment failed at ${uploaded.failedStep}: ${uploaded.message ?? "failed"}` },
      { status: 502 }
    );
  }

  // quick, non-blocking reachability check
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
      // still provisioning
    }
  }

  return NextResponse.json({ url, subdomain: sub, provisioning: !reachable });
}
