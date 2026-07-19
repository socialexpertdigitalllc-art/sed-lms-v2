import { NextResponse } from "next/server";
import { requireOwnMailbox } from "@/lib/mail/guard";
import { listMessages } from "@/lib/mail/imap";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireOwnMailbox();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "No mailbox" }, { status: auth.error });

  const url = new URL(req.url);
  const folder = url.searchParams.get("folder") ?? "INBOX";
  const page = Number(url.searchParams.get("page") ?? "1") || 1;

  try {
    const result = await listMessages(auth.mailbox, { folder, page });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
