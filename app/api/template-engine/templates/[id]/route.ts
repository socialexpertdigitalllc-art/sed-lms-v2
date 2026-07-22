import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { listStorageFiles } from "@/lib/template-engine/runner";
import { isLiveGenerationStatus } from "@/lib/template-engine/deletion";
import type { TemplateManifest } from "@/lib/template-engine/types";

// nodejs runtime: this route reaches Supabase Storage (list + remove) the same
// way the sibling upload/list route does.
export const runtime = "nodejs";

// The templates bucket — same name the upload/list route writes to.
const BUCKET = "website-templates";
// Supabase storage caps a remove() call; delete in chunks so a big template clears.
const REMOVE_BATCH = 100;

const PAGE_KINDS = [
  "home",
  "about",
  "services_hub",
  "areas_hub",
  "gallery",
  "contact",
  "service_detail",
  "area_detail",
  "other",
] as const;

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["active", "archived"]).optional(),
  kinds: z.record(z.string(), z.enum(PAGE_KINDS)).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: template } = await admin.from("website_templates").select("*").eq("id", id).single();
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name) updates.name = parsed.data.name;
  if (parsed.data.status) updates.status = parsed.data.status;
  if (parsed.data.kinds) {
    const kinds = parsed.data.kinds;
    const manifest = (template.manifest ?? {}) as TemplateManifest;
    updates.manifest = {
      ...manifest,
      pages: (Array.isArray(manifest.pages) ? manifest.pages : []).map((p) =>
        kinds[p.file] ? { ...p, kind: kinds[p.file] } : p
      ),
    };
  }

  const { data: row, error } = await admin
    .from("website_templates")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !row) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "template.updated",
    entity_type: "website_template",
    entity_id: id,
    new_value: parsed.data,
  });

  return NextResponse.json({ template: row });
}

/**
 * Hard-delete a template.
 *
 * Requires migration 0049 (FK `template_generations.template_id` -> ON DELETE
 * SET NULL). Without it the final row delete fails with a RESTRICT violation
 * because completed generations still reference the template.
 *
 * Guards, in order:
 *  1. auth + `templates.manage` (same as PATCH);
 *  2. IN-PROGRESS 409 — refuse if any generation is still building from this
 *     template (queued/running/planning/building/curating/paused). Deleting it
 *     and its storage out from under a live build would corrupt that run.
 *  3. best-effort storage cleanup of every object under the template's prefix —
 *     a storage failure is logged but never aborts the DB delete.
 *  4. delete the row; the SET NULL FK unlinks the surviving completed
 *     generations (their zips / deployed sites in template-sites are untouched).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
    .select("id, name, storage_prefix")
    .eq("id", id)
    .single();
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // Every generation still bound to this template. Completed ones will be
  // unlinked by the FK; live ones must block the delete first.
  const { data: gens, error: gensErr } = await admin
    .from("template_generations")
    .select("id, status")
    .eq("template_id", id);
  if (gensErr) return NextResponse.json({ error: gensErr.message }, { status: 400 });

  const generations = gens ?? [];
  const liveCount = generations.filter((g) => isLiveGenerationStatus(g.status)).length;
  if (liveCount > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete: ${liveCount} generation${liveCount === 1 ? "" : "s"} ${
          liveCount === 1 ? "is" : "are"
        } still building from this template. Wait for ${
          liveCount === 1 ? "it" : "them"
        } to finish or cancel first.`,
        liveGenerations: liveCount,
      },
      { status: 409 }
    );
  }

  // Best-effort storage cleanup. A template row that lingers after its files are
  // gone is worse than a clean delete with a few orphaned objects, so a storage
  // failure is logged and reported but never blocks the row delete below.
  let storageOk = true;
  try {
    const paths = await listStorageFiles(admin, BUCKET, template.storage_prefix);
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const { error } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + REMOVE_BATCH));
      if (error) storageOk = false;
    }
  } catch {
    storageOk = false;
  }
  if (!storageOk) {
    console.error(
      `[template.deleted] partial storage cleanup for template ${id} (prefix ${template.storage_prefix}); row still deleted`
    );
  }

  // The SET NULL FK (migration 0049) unlinks the completed generations here.
  const { error: delErr } = await admin.from("website_templates").delete().eq("id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

  const unlinkedGenerations = generations.length;

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "template.deleted",
    entity_type: "website_template",
    entity_id: id,
    old_value: {
      name: template.name,
      unlinked_generations: unlinkedGenerations,
      storage_cleanup: storageOk ? "complete" : "partial",
    },
  });

  return NextResponse.json({ ok: true, unlinkedGenerations });
}
