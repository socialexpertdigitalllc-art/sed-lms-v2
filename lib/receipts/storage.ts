import type { createAdminClient } from "@/lib/supabase/admin";
import { renderReceiptPdf } from "@/lib/receipts/ReceiptDocument";
import { receiptDocFromRow } from "@/lib/receipts/compute";
import type { ReceiptRow } from "@/lib/receipts/types";

type Admin = ReturnType<typeof createAdminClient>;

export const RECEIPTS_BUCKET = "receipts";

/** The stored PDF, or a live render from the immutable snapshot if it's missing. */
export async function loadReceiptPdf(admin: Admin, receipt: ReceiptRow): Promise<Buffer> {
  if (receipt.pdf_path) {
    const { data: blob } = await admin.storage.from(RECEIPTS_BUCKET).download(receipt.pdf_path);
    if (blob) return Buffer.from(await blob.arrayBuffer());
  }
  return renderReceiptPdf(receiptDocFromRow(receipt));
}

/** Upload the PDF and record its path. Returns the path, or null if storage failed. */
export async function storeReceiptPdf(admin: Admin, receiptId: string, pdf: Buffer): Promise<string | null> {
  const path = `${receiptId}.pdf`;
  const { error } = await admin.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, new Uint8Array(pdf), { contentType: "application/pdf", upsert: true });
  if (error) return null;
  await admin.from("lead_receipts").update({ pdf_path: path }).eq("id", receiptId);
  return path;
}
