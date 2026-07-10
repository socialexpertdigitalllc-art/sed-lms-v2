import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { contentTypeFor } from "@/lib/template-engine/runner";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  const { id, path } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate") && !perms.has("templates.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parts = (path ?? []).filter((p) => p.length > 0);
  if (parts.length === 0 || parts.some((p) => p === ".." || p.includes("\\"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const storagePath = `${id}/site/${parts.join("/")}`;
  const { data: blob, error } = await admin.storage.from("template-sites").download(storagePath);
  if (error || !blob) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new Response(blob, {
    headers: {
      "Content-Type": contentTypeFor(parts[parts.length - 1], "text/plain"),
      "Cache-Control": "private, max-age=60",
    },
  });
}
