import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { STUDIO_ASSETS_BUCKET } from "@/lib/site-studio/assets/rehost";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/** Active statuses — a run in any of these still HOLDS its `content_doc`
 *  live and could still deploy (a finished run's ZIP is already baked with
 *  its own asset bytes, so deleting the library row afterward is harmless —
 *  see finalize.ts/resolveAssets.ts). Deliberately the same active set the
 *  advancer route (Task 9) and the one-active-per-lead index (migration
 *  0054) use. */
const ACTIVE_STATUSES = ["queued", "preparing", "reviewing", "approved", "rendering"];

/**
 * DELETE: removes the library row + its bucket object. Guarded exactly like
 * the template DELETE-guard pattern (Phase 3a's
 * `app/api/site-studio/templates/[id]/route.ts`): the COUNT query's error is
 * checked BEFORE trusting the count — a failed guard query must 500, never
 * silently fall through to allowing the delete. The guard itself scans
 * active runs' `content_doc` for a literal `asset:{id}` reference (cheap at
 * this scale, per the plan) rather than a dedicated join table.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: assetRow, error: fetchErr } = await admin
    .from("studio_assets")
    .select("id,storage_path,subject")
    .eq("id", id)
    .single();
  if (fetchErr || !assetRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: activeRuns, error: activeErr } = await admin
    .from("studio_runs")
    .select("id,content_doc")
    .in("status", ACTIVE_STATUSES);
  if (activeErr) {
    return NextResponse.json({ error: `Could not check active runs: ${activeErr.message}` }, { status: 500 });
  }

  const ref = `asset:${id}`;
  const referencingCount = (activeRuns ?? []).filter((r) => JSON.stringify(r.content_doc ?? {}).includes(ref)).length;
  if (referencingCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${referencingCount} active generation run(s) reference this asset.` },
      { status: 409 },
    );
  }

  await admin.storage.from(STUDIO_ASSETS_BUCKET).remove([assetRow.storage_path]).catch(() => {});
  const { error } = await admin.from("studio_assets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.asset.deleted",
    entity_type: "studio_asset",
    entity_id: id,
    new_value: { subject: assetRow.subject },
  });

  return NextResponse.json({ ok: true });
}
