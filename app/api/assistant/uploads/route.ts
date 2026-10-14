import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assistantGuard, UUID_RE } from "@/lib/assistant/http";
import { ACTIONS_MIGRATION_MESSAGE, isMissingActionTables } from "@/lib/assistant/actions/store";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, saveUpload } from "@/lib/assistant/uploads";

export const runtime = "nodejs";

/**
 * Attach a file to a message (a logo for a lead, screenshots for a ticket).
 * Stored privately, owned by the caller; an action moves it where it belongs
 * only when the person confirms.
 */
export async function POST(req: Request) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the file as multipart form data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was attached." }, { status: 422 });
  if (file.size === 0) return NextResponse.json({ error: "That file is empty." }, { status: 422 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Files can be at most 10 MB." }, { status: 413 });
  if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Attach an image (PNG, JPG, WebP, GIF, SVG), a PDF, or a text/CSV file." }, { status: 415 });
  }
  const conversationId = String(form.get("conversationId") ?? "");
  try {
    const row = await saveUpload(createAdminClient(), guard.caller.user.id, UUID_RE.test(conversationId) ? conversationId : null, {
      name: file.name,
      type: file.type,
      bytes: await file.arrayBuffer(),
    });
    return NextResponse.json({ file: { id: row.id, name: row.name, mime: row.mime, size: row.size_bytes } }, { status: 201 });
  } catch (e) {
    if (isMissingActionTables(e) || /bucket not found/i.test(String((e as Error)?.message))) {
      return NextResponse.json({ error: ACTIONS_MIGRATION_MESSAGE }, { status: 503 });
    }
    console.error("[assistant] upload failed:", e);
    return NextResponse.json({ error: "The file could not be saved." }, { status: 500 });
  }
}
