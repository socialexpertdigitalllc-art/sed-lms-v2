import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { SITES_BUCKET } from "@/lib/site-studio/run/finalize";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/** A signed URL for the finalized site zip. Only meaningful once the run is
 *  `ready` with a `zip_path` — anything else is a 409, not a broken link.
 *  10-minute expiry: a download link handed to an operator's browser, not a
 *  long-lived artifact reference. */
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: row, error } = await admin.from("studio_runs").select("status,zip_path").eq("id", id).single();
  if (error || !row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "ready" || !row.zip_path) {
    return NextResponse.json({ error: `Download unavailable: this run is "${row.status}", not "ready".` }, { status: 409 });
  }

  const { data: signed, error: signErr } = await admin.storage.from(SITES_BUCKET).createSignedUrl(row.zip_path, 10 * 60);
  if (signErr || !signed) {
    return NextResponse.json({ error: signErr?.message ?? "Could not create a download link" }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
