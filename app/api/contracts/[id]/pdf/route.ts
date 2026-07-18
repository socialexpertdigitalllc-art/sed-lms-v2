import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { renderContractPdf } from "@/lib/contracts/ContractDocument";
import { signatureRenderArgs } from "@/lib/contracts/pdf";
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

  // Sent contracts serve their retained PDF; drafts render live from the snapshot.
  if (contract.status === "sent" && contract.pdf_path) {
    const { data: blob } = await admin.storage.from("contracts").download(contract.pdf_path);
    if (blob) {
      return new Response(blob, {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="contract-${id}.pdf"` },
      });
    }
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
    },
    sig
  );
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="contract-${id}.pdf"` },
  });
}
