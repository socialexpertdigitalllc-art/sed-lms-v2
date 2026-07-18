import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signatureSchema } from "@/lib/contracts/schema";

export const runtime = "nodejs";

const ALLOWED_TYPES: Record<string, string> = { "image/png": "png" };
const MAX_SIZE = 1 * 1024 * 1024;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_signatures")
    .select("signature_image_path, typed_name, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({ signature: data ?? null });
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();

  const form = await req.formData();
  const typedParsed = signatureSchema.safeParse({ typed_name: form.get("typed_name") ?? undefined });
  if (!typedParsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: typedParsed.error.flatten() }, { status: 422 });
  }

  const patch: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  if (typedParsed.data.typed_name !== undefined) patch.typed_name = typedParsed.data.typed_name;

  const image = form.get("image");
  if (image instanceof File && image.size > 0) {
    if (!ALLOWED_TYPES[image.type]) return NextResponse.json({ error: "Signature must be a PNG" }, { status: 422 });
    if (image.size > MAX_SIZE) return NextResponse.json({ error: "Signature must be 1MB or smaller" }, { status: 422 });
    const path = `${user.id}/signature.png`;
    const { error: upErr } = await admin.storage.from("signatures").upload(path, image, { contentType: "image/png", upsert: true });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    patch.signature_image_path = path;
  } else if (form.get("clear_image") === "true") {
    patch.signature_image_path = null;
  }

  const { data, error } = await admin
    .from("user_signatures")
    .upsert(patch, { onConflict: "user_id" })
    .select("signature_image_path, typed_name, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ signature: data });
}
