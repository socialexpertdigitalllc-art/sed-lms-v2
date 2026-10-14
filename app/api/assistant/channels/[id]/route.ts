import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/assistant/http";
import { ACTIONS_MIGRATION_MESSAGE, isMissingActionTables } from "@/lib/assistant/actions/store";
import { isConfigured } from "@/lib/assistant/channels/config";
import { deleteLink } from "@/lib/assistant/channels/links";
import { sendText } from "@/lib/assistant/channels/send";

export const runtime = "nodejs";

/** Unlink one of your own phones. Messages from it stop reaching your assistant at once. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "That phone is not linked." }, { status: 404 });
  try {
    const removed = await deleteLink(createAdminClient(), user.id, id);
    if (!removed) return NextResponse.json({ error: "That phone is not linked." }, { status: 404 });
    if (isConfigured(removed.channel)) {
      // Tell the chat too, so nobody keeps writing into a dead line.
      after(() => sendText(removed.channel, removed.external_id, "This chat is no longer linked to SED AI.").catch(() => {}));
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isMissingActionTables(e)) return NextResponse.json({ error: ACTIONS_MIGRATION_MESSAGE }, { status: 503 });
    console.error("[assistant/channels] unlink failed:", e);
    return NextResponse.json({ error: "Could not unlink that phone." }, { status: 500 });
  }
}
