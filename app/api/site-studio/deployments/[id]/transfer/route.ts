import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { daConfigured } from "@/lib/template-engine/directadmin";
import { hostingerConfigured } from "@/lib/hostinger/client";
import { normalizeTargetDomain } from "@/lib/site-studio/deploy/transfer";
import { goLiveOnDomain } from "@/lib/site-studio/deploy/golive";

export const runtime = "nodejs";
// A brand-new domain's hosting setup alone can take a few minutes.
export const maxDuration = 600;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/site-studio/deployments/[id]/transfer  body { domain }
 *
 * Promote a live staging deployment (any origin — studio, builder, or a v2
 * import) to the client's real domain on the Hostinger plan. The work is
 * `goLiveOnDomain` — shared with the domain pipeline (lib/domains), which
 * runs the same transfer automatically once a lead's domain is ready.
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  if (!daConfigured()) return NextResponse.json({ error: "DirectAdmin is not configured." }, { status: 422 });
  if (!hostingerConfigured()) return NextResponse.json({ error: "Hostinger is not configured." }, { status: 422 });

  const body = (await req.json().catch(() => ({}))) as { domain?: unknown };
  const target = normalizeTargetDomain(body.domain, process.env.DA_DOMAIN ?? "");
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 422 });

  const admin = createAdminClient();
  try {
    const result = await goLiveOnDomain({ admin, deploymentId: id, domain: target.domain, actorId: auth.userId });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, pending: result.pending ?? false }, { status: result.status });
    }
    const { ok: _ok, ...payload } = result;
    void _ok;
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[transfer] ${id} -> ${target.domain} crashed: ${message}`);
    await Promise.resolve(
      admin.from("activity_log").insert({
        user_id: auth.userId,
        action: "studio.deployment.transfer_failed",
        entity_type: "studio_deployment",
        entity_id: id,
        new_value: { domain: target.domain, step: "unexpected", error: message },
      }),
    ).catch(() => {});
    return NextResponse.json({ error: `Transfer failed unexpectedly: ${message}` }, { status: 500 });
  }
}
