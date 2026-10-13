import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/receipts/guard";
import { createReceiptSchema } from "@/lib/receipts/schema";
import { computeTotals, projectRef, receiptDocFromRow } from "@/lib/receipts/compute";
import { getReceiptSettings } from "@/lib/receipts/settings";
import { renderReceiptPdf } from "@/lib/receipts/ReceiptDocument";
import { storeReceiptPdf } from "@/lib/receipts/storage";
import type { ReceiptRow } from "@/lib/receipts/types";

export const runtime = "nodejs";

/**
 * Issue a receipt for a lead: snapshot it, render the PDF once and store it,
 * so opening, downloading and emailing it afterwards is instant. Sending is a
 * separate, explicit step (POST /api/receipts/[id]/send).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  const auth = await requirePermission("receipts.send");
  if ("response" in auth) return auth.response;

  const parsed = createReceiptSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Invalid input";
    return NextResponse.json({ error: first, issues: parsed.error.flatten() }, { status: 422 });
  }
  const input = parsed.data;

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Totals are always recomputed here; the client's numbers are display-only.
  const totals = computeTotals(input.items, input.discount, input.tax_rate);
  const settings = await getReceiptSettings();

  const { data: inserted, error } = await admin
    .from("lead_receipts")
    .insert({
      lead_id: leadId,
      created_by: auth.userId,
      bill_to_name: input.bill_to_name,
      bill_to_business: input.bill_to_business,
      bill_to_email: input.bill_to_email || null,
      bill_to_phone: input.bill_to_phone || null,
      project_title: input.project_title,
      project_ref: projectRef(leadId),
      items: input.items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax_rate: totals.taxRate,
      tax_amount: totals.taxAmount,
      total: totals.total,
      paid_on: input.paid_on,
      payment_method: input.payment_method,
      payment_reference: input.payment_reference || null,
      notes: input.notes,
      signer_name: settings.signerName,
    })
    .select("*")
    .single();
  if (error || !inserted) {
    return NextResponse.json({ error: error?.message ?? "Could not create the receipt" }, { status: 400 });
  }
  const receipt = inserted as ReceiptRow;

  // A receipt that can't be rendered must not exist (it could never be sent).
  let pdf: Buffer;
  try {
    pdf = await renderReceiptPdf(receiptDocFromRow(receipt));
  } catch (e) {
    await admin.from("lead_receipts").delete().eq("id", receipt.id);
    return NextResponse.json({ error: `Could not render the receipt: ${(e as Error).message}` }, { status: 500 });
  }
  // Storage is best-effort: without a stored file the PDF route renders live.
  const pdfPath = await storeReceiptPdf(admin, receipt.id, pdf);

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "receipt.created",
    entity_type: "lead",
    entity_id: leadId,
    new_value: { receipt_id: receipt.id, receipt_no: receipt.receipt_no, total: totals.total },
  });

  return NextResponse.json({ receipt: { ...receipt, pdf_path: pdfPath } }, { status: 201 });
}
