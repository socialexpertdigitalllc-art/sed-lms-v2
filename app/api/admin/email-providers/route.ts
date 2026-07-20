import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { PROVIDER_REGISTRY, getDescriptor } from "@/lib/email-verify/registry";
import { getProviderConfigStatuses, saveProviderConfig } from "@/lib/email-verify/config";
import { getAllProviderQuotas } from "@/lib/email-verify/balance";

export const runtime = "nodejs";

/**
 * Email-verification provider settings.
 *
 * NOTHING in this file may return a credential — not the plaintext, not the
 * ciphertext. The client gets the registry descriptor (which fields to render),
 * `configured`, a masked hint, enabled/priority, and the live quota.
 */

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

function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const [statuses, quotas] = await Promise.all([getProviderConfigStatuses(), getAllProviderQuotas()]);
  const statusByKey = new Map(statuses.map((s) => [s.key, s]));
  const quotaByKey = new Map(quotas.map((q) => [q.key, q]));

  const providers = statuses.map((s) => {
    const d = getDescriptor(s.key);
    return {
      key: s.key,
      label: d?.label ?? s.key,
      fields: d?.fields ?? [],
      freeLimit: d?.freeLimit ?? 0,
      period: d?.period ?? "day",
      docsUrl: d?.docsUrl ?? "",
      supportsBalance: d?.supportsBalance ?? false,
      privacyNote: d?.privacyNote ?? "",
      enabled: s.enabled,
      priority: s.priority,
      configured: s.configured,
      hint: s.hint,
      updatedAt: s.updatedAt,
      quota: quotaByKey.get(s.key) ?? null,
    };
  });

  // Registry entries with no status row should be impossible, but never hide a
  // provider from the settings page just because the config read came up empty.
  for (const d of PROVIDER_REGISTRY) {
    if (statusByKey.has(d.key)) continue;
    providers.push({
      key: d.key,
      label: d.label,
      fields: d.fields,
      freeLimit: d.freeLimit,
      period: d.period,
      docsUrl: d.docsUrl,
      supportsBalance: d.supportsBalance,
      privacyNote: d.privacyNote,
      enabled: false,
      priority: PROVIDER_REGISTRY.indexOf(d),
      configured: false,
      hint: null,
      updatedAt: null,
      quota: quotaByKey.get(d.key) ?? null,
    });
  }

  return NextResponse.json({ providers });
}

const putSchema = z.object({
  provider_key: z.string().trim().min(1).max(64),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(99).optional(),
  /** Omit to keep what is stored; null clears it. */
  credentials: z.record(z.string(), z.string().max(500)).nullish(),
});

export async function PUT(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const descriptor = getDescriptor(parsed.data.provider_key);
  if (!descriptor) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });

  // Only fields the descriptor declares may be stored — no smuggling extras in.
  let credentials: Record<string, string> | null | undefined;
  if (parsed.data.credentials === null) credentials = null;
  else if (parsed.data.credentials !== undefined) {
    credentials = {};
    for (const field of descriptor.fields) {
      const v = parsed.data.credentials[field.key];
      if (typeof v === "string" && v.trim()) credentials[field.key] = v.trim();
    }
  }

  try {
    const status = await saveProviderConfig(parsed.data.provider_key, {
      enabled: parsed.data.enabled,
      priority: parsed.data.priority,
      credentials,
      updatedBy: auth.userId,
    });
    return NextResponse.json({ provider: status });
  } catch {
    // Deliberately opaque — an upstream error could echo the payload.
    return NextResponse.json({ error: "Could not save provider settings" }, { status: 500 });
  }
}
