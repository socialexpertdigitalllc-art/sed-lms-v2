import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import {
  daConfigured,
  createSubdomain,
  subdomainExists,
  clearDocroot,
  uploadZipAndExtract,
  docrootFor,
} from "@/lib/template-engine/directadmin";
import { deployBuilderRun } from "@/lib/site-builder/deploy";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST: deploy an `approved` run to its live subdomain. All the real logic —
 * resolution, cross-lead conflict guard, clear-before-upload on reuse,
 * `studio_deployments` bookkeeping — lives in `deployBuilderRun` (see that
 * file's own doc comment on how it differs from Site Studio's
 * `deployRun.ts`); this route is guard + wiring only, same shape as
 * `app/api/site-studio/runs/[id]/deploy/route.ts`.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const outcome = await deployBuilderRun(
    admin,
    id,
    {
      daConfigured,
      daDomain: process.env.DA_DOMAIN ?? "",
      createSubdomain,
      subdomainExists,
      clearDocroot,
      uploadZipAndExtract,
      docrootFor,
    },
    auth.userId,
  );

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  return NextResponse.json({
    url: outcome.url,
    sub: outcome.sub,
    reused: outcome.reused,
    clearWarning: outcome.clearWarning ?? null,
  });
}
