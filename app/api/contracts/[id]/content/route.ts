import { NextResponse } from "next/server";
import { z } from "zod";
import { editableDraft, reexportFromDoc } from "@/lib/contracts/draftAccess";
import { docToBlocks, buildEditRequests, BlockEditError, type BlockEdit } from "@/lib/contracts/docEdit";
import { getDocument, batchUpdateDoc, DocChangedError } from "@/lib/google/docs";

export const runtime = "nodejs";

/**
 * The wording of a draft contract, paragraph by paragraph, straight from its
 * Google Doc — and the edits made to it in the dashboard. Edits go into the
 * doc itself, then the PDF is re-exported, so the template's look is kept.
 */

const NO_DOC = "Only contracts generated from a Google Docs template can be edited here.";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await editableDraft(id);
  if (!access.ok) return access.res;
  const { contract } = access;
  if (!contract.generated_doc_id) return NextResponse.json({ error: NO_DOC }, { status: 409 });
  try {
    const doc = await getDocument(contract.generated_doc_id);
    return NextResponse.json({ blocks: docToBlocks(doc.body), revisionId: doc.revisionId, docUrl: contract.generated_doc_url });
  } catch (e) {
    return NextResponse.json({ error: `Could not open the contract's Google Doc: ${(e as Error).message}` }, { status: 502 });
  }
}

const text = z.string().max(20_000);
const editSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace"), key: z.string().max(20), oldText: text, text }),
  z.object({ op: z.literal("remove"), key: z.string().max(20), oldText: text }),
  z.object({ op: z.literal("insert_after"), key: z.string().max(20), paragraphs: z.array(text).min(1).max(100) }),
]);
const putSchema = z.object({
  revisionId: z.string().min(1).max(200),
  edits: z.array(editSchema).min(1).max(500),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await editableDraft(id);
  if (!access.ok) return access.res;
  const { admin, contract, userId } = access;
  if (!contract.generated_doc_id) return NextResponse.json({ error: NO_DOC }, { status: 409 });

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  const { revisionId, edits } = parsed.data;

  const docId = contract.generated_doc_id;
  let changed = 0;
  try {
    const doc = await getDocument(docId);
    // The paragraph keys are positions in the revision the editor loaded;
    // against any other revision they would point at the wrong text.
    if (doc.revisionId && doc.revisionId !== revisionId) throw new DocChangedError();
    const requests = buildEditRequests(docToBlocks(doc.body), edits as BlockEdit[]);
    changed = requests.length;
    if (!changed) {
      return NextResponse.json({ contract, blocks: docToBlocks(doc.body), revisionId: doc.revisionId });
    }
    await batchUpdateDoc(docId, requests, revisionId);
  } catch (e) {
    if (e instanceof DocChangedError) return NextResponse.json({ error: e.message, code: "doc_changed" }, { status: 409 });
    if (e instanceof BlockEditError) return NextResponse.json({ error: e.message, code: "doc_changed" }, { status: 409 });
    return NextResponse.json({ error: `Google Docs refused the edit: ${(e as Error).message}` }, { status: 502 });
  }

  let updated = contract;
  try {
    updated = await reexportFromDoc(admin, contract);
  } catch (e) {
    return NextResponse.json(
      { error: `Your edits are saved in the Google Doc, but the PDF couldn't be refreshed: ${(e as Error).message} — use Refresh PDF.` },
      { status: 502 },
    );
  }

  await admin.from("activity_log").insert({
    user_id: userId, action: "contract.edited", entity_type: "contract", entity_id: contract.id,
    new_value: { edits: edits.length, requests: changed, replaced_upload: !!contract.pdf_uploaded_name },
  });

  const fresh = await getDocument(docId).catch(() => null);
  return NextResponse.json({
    contract: updated,
    blocks: fresh ? docToBlocks(fresh.body) : null,
    revisionId: fresh?.revisionId ?? null,
  });
}
