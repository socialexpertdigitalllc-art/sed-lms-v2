import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { renderContractPdf } from "@/lib/contracts/ContractDocument";
import { signatureRenderArgs } from "@/lib/contracts/pdf";
import { editableDraft, storeContractPdf } from "@/lib/contracts/draftAccess";
import { checkPdfUpload, filePart } from "@/lib/contracts/upload";
import type { ContractRow } from "@/lib/contracts/types";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("contracts.view") && !perms.has("contracts.send")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: c } = await admin.from("contracts").select("*").eq("id", id).maybeSingle();
  if (!c) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  const contract = c as ContractRow;

  // Any contract with a stored PDF (Google-generated draft, or a sent contract)
  // serves the retained file; react-pdf drafts render live from the snapshot.
  // no-store: a draft's PDF changes as it is edited or replaced.
  const headers = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="contract-${id}.pdf"`,
    "Cache-Control": "private, no-store",
  };
  if (contract.pdf_path) {
    const { data: blob } = await admin.storage.from("contracts").download(contract.pdf_path);
    if (blob) return new Response(blob, { headers });
  }

  const sig = await signatureRenderArgs(contract.created_by ?? user.id);
  const buffer = await renderContractPdf(
    {
      business_name: contract.business_name,
      business_phone: contract.business_phone,
      business_email: contract.business_email,
      one_time_price: contract.one_time_price,
      yearly_price: contract.yearly_price,
      agent_name: contract.agent_name,
      contract_date: contract.contract_date,
      payment_plan: contract.payment_plan ?? null,
    },
    sig,
    contract.template_key
  );
  return new Response(new Uint8Array(buffer), { headers });
}

/**
 * Replace a draft's PDF with the agent's own file (multipart, field `file`).
 * The generated Google Doc, if any, is kept: Refresh PDF goes back to it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await editableDraft(id);
  if (!access.ok) return access.res;
  const { admin, contract, userId } = access;

  const form = await req.formData().catch(() => null);
  const file = form ? await filePart(form) : null;
  if (!file) return NextResponse.json({ error: "Choose the PDF to upload" }, { status: 422 });
  const check = checkPdfUpload(file.bytes, file.name);
  if (!check.ok) return NextResponse.json({ error: check.message }, { status: 422 });

  try {
    const updated = await storeContractPdf(admin, contract, file.bytes, check.name);
    await admin.from("activity_log").insert({
      user_id: userId, action: "contract.pdf_uploaded", entity_type: "contract", entity_id: contract.id,
      new_value: { file: check.name, bytes: file.bytes.length },
    });
    return NextResponse.json({ contract: updated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
}
