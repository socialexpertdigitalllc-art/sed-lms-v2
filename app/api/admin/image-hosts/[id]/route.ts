import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { deleteImageHost, updateImageHost } from "@/lib/photo-capture/hosts/config";

export const runtime = "nodejs";

async function guard(): Promise<true | { error: 401 | 403 }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return { error: 403 };
  return true;
}

function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

const patchSchema = z.object({
  label: z.string().trim().max(80).optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
  secret: z.string().trim().max(500).nullish(),
  /** Clears last_error and any cooldown — "try this key again now". */
  clearError: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard();
  if (auth !== true) return guardError(auth.error);
  const { id } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  try {
    await updateImageHost(id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update the image host" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard();
  if (auth !== true) return guardError(auth.error);
  const { id } = await params;
  try {
    await deleteImageHost(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not delete the image host" }, { status: 500 });
  }
}
