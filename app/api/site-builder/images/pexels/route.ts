import { NextResponse } from "next/server";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { ttlCached } from "@/lib/cache/ttl";
import { searchPexels } from "@/lib/site-studio/assets/pexels";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET: raw Pexels search for the Site Builder image picker's "Pexels" tab.
 *  Thin wrapper over the kept `searchPexels` service — nothing here is
 *  rehosted yet; that only happens once the operator actually picks a
 *  result (see `POST /api/site-builder/images/pick`). */
export async function GET(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const query = new URL(req.url).searchParams.get("query")?.trim();
  if (!query) return NextResponse.json({ error: "A query is required" }, { status: 422 });

  // A Pexels round-trip is the slowest thing in the picker, and operators
  // search the same trades repeatedly ("plumber van", "roofing"). Cache the
  // SUCCESSFUL result for 10 minutes — stock photos for a query don't move,
  // and a failure must stay retryable, so only successes are cached.
  const result = await ttlCached(`builder-pexels`, query.toLowerCase(), 600_000, async () => {
    const r = await searchPexels(query);
    if (!r.ok) throw new Error(r.error);
    return r.candidates;
  }).then(
    (candidates) => ({ ok: true as const, candidates }),
    (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Pexels search failed" }),
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ candidates: result.candidates });
}
