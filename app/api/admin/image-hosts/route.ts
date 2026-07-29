import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { addImageHost, listImageHostStatuses } from "@/lib/photo-capture/hosts/config";

export const runtime = "nodejs";

/**
 * NOTHING in this file may return a credential — not the plaintext, not the
 * ciphertext. The client gets `configured`, a masked hint, and state.
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
  return NextResponse.json({ hosts: await listImageHostStatuses() });
}

const postSchema = z.object({
  provider: z.enum(["imgbb", "postimages", "imgchest"]),
  label: z.string().trim().max(80).default(""),
  /** null for postimages, which has no API keys at all. */
  secret: z.string().trim().max(500).nullish(),
});

export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }
  if (parsed.data.provider !== "postimages" && !parsed.data.secret?.trim()) {
    return NextResponse.json({ error: "This provider needs an API key" }, { status: 422 });
  }

  try {
    const { id } = await addImageHost({
      provider: parsed.data.provider,
      label: parsed.data.label,
      secret: parsed.data.secret ?? null,
      createdBy: auth.userId,
    });
    return NextResponse.json({ id });
  } catch {
    // Deliberately opaque — an upstream error could echo the payload.
    return NextResponse.json({ error: "Could not save the image host" }, { status: 500 });
  }
}
