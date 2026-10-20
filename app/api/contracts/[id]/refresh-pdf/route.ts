import { NextResponse } from "next/server";
import { editableDraft, reexportFromDoc } from "@/lib/contracts/draftAccess";

export const runtime = "nodejs";

/**
 * Re-make a draft's PDF from its Google Doc — after someone edited the doc in
 * Google Docs directly, or to go back to the generated PDF after uploading a
 * replacement.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await editableDraft(id);
  if (!access.ok) return access.res;
  const { admin, contract, userId } = access;
  if (!contract.generated_doc_id) {
    return NextResponse.json({ error: "This contract has no Google Doc to make the PDF from." }, { status: 409 });
  }
  try {
    const updated = await reexportFromDoc(admin, contract);
    await admin.from("activity_log").insert({
      user_id: userId, action: "contract.pdf_refreshed", entity_type: "contract", entity_id: contract.id,
      new_value: { replaced_upload: !!contract.pdf_uploaded_name },
    });
    return NextResponse.json({ contract: updated });
  } catch (e) {
    return NextResponse.json({ error: `Could not refresh the PDF: ${(e as Error).message}` }, { status: 502 });
  }
}
