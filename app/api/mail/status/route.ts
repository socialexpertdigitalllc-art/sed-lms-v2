import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMailboxForUser } from "@/lib/mail/mailbox";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ hasMailbox: false });
  const mailbox = await getMailboxForUser(user.id);
  return NextResponse.json({ hasMailbox: !!mailbox });
}
