import { NextResponse } from "next/server";
import { logoAccess, logoErrorResponse, UUID_RE } from "@/lib/logos/access";
import { cancelGeneration, generationView, getGeneration } from "@/lib/logos/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stop a running round (designs already drawn stay). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; genId: string }> }) {
  const { id, genId } = await params;
  if (!UUID_RE.test(genId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const a = await logoAccess(id);
  if (!a.ok) return a.response;
  try {
    const row = (await cancelGeneration(a.admin, id, genId)) ?? (await getGeneration(a.admin, id, genId));
    if (!row) return NextResponse.json({ error: "That logo round is gone." }, { status: 404 });
    return NextResponse.json({ generation: generationView(row) });
  } catch (e) {
    return logoErrorResponse(e);
  }
}
