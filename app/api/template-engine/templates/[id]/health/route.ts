// Re-run the deterministic template health checks against what is CURRENTLY in
// storage, without re-uploading the template.
//
// Why this route exists: the checks run at upload, but the report they produce
// is only useful if a template that has been fixed can be proven fixed. Without
// a re-check the only way to clear a red pill would be to upload the zip again
// as a new template, which leaves the broken row behind and breaks every
// generation that references the old id.
//
// It also RE-DERIVES demo_tokens. The tokens are a pure function of the same
// files, so recomputation is idempotent — except when the extractor itself has
// improved (which is exactly how the `King` poison-token fix shipped), in which
// case a template uploaded under the old extractor should pick up the new one.
// Re-checking without re-extracting would report on tokens the gate no longer
// uses, which is the sort of quiet inconsistency this whole feature exists to
// eliminate.
//
// Costs nothing but a storage read: no AI, no network beyond Supabase.
//
// TODO (opt-in AI dry-run, deliberately NOT implemented here): a separate
// "Run test generation" action that regenerates index.html against a synthetic
// lead and runs the real gates would catch the residue these deterministic
// checks cannot see (a model that will not stop writing the demo city, say).
// It must reuse runnerV2's regenerate + runGates paths rather than duplicate
// them, must be opt-in per click because it spends real AI credits, and must
// never run on upload. It is not wired up: the plumbing (a synthetic lead, a
// throwaway generation row, credit accounting) is a larger piece of work than
// the whole deterministic check set, and shipping it half-done would put an
// unlabelled spend button in the admin UI.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { listStorageFiles } from "@/lib/template-engine/runner";
import { extractDemoTokens } from "@/lib/template-engine/demoTokens";
import { runTemplateHealthChecks } from "@/lib/template-engine/health";
import type { TemplateManifest } from "@/lib/template-engine/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "website-templates";
const TOKEN_FILE_RE = /\.(html?|m?js)$/i;
const HEALTH_FILE_RE = /\.(html?|m?js|css)$/i;
const DOWNLOAD_BATCH = 8;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Same guard as the other template routes: only a manager may write to a
  // template row, and the report is a write.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: template } = await admin
    .from("website_templates")
    .select("id, storage_prefix, manifest")
    .eq("id", id)
    .single();
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const prefix = String(template.storage_prefix ?? "").replace(/\/+$/, "");
  if (!prefix) return NextResponse.json({ error: "Template has no stored files" }, { status: 409 });

  const paths = (await listStorageFiles(admin, BUCKET, prefix))
    .map((full) => ({ full, rel: full.slice(prefix.length + 1) }))
    .filter(({ rel }) => rel.length > 0 && HEALTH_FILE_RE.test(rel));
  if (paths.length === 0) {
    return NextResponse.json({ error: "Template files not found in storage" }, { status: 409 });
  }

  const decoder = new TextDecoder();
  const healthText: Record<string, string> = {};
  for (let i = 0; i < paths.length; i += DOWNLOAD_BATCH) {
    const batch = await Promise.all(
      paths.slice(i, i + DOWNLOAD_BATCH).map(async ({ full, rel }) => {
        const { data, error } = await admin.storage.from(BUCKET).download(full);
        if (error || !data) throw new Error(`Failed to read ${rel}: ${error?.message ?? "no data"}`);
        return [rel, decoder.decode(new Uint8Array(await data.arrayBuffer()))] as const;
      })
    ).catch((e: unknown) => (e instanceof Error ? e : new Error("Download failed")));
    if (batch instanceof Error) return NextResponse.json({ error: batch.message }, { status: 502 });
    for (const [rel, text] of batch) healthText[rel] = text;
  }

  const tokenText: Record<string, string> = {};
  for (const [rel, text] of Object.entries(healthText)) {
    if (TOKEN_FILE_RE.test(rel)) tokenText[rel] = text;
  }

  const demoTokens = extractDemoTokens(tokenText);
  const health = runTemplateHealthChecks({
    files: healthText,
    demoTokens,
    manifest: (template.manifest ?? null) as TemplateManifest | null,
  });

  const { data: row, error } = await admin
    .from("website_templates")
    .update({
      demo_tokens: demoTokens,
      health,
      health_checked_at: health.checkedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !row) {
    return NextResponse.json({ error: error?.message ?? "Could not store the health report" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "template.health_checked",
    entity_type: "website_template",
    entity_id: id,
    new_value: { status: health.status, checked_at: health.checkedAt },
  });

  return NextResponse.json({ template: row, health });
}
