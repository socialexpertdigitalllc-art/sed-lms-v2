import { NextResponse } from "next/server";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { liveSnapshot } from "@/lib/site-builder/liveProgress";

// nodejs is LOAD-BEARING, not boilerplate: the live registry is a module-level
// Map shared with the engine that writes it, which only holds while this route
// runs in the same runtime as every other site-builder route (see the
// registry's docblock, and the gate registry's it cites).
export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * The run's LIVE model output — per generating file: chars received, when the
 * last chunk landed, and the raw ~2KB tail. Operator-guarded like every
 * sibling run route.
 *
 * Deliberately NO DB read beyond the guard: the run screen polls this every
 * ~2s while a run generates, the registry answer is a Map lookup, and the
 * row's own state is already served by the sibling GET the screen also polls.
 * An unknown or idle run simply yields `files: []`, which needs no 404 to be
 * understood.
 *
 * `now` rides along so the client computes "seconds since last chunk" from
 * one clock — the server's — instead of trusting its own against ours.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  return NextResponse.json({ now: Date.now(), files: liveSnapshot(id) });
}
