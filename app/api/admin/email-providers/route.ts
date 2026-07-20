import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getDescriptor } from "@/lib/email-verify/registry";
import { saveProviderConfig } from "@/lib/email-verify/config";
import { listProviderSettings } from "@/lib/email-verify/adminView";

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

  const providers = await listProviderSettings();
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
