import { NextResponse } from "next/server";
import { z } from "zod";
import { logoAccess, logoErrorResponse, UUID_RE } from "@/lib/logos/access";
import { acceptLogo } from "@/lib/logos/accept";
import { logoStorage } from "@/lib/logos/deps";
import { runUploadChain } from "@/lib/photo-capture/hosts/chain";
import { imageHostStateStore, listImageHosts } from "@/lib/photo-capture/hosts/config";
import { imgbbAdapter } from "@/lib/photo-capture/hosts/imgbb";
import { imgchestAdapter } from "@/lib/photo-capture/hosts/imgchest";
import { postimagesAdapter } from "@/lib/photo-capture/hosts/postimages";
import type { HostProvider, UploadAdapter } from "@/lib/photo-capture/hosts/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ADAPTERS: Record<HostProvider, UploadAdapter> = { imgbb: imgbbAdapter, postimages: postimagesAdapter, imgchest: imgchestAdapter };

const bodySchema = z.object({
  index: z.number().int().min(0).max(50),
  background: z.enum(["transparent", "white"]).default("transparent"),
});

/**
 * Accept a design: upload it to the image host (imgbb first) and put its
 * direct link in the lead's logo field (lib/logos/accept.ts).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; genId: string }> }) {
  const { id, genId } = await params;
  if (!UUID_RE.test(genId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const a = await logoAccess(id);
  if (!a.ok) return a.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a design." }, { status: 422 });
  try {
    const storage = logoStorage(a.admin);
    const result = await acceptLogo(
      {
        db: a.admin,
        readDesign: (path) => storage.get(path),
        upload: async (png, filename) =>
          runUploadChain(
            { url: png.toString("base64"), filename, fetchBytes: async () => png, contentType: "image/png" },
            { hosts: await listImageHosts(), adapters: ADAPTERS, state: imageHostStateStore() },
          ),
      },
      { lead: a.lead, generationId: genId, index: parsed.data.index, background: parsed.data.background, userId: a.userId, actingAs: a.actingAs },
    );
    return NextResponse.json(result);
  } catch (e) {
    return logoErrorResponse(e);
  }
}
