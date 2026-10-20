// lib/contracts/draftAccess.ts
/**
 * Shared gate for the routes that change a contract before it is sent (edit
 * wording, refresh or replace the PDF). SERVER ONLY.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { exportPdf } from "@/lib/google/drive";
import type { ContractRow } from "./types";

export type DraftAccess =
  | { ok: true; userId: string; admin: SupabaseClient; contract: ContractRow }
  | { ok: false; res: NextResponse };

const fail = (error: string, status: number): DraftAccess => ({ ok: false, res: NextResponse.json({ error }, { status }) });

/** Signed in, may send contracts, and the contract exists and is still a draft. */
export async function editableDraft(id: string): Promise<DraftAccess> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail("Unauthorized", 401);
  const perms = await getUserPermissions(user.id);
  if (!perms.has("contracts.send")) return fail("Forbidden", 403);
  const admin = createAdminClient();
  const { data: c } = await admin.from("contracts").select("*").eq("id", id).maybeSingle();
  if (!c) return fail("Contract not found", 404);
  const contract = c as ContractRow;
  if (contract.status !== "draft") return fail("This contract was already sent — it can't be changed. Create a new one instead.", 409);
  return { ok: true, userId: user.id, admin, contract };
}

/** Where a sent contract's PDF lives (the send route writes exactly what it emailed here). */
export const sentPdfPath = (id: string) => `${id}.pdf`;

/**
 * Store `pdf` as the draft's PDF and stamp the edit. Each version gets its own
 * file, so a send racing this edit can never have the PDF it emailed
 * overwritten: the send route keeps its own copy at `{id}.pdf`.
 */
export async function storeContractPdf(
  admin: SupabaseClient,
  contract: ContractRow,
  pdf: Uint8Array,
  uploadedName: string | null,
): Promise<ContractRow> {
  const pdfPath = `${contract.id}-v${Date.now()}.pdf`;
  const bucket = admin.storage.from("contracts");
  const { error: upErr } = await bucket.upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`Could not store the PDF: ${upErr.message}`);
  const { data, error } = await admin
    .from("contracts")
    .update({ pdf_path: pdfPath, pdf_uploaded_name: uploadedName, edited_at: new Date().toISOString() })
    .eq("id", contract.id)
    .eq("status", "draft") // never touch a contract that went out meanwhile
    .select("*")
    .single();
  if (error || !data) {
    await bucket.remove([pdfPath]).catch(() => {});
    throw new Error("The contract was sent while you were editing — nothing was changed.");
  }
  const previous = contract.pdf_path;
  if (previous && previous !== pdfPath && previous !== sentPdfPath(contract.id)) {
    await bucket.remove([previous]).catch(() => {});
  }
  return data as ContractRow;
}

/** Re-make the PDF from the contract's Google Doc (after an edit there or here). */
export async function reexportFromDoc(admin: SupabaseClient, contract: ContractRow): Promise<ContractRow> {
  if (!contract.generated_doc_id) throw new Error("This contract has no Google Doc to export.");
  return storeContractPdf(admin, contract, await exportPdf(contract.generated_doc_id), null);
}
