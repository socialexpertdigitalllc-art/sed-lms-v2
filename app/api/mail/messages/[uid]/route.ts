import { NextResponse } from "next/server";
import { requireOwnMailbox } from "@/lib/mail/guard";
import { getMessage } from "@/lib/mail/imap";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const auth = await requireOwnMailbox();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "No mailbox" }, { status: auth.error });

  const folder = new URL(req.url).searchParams.get("folder") ?? "INBOX";
  const uidNum = Number(uid);
  if (!Number.isInteger(uidNum) || uidNum < 1) return NextResponse.json({ error: "Bad uid" }, { status: 400 });

  try {
    const message = await getMessage(auth.mailbox, folder, uidNum);
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    return NextResponse.json({ message });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
