// POST /api/template-engine/templates/[id]/fix — the SAFE "Ask AI to fix" for a
// genuinely-fixable template health failure.
//
// Two steps, both here, distinguished by the request body:
//
//   PREVIEW (default): load the template's files, ask the model (via callForTask
//   — the same routed provider the engine uses) for minimal edits, apply them to
//   an IN-MEMORY copy, re-derive demo_tokens, re-run the health checks on the
//   copy, and return the proposed files plus the before/after health and an
//   `improved` verdict. Writes NOTHING.
//
//   APPLY ({ apply: true, files }): the operator confirms from the preview. The
//   submitted patched files are re-verified server-side (health recomputed from
//   scratch, never trusting the client's claim) and written ONLY when `improved`
//   is true. Before overwriting, every current file is copied to a backup prefix
//   so a bad fix is reversible. Apply makes NO AI call.
//
// The safety model lives in lib/template-engine/fix.ts (copy -> patch -> re-check
// -> decide) and is unit-tested with a mocked model. This route is the I/O shell
// around it: auth, storage reads/writes, the backup, and the activity log.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { contentTypeFor, listStorageFiles } from "@/lib/template-engine/runner";
import { extractDemoTokens } from "@/lib/template-engine/demoTokens";
import { runTemplateHealthChecks } from "@/lib/template-engine/health";
import {
  assessImprovement,
  blankedFiles,
  planTemplateFix,
  tokenFilesOf,
  type ModelCall,
} from "@/lib/template-engine/fix";
import { callForTask } from "@/lib/ai-tools/providers/run";
import type { TemplateManifest } from "@/lib/template-engine/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "website-templates";
// The backup lives OUTSIDE the template's own prefix (a top-level sibling), so a
// later listStorageFiles(prefix) — which health re-checks and this route both do
// — can never mistake a backed-up copy for a live template page.
const BACKUP_ROOT = ".backups";
const HEALTH_FILE_RE = /\.(html?|m?js|css)$/i;
const DOWNLOAD_BATCH = 8;
// The model only ever returns a tiny JSON edit list; a small budget is plenty.
const FIX_MAX_TOKENS = 4000;
const FIX_TEMPERATURE = 0.2;

interface LoadedTemplate {
  id: string;
  prefix: string;
  manifest: TemplateManifest | null;
  /** Full storage paths of every file under the prefix (for the backup). */
  allPaths: string[];
  /** rel path -> text content, for the html/js/css files health/tokens read. */
  textFiles: Record<string, string>;
}

async function loadTemplate(
  admin: ReturnType<typeof createAdminClient>,
  id: string
): Promise<{ error: string; status: number } | LoadedTemplate> {
  const { data: template } = await admin
    .from("website_templates")
    .select("id, storage_prefix, manifest")
    .eq("id", id)
    .single();
  if (!template) return { error: "Template not found", status: 404 };

  const prefix = String(template.storage_prefix ?? "").replace(/\/+$/, "");
  if (!prefix) return { error: "Template has no stored files", status: 409 };

  const allPaths = await listStorageFiles(admin, BUCKET, prefix);
  const textPaths = allPaths
    .map((full) => ({ full, rel: full.slice(prefix.length + 1) }))
    .filter(({ rel }) => rel.length > 0 && HEALTH_FILE_RE.test(rel));
  if (textPaths.length === 0) return { error: "Template files not found in storage", status: 409 };

  const decoder = new TextDecoder();
  const textFiles: Record<string, string> = {};
  for (let i = 0; i < textPaths.length; i += DOWNLOAD_BATCH) {
    const batch = await Promise.all(
      textPaths.slice(i, i + DOWNLOAD_BATCH).map(async ({ full, rel }) => {
        const { data, error } = await admin.storage.from(BUCKET).download(full);
        if (error || !data) throw new Error(`Failed to read ${rel}: ${error?.message ?? "no data"}`);
        return [rel, decoder.decode(new Uint8Array(await data.arrayBuffer()))] as const;
      })
    ).catch((e: unknown) => (e instanceof Error ? e : new Error("Download failed")));
    if (batch instanceof Error) return { error: batch.message, status: 502 };
    for (const [rel, text] of batch) textFiles[rel] = text;
  }

  return {
    id: String(template.id),
    prefix,
    manifest: (template.manifest ?? null) as TemplateManifest | null,
    allPaths,
    textFiles,
  };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Same guard as every other template write: managers only.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { apply?: boolean; files?: unknown };

  const admin = createAdminClient();
  const loaded = await loadTemplate(admin, id);
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });

  return body.apply === true
    ? applyFix(admin, loaded, user.id, body.files)
    : previewFix(loaded);
}

/* ------------------------------------------------------------------ preview */

async function previewFix(loaded: LoadedTemplate) {
  const demoTokens = extractDemoTokens(tokenFilesOf(loaded.textFiles));

  // The one place this route talks to a model. planTemplateFix builds the prompt
  // and calls this; everything it does with the answer is deterministic.
  const callModel: ModelCall = async (system, user) => {
    const out = await callForTask("file_regen", system, user, {
      maxTokens: FIX_MAX_TOKENS,
      temperature: FIX_TEMPERATURE,
    });
    return out.text;
  };

  let preview;
  try {
    preview = await planTemplateFix({
      files: loaded.textFiles,
      demoTokens,
      manifest: loaded.manifest,
      callModel,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not plan a fix" },
      { status: 502 }
    );
  }

  return NextResponse.json({ applied: false, preview });
}

/* -------------------------------------------------------------------- apply */

async function applyFix(
  admin: ReturnType<typeof createAdminClient>,
  loaded: LoadedTemplate,
  userId: string,
  submitted: unknown
) {
  // Validate the submitted patch: an object of path -> new content, every path a
  // text file the template already has. The client cannot add files or overwrite
  // a binary through this route.
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) {
    return NextResponse.json({ error: "Apply requires the previewed patched files" }, { status: 422 });
  }
  const patchedFiles: Record<string, string> = { ...loaded.textFiles };
  const written: string[] = [];
  for (const [rel, content] of Object.entries(submitted as Record<string, unknown>)) {
    if (typeof content !== "string") {
      return NextResponse.json({ error: `Patched file "${rel}" is not text` }, { status: 422 });
    }
    if (loaded.textFiles[rel] === undefined) {
      return NextResponse.json({ error: `Patched file "${rel}" is not part of this template` }, { status: 422 });
    }
    if (content !== loaded.textFiles[rel]) {
      patchedFiles[rel] = content;
      written.push(rel);
    }
  }
  if (written.length === 0) {
    return NextResponse.json({ error: "The patch does not change any file" }, { status: 422 });
  }

  // Re-verify from scratch — never trust the client's "improved" claim.
  const beforeTokens = extractDemoTokens(tokenFilesOf(loaded.textFiles));
  const before = runTemplateHealthChecks({ files: loaded.textFiles, demoTokens: beforeTokens, manifest: loaded.manifest });
  const afterTokens = extractDemoTokens(tokenFilesOf(patchedFiles));
  const after = runTemplateHealthChecks({ files: patchedFiles, demoTokens: afterTokens, manifest: loaded.manifest });
  const improvement = assessImprovement(before, after);
  const blanked = blankedFiles(loaded.textFiles, patchedFiles);
  const improved = improvement.improved && blanked.length === 0;

  if (!improved) {
    // Refuse: never let an AI edit regress or blank a template.
    return NextResponse.json(
      {
        error: "The patched template is not an improvement, so it was not applied.",
        improvement,
        blanked,
        before,
        after,
      },
      { status: 409 }
    );
  }

  // RECOVERABILITY. Copy every current file to a backup prefix BEFORE writing, so
  // a bad fix is reversible. Abort without writing if the backup cannot complete.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPrefix = `${BACKUP_ROOT}/${loaded.id}/${stamp}`;
  const copies = loaded.allPaths.map((full) => ({
    from: full,
    to: `${backupPrefix}/${full.slice(loaded.prefix.length + 1)}`,
  }));
  for (let i = 0; i < copies.length; i += DOWNLOAD_BATCH) {
    const results = await Promise.all(
      copies.slice(i, i + DOWNLOAD_BATCH).map(({ from, to }) => admin.storage.from(BUCKET).copy(from, to))
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      return NextResponse.json(
        { error: `Could not back up the template before applying: ${failed.error.message}` },
        { status: 502 }
      );
    }
  }

  // Write only the changed files.
  for (let i = 0; i < written.length; i += DOWNLOAD_BATCH) {
    const results = await Promise.all(
      written.slice(i, i + DOWNLOAD_BATCH).map((rel) =>
        admin.storage
          .from(BUCKET)
          .upload(`${loaded.prefix}/${rel}`, new TextEncoder().encode(patchedFiles[rel]), {
            contentType: contentTypeFor(rel),
            upsert: true,
          })
      )
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      return NextResponse.json(
        { error: `Fix written partially; a backup is at ${backupPrefix}. Failed on write: ${failed.error.message}` },
        { status: 502 }
      );
    }
  }

  const { data: row, error } = await admin
    .from("website_templates")
    .update({
      demo_tokens: afterTokens,
      health: after,
      health_checked_at: after.checkedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", loaded.id)
    .select("*")
    .single();
  if (error || !row) {
    return NextResponse.json(
      { error: `Files written and backed up at ${backupPrefix}, but the row update failed: ${error?.message ?? "unknown"}` },
      { status: 500 }
    );
  }

  await admin.from("activity_log").insert({
    user_id: userId,
    action: "template.ai_fixed",
    entity_type: "website_template",
    entity_id: loaded.id,
    new_value: {
      status: after.status,
      resolved: improvement.resolvedFails,
      files: written,
      backup_prefix: backupPrefix,
    },
  });

  return NextResponse.json({
    applied: true,
    template: row,
    health: after,
    improvement,
    backupPrefix,
    files: written,
  });
}
