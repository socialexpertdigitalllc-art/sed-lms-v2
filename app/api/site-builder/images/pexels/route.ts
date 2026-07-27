import { NextResponse } from "next/server";
import { guard, guardError } from "@/lib/site-studio/service/guard";
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

  const result = await searchPexels(query);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ candidates: result.candidates });
}
