import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSignature } from "@/lib/contracts/signature";

/** Load a user's signature and turn it into renderContractPdf's second arg. */
export async function signatureRenderArgs(userId: string): Promise<{ imageDataUrl?: string; typedName?: string }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_signatures")
    .select("signature_image_path, typed_name")
    .eq("user_id", userId)
    .maybeSingle();
  const resolved = resolveSignature(data ?? null);
  if (resolved.kind === "image") {
    const { data: blob } = await admin.storage.from("signatures").download(resolved.path);
    if (blob) {
      const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      return { imageDataUrl: `data:image/png;base64,${b64}` };
    }
  }
  if (resolved.kind === "typed") return { typedName: resolved.name };
  return {};
}
