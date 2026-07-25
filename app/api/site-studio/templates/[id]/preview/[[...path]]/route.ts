import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { manifestSchema } from "@/lib/site-studio/schema";
import { sampleContentDoc } from "@/lib/site-studio/sample";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { loadPackage } from "@/lib/site-studio/service/templates";
import { contentTypeFor } from "@/lib/site-studio/service/contentType";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; path?: string[] }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id, path } = await ctx.params;
  const file = (path ?? []).join("/") || "index.html";

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,manifest").eq("id", id).single();
  if (!row?.manifest) return NextResponse.json({ error: "No compiled package" }, { status: 404 });

  const manifest = manifestSchema.parse(row.manifest);
  const tpl = await loadPackage(admin, id, manifest);
  const rendered = renderSite(tpl, sampleContentDoc(manifest));
  if (!rendered.ok) {
    return NextResponse.json({ error: "Sample render refused", missing: rendered.missing }, { status: 500 });
  }
  const bytes = rendered.files[file];
  if (!bytes) return NextResponse.json({ error: "File not in rendered package" }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentTypeFor(file),
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
