import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError, untrustedContentHeaders } from "@/lib/site-studio/service/guard";
import { loadSourceMap } from "@/lib/site-studio/service/templates";
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
  const source = await loadSourceMap(admin, id).catch(() => null);
  if (!source) return NextResponse.json({ error: "Source zip missing" }, { status: 404 });
  const bytes = source[file];
  if (!bytes) return NextResponse.json({ error: "File not in source" }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: untrustedContentHeaders(contentTypeFor(file)),
  });
}
