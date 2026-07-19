import { NextResponse } from "next/server";
import { requireOwnMailbox } from "@/lib/mail/guard";
import { markSeen } from "@/lib/mail/imap";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const auth = await requireOwnMailbox();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "No mailbox" }, { status: auth.error });

  const folder = new URL(req.url).searchParams.get("folder") ?? "INBOX";
  const uidNum = Number(uid);
  if (!Number.isInteger(uidNum) || uidNum < 1) return NextResponse.json({ error: "Bad uid" }, { status: 400 });

  try {
    await markSeen(auth.mailbox, folder, uidNum);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
