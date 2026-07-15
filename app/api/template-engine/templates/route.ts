import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { unzipToMap } from "@/lib/template-engine/zip";
import { buildManifest, validateTemplate } from "@/lib/template-engine/manifest";
import { extractDemoTokens } from "@/lib/template-engine/demoTokens";
import { businessSlug } from "@/lib/template-engine/slug";
import { contentTypeFor } from "@/lib/template-engine/runner";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const BUCKET = "website-templates";

async function guard(
  check: (perms: Set<string>) => boolean
): Promise<{ error: 401 } | { error: 403 } | { userId: string; perms: Set<string> }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!check(perms)) return { error: 403 };
  return { userId: user.id, perms };
}

function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

const canGenerate = (p: Set<string>) => p.has("templates.generate") || p.has("templates.manage");
const canManage = (p: Set<string>) => p.has("templates.manage");

export async function GET(req: Request) {
  const auth = await guard(canGenerate);
  if ("error" in auth) return guardError(auth.error);

  const url = new URL(req.url);
  // archived templates are only visible to managers who explicitly ask (?all=1)
  const includeArchived = url.searchParams.get("all") === "1" && auth.perms.has("templates.manage");

  const admin = createAdminClient();
  let query = admin.from("website_templates").select("*").order("created_at", { ascending: false });
  if (!includeArchived) query = query.eq("status", "active");
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await guard(canManage);
  if ("error" in auth) return guardError(auth.error);

  const form = await req.formData();
  const file = form.get("file");
  const name = String(form.get("name") ?? "").trim();
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A template zip file is required" }, { status: 422 });
  }
  if (!name) {
    return NextResponse.json({ error: "A template name is required" }, { status: 422 });
  }
  if (file.size > MAX_ZIP_BYTES) {
    return NextResponse.json({ error: "Template zip must be 25MB or smaller" }, { status: 422 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let filesMap: Record<string, Uint8Array>;
  try {
    filesMap = unzipToMap(bytes);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not read the zip file" },
      { status: 422 }
    );
  }

  const manifest = buildManifest(filesMap);
  const invalid = validateTemplate(manifest);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 422 });

  // Derive the template's demo identity ONCE, here, so the post-build leak gate
  // has something to check for. A template uploaded without this ships with
  // demo_tokens = [] and the gate protects nothing — which is exactly how v1
  // shipped "Northpoint Remodeling" to a client who bought a Warrior site.
  const templateText: Record<string, string> = {};
  const decoder = new TextDecoder();
  for (const [path, data] of Object.entries(filesMap)) {
    if (/\.(html?|js|mjs)$/i.test(path)) templateText[path] = decoder.decode(data);
  }
  const demoTokens = extractDemoTokens(templateText);

  const admin = createAdminClient();

  // unique slug from the name (-2, -3, ... on collision)
  const base = businessSlug(name);
  let slug = base;
  for (let n = 2; ; n++) {
    const { data: existing } = await admin.from("website_templates").select("id").eq("slug", slug).maybeSingle();
    if (!existing) break;
    slug = `${base}-${n}`;
  }

  const templateId = crypto.randomUUID();
  const entries = Object.entries(filesMap);
  const paths = entries.map(([path]) => `${templateId}/${path}`);
  for (let i = 0; i < entries.length; i += 8) {
    const results = await Promise.all(
      entries.slice(i, i + 8).map(([path, data]) =>
        admin.storage
          .from(BUCKET)
          .upload(`${templateId}/${path}`, data, { contentType: contentTypeFor(path), upsert: true })
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      await admin.storage.from(BUCKET).remove(paths);
      return NextResponse.json({ error: `Upload failed: ${failed.error.message}` }, { status: 500 });
    }
  }

  const { data: row, error: insErr } = await admin
    .from("website_templates")
    .insert({
      id: templateId,
      name,
      slug,
      storage_prefix: templateId,
      manifest,
      demo_tokens: demoTokens,
      page_count: manifest.pages.length,
      status: "active",
      created_by: auth.userId,
    })
    .select("*")
    .single();
  if (insErr || !row) {
    await admin.storage.from(BUCKET).remove(paths);
    return NextResponse.json({ error: insErr?.message ?? "Create failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "template.uploaded",
    entity_type: "website_template",
    entity_id: templateId,
    new_value: { name, slug, page_count: manifest.pages.length, total_bytes: manifest.totalBytes },
  });

  return NextResponse.json({ template: row }, { status: 201 });
}
