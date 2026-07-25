import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { proposeIdentityAdditions } from "@/lib/site-studio/compiler/ai/identityAi";
import { applyIdentityAdditions } from "@/lib/site-studio/compiler/ai/applyIdentity";
import { aiCall, mergeDiagnostics, runEnrichment } from "@/lib/site-studio/service/enrich";
import type { Diagnostic } from "@/lib/site-studio/schema";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const OWNED_CODES = ["ai_identity_unparseable", "ai_enrichment_reverted"];

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,status,manifest,diagnostics").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "needs_review") {
    return NextResponse.json({ error: "Only a compiled, un-certified template can be enriched" }, { status: 409 });
  }

  let applied = 0;
  const outcome = await runEnrichment(admin, row, async (tpl) => {
    const { additions, diagnostics } = await proposeIdentityAdditions(tpl, aiCall);
    const result = applyIdentityAdditions(tpl, additions);
    applied = result.applied.length;
    const skips: Diagnostic[] = result.skipped
      .filter((s) => s.reason !== "value not found in package")
      .map((s) => ({
        level: "info" as const,
        code: "ai_identity_skipped",
        message: `Identity suggestion "${s.key}"="${s.value}" skipped: ${s.reason}`,
      }));
    return { template: result.template, diagnostics: [...diagnostics, ...skips] };
  });

  // outcome.template's manifest carries the new identity keys (or the old
  // manifest when reverted) — persist manifest + diagnostics + timestamp
  const { data: updated, error } = await admin.from("studio_templates").update({
    manifest: outcome.template.manifest,
    diagnostics: mergeDiagnostics((row.diagnostics ?? []) as Diagnostic[], outcome.diagnostics, [...OWNED_CODES, "ai_identity_skipped"]),
    identity_enriched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (error || !updated) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });

  return NextResponse.json({ template: updated, applied, reverted: outcome.reverted });
}
