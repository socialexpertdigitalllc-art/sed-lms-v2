import { NextResponse } from "next/server";
import { requireDomains, domainsAuthError } from "@/lib/domains/guard";
import { copyStagingToDomain, markDomainLive } from "@/lib/domains/service";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/domains/[id]/site { action }
 *   mark_live     the site is already on the domain (put there by hand) —
 *                 stop waiting and point the lead's website link at it;
 *   copy_staging  copy the lead's staging site onto the domain now,
 *                 replacing what it serves (a copy is kept first).
 */
export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireDomains("manage");
  if ("error" in auth) return domainsAuthError(auth.error);
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  const r =
    body.action === "mark_live"
      ? await markDomainLive(auth.admin, id, auth.userId)
      : body.action === "copy_staging"
        ? await copyStagingToDomain(auth.admin, id, auth.userId)
        : null;
  if (!r) return NextResponse.json({ error: "action must be mark_live or copy_staging" }, { status: 400 });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ domain: r.domain });
}
