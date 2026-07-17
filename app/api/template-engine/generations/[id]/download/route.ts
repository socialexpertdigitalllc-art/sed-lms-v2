import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { isDeployableStatus } from "@/lib/template-engine/wizard";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate") && !perms.has("templates.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: gen } = await admin
    .from("template_generations")
    .select("id, status, zip_path, site_slug")
    .eq("id", id)
    .maybeSingle();
  if (!gen) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  if (!isDeployableStatus(gen.status)) {
    return NextResponse.json({ error: "Generation is not ready for download" }, { status: 409 });
  }
  if (!gen.zip_path) {
    return NextResponse.json({ error: "This generation has no packaged zip" }, { status: 404 });
  }

  const { data: blob, error } = await admin.storage.from("template-sites").download(gen.zip_path);
  if (error || !blob) {
    return NextResponse.json({ error: "Site zip not found in storage" }, { status: 404 });
  }

  return new Response(blob, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${gen.site_slug ?? "site"}.zip"`,
    },
  });
}
