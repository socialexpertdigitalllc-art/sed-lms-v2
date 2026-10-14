import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assistantGuard } from "@/lib/assistant/http";
import { ACTIONS_MIGRATION_MESSAGE, isMissingActionTables } from "@/lib/assistant/actions/store";
import { isConfigured, missingEnv } from "@/lib/assistant/channels/config";
import { createLinkCode, linkInstructions, listLinks } from "@/lib/assistant/channels/links";
import { CHANNEL_LABEL, CHANNELS, type ChannelsResponse, type LinkCodeResponse } from "@/lib/assistant/channels/types";

export const runtime = "nodejs";

/**
 * The caller's phones linked to SED AI (GET), and a one-time code to link
 * another (POST). The code is sent FROM the chat — see the webhooks next to
 * this route — and proves that chat belongs to whoever created the code.
 */

function failure(e: unknown, fallback: string): NextResponse {
  if (isMissingActionTables(e)) return NextResponse.json({ error: ACTIONS_MIGRATION_MESSAGE }, { status: 503 });
  console.error("[assistant/channels]", e);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** Signed in is enough to see (and unlink) your own phones — even without SED AI access any more. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body: ChannelsResponse = {
      links: await listLinks(createAdminClient(), user.id),
      configured: { telegram: isConfigured("telegram"), whatsapp: isConfigured("whatsapp") },
    };
    return NextResponse.json(body);
  } catch (e) {
    return failure(e, "Could not load your linked phones.");
  }
}

const bodySchema = z.object({ channel: z.enum(CHANNELS) });

export async function POST(req: Request) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Pick Telegram or WhatsApp." }, { status: 422 });
  const { channel } = parsed.data;

  const missing = missingEnv(channel);
  if (missing.length) {
    return NextResponse.json(
      {
        error: `${CHANNEL_LABEL[channel]} is not set up on this server yet. An admin needs to set ${missing.join(", ")} in the server environment (see docs/assistant-phone-channel.md).`,
      },
      { status: 503 },
    );
  }
  try {
    const { code, expiresAt } = await createLinkCode(createAdminClient(), guard.caller.user.id, channel);
    const body: LinkCodeResponse = { channel, code, expiresAt, ...linkInstructions(channel, code) };
    return NextResponse.json(body);
  } catch (e) {
    return failure(e, "Could not create a link code. Try again.");
  }
}
