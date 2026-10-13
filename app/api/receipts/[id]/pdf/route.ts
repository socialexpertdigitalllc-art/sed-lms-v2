import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/receipts/guard";
import { loadReceiptPdf } from "@/lib/receipts/storage";
import { receiptFileName } from "@/lib/receipts/compute";
import type { ReceiptRow } from "@/lib/receipts/types";

export const runtime = "nodejs";

/** The receipt PDF. `?download=1` saves it instead of opening it inline. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requirePermission("receipts.send");
  if ("response" in auth) return auth.response;

  const admin = createAdminClient();
  const { data } = await admin.from("lead_receipts").select("*").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  const receipt = data as ReceiptRow;

  const pdf = await loadReceiptPdf(admin, receipt);
  const download = new URL(req.url).searchParams.get("download") === "1";
  const filename = receiptFileName(receipt.receipt_no, "pdf");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      // A receipt is an immutable snapshot, so the browser may keep it.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
