import { NextResponse } from "next/server";
import { requireOwnMailbox } from "@/lib/mail/guard";
import { getAttachment } from "@/lib/mail/imap";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const auth = await requireOwnMailbox();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "No mailbox" }, { status: auth.error });

  const url = new URL(req.url);
  const folder = url.searchParams.get("folder") ?? "INBOX";
  const part = url.searchParams.get("part");
  const uidNum = Number(uid);
  if (!part) return NextResponse.json({ error: "Missing part" }, { status: 400 });
  if (!Number.isInteger(uidNum) || uidNum < 1) return NextResponse.json({ error: "Bad uid" }, { status: 400 });

  try {
    const att = await getAttachment(auth.mailbox, folder, uidNum, part);
    if (!att) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    return new Response(new Uint8Array(att.content), {
      headers: {
        "Content-Type": att.contentType,
        "Content-Disposition": `attachment; filename="${att.filename.replace(/"/g, "")}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
