import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assistantGuard, UUID_RE } from "@/lib/assistant/http";
import { getUpload, signedUploadUrl } from "@/lib/assistant/uploads";

export const runtime = "nodejs";

/** Open one of the caller's own attached files (a short-lived private link). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "File not found" }, { status: 404 });
  const admin = createAdminClient();
  const row = await getUpload(admin, guard.caller.user.id, id).catch(() => null);
  const url = row ? await signedUploadUrl(admin, row, 300) : null;
  if (!url) return NextResponse.json({ error: "File not found" }, { status: 404 });
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=60" } });
}
