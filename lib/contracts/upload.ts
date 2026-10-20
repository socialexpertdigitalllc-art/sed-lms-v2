// lib/contracts/upload.ts
/**
 * Checks for a contract PDF someone uploads (their own contract, or a
 * replacement for a generated one). PURE.
 */

export const MAX_CONTRACT_PDF_BYTES = 15 * 1024 * 1024;

const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Readers accept the header anywhere in the first KB (some tools prepend junk). */
function hasPdfHeader(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length - MAGIC.length, 1024);
  for (let i = 0; i <= end; i++) {
    if (MAGIC.every((b, j) => bytes[i + j] === b)) return true;
  }
  return false;
}

/** "Signed – ACME.pdf" stays readable; paths, control chars and odd lengths don't. */
export function cleanPdfName(name: string | null | undefined): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const tidy = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 120);
  if (!tidy) return "contract.pdf";
  return /\.pdf$/i.test(tidy) ? tidy : `${tidy}.pdf`;
}

export function checkPdfUpload(bytes: Uint8Array, name: string | null | undefined): { ok: true; name: string } | { ok: false; message: string } {
  if (!bytes.length) return { ok: false, message: "That file is empty." };
  if (bytes.length > MAX_CONTRACT_PDF_BYTES) {
    return { ok: false, message: `That PDF is over ${MAX_CONTRACT_PDF_BYTES / 1024 / 1024} MB — compress it and try again.` };
  }
  if (!hasPdfHeader(bytes)) return { ok: false, message: "That file isn't a PDF. Export or print the contract to PDF first." };
  return { ok: true, name: cleanPdfName(name) };
}

/** The file part of a multipart request, as bytes, or null. */
export async function filePart(form: FormData, field = "file"): Promise<{ bytes: Uint8Array; name: string } | null> {
  const f = form.get(field);
  if (!f || typeof f === "string") return null;
  return { bytes: new Uint8Array(await f.arrayBuffer()), name: f.name };
}
