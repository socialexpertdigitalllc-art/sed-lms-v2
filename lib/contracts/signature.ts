export type SignatureRow = { signature_image_path: string | null; typed_name: string | null };
export type ResolvedSignature =
  | { kind: "image"; path: string }
  | { kind: "typed"; name: string }
  | { kind: "none" };

/** Render rule: uploaded image wins, else typed name, else nothing. */
export function resolveSignature(row: SignatureRow | null): ResolvedSignature {
  if (row?.signature_image_path) return { kind: "image", path: row.signature_image_path };
  const typed = row?.typed_name?.trim();
  if (typed) return { kind: "typed", name: typed };
  return { kind: "none" };
}
