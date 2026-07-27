import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { BUILDER_SITES_BUCKET } from "@/lib/site-builder/run";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** GET — the run's assembled site zip, as a browser download. The filename
 *  is the lead's business name (slugified) so a folder of downloaded sites
 *  stays tellable-apart; the run id is the fallback. */
export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: run, error: fetchErr } = await admin
    .from("builder_runs")
    .select("id, output_path, leads(business_name)")
    .eq("id", id)
    .single();
  if (fetchErr || !run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!run.output_path) {
    return NextResponse.json({ error: "This run has no packaged zip yet." }, { status: 409 });
  }

  const { data: blob, error: dlErr } = await admin.storage
    .from(BUILDER_SITES_BUCKET)
    .download(run.output_path as string);
  if (dlErr || !blob) {
    return NextResponse.json({ error: "Site zip not found in storage." }, { status: 404 });
  }

  const businessName = (run.leads as { business_name?: string } | null)?.business_name ?? "";
  const slug =
    businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || id;

  return new NextResponse(await blob.arrayBuffer(), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slug}-site.zip"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
