import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { apiKeyFrom, getProvider } from "@/lib/ai-tools/providers/registry";
import { getAiProviderConfigs } from "@/lib/ai-tools/providers/config";
import { callWithProvider } from "@/lib/ai-tools/run";

export const runtime = "nodejs";

/**
 * Validate a provider's stored credentials with the smallest possible real
 * completion: one short system+user turn, temperature 0, 16 output tokens, on
 * the provider's FIRST listed model.
 *
 * Unlike the email-verification providers there is no free balance endpoint to
 * probe, so this genuinely spends a few tokens (fractions of a cent). The UI
 * says so before the operator presses the button.
 */

const TEST_TIMEOUT_MS = 30000;

async function guard(): Promise<{ userId: string } | { error: 401 | 403 }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return { error: 403 };
  return { userId: user.id };
}

export async function POST(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await guard();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });
  }

  const { key } = await params;
  const descriptor = getProvider(key);
  if (!descriptor) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  const config = (await getAiProviderConfigs().catch(() => [])).find((c) => c.key === key);
  const apiKey = apiKeyFrom(descriptor, config?.credentials);
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "No credentials are stored for this provider" });
  }

  const model = descriptor.models[0];
  if (!model) return NextResponse.json({ ok: false, error: "This provider has no models registered" });

  const startedAt = Date.now();
  try {
    const { text } = await callWithProvider(
      { label: descriptor.label, endpoint: descriptor.endpoint, apiKey, maxOutputTokens: model.maxOutputTokens },
      model.id,
      "You are a connectivity probe. Reply with one word.",
      "Reply with the single word: ok",
      // ONE attempt. `timeoutMs` is per attempt, so inheriting the default
      // retry budget would make a probe of a dead or throttled provider take
      // 4 x 30s plus backoff — minutes — where the operator is a human waiting
      // on a button. A liveness probe reports the first answer it gets; whether
      // to retry is the caller's call, and this caller can just click again.
      { maxTokens: 16, temperature: 0, timeoutMs: TEST_TIMEOUT_MS, maxAttempts: 1 },
    );
    return NextResponse.json({
      ok: true,
      model: model.id,
      ms: Date.now() - startedAt,
      // Trimmed hard: this is a liveness echo, not model output we act on.
      reply: text.trim().slice(0, 40),
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    // The provider's own message (an auth failure reads "Invalid API key" and
    // similar). callWithProvider never echoes the key into it.
    return NextResponse.json({ ok: false, model: model.id, error: e instanceof Error ? e.message : "The test call failed" });
  }
}
