import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { shuffleDeployment } from "@/lib/site-studio/deploy/shuffle";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/site-studio/deployments/[id]/shuffle — the deployments board's
 * door. The site-keyed sibling (`../shuffle?site=`) serves the lead, ticket
 * and lead-table icons; both run `shuffleDeployment`.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const result = await shuffleDeployment(createAdminClient(), { id, actorId: auth.userId });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, url: result.url, subdomain: result.subdomain, oldDeleted: result.oldDeleted });
}
