import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";

// POST /api/template-engine/generations/[id]/reopen — send a built (but not
// deployed) run back to curation so the operator can edit content/images and
// rebuild (spec §10 step 5's "Edit content"/"Edit images" loop). The previous
// build's zip/preview stay on the row until the next build overwrites them.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: gen } = await admin
    .from("template_generations")
    .select("id, lead_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!gen) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  const { data: lead } = await supabase.from("leads").select("id").eq("id", gen.lead_id).maybeSingle();
  if (!lead) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  if (gen.status !== "review") {
    return NextResponse.json({ error: "Only a built, undeployed run can be reopened" }, { status: 409 });
  }

  // CAS review -> curating (same pattern as build's curating -> building flip).
  const { data: updated, error } = await admin
    .from("template_generations")
    .update({ status: "curating", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "review")
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!updated) return NextResponse.json({ error: "Only a built, undeployed run can be reopened" }, { status: 409 });

  return NextResponse.json({ ok: true });
}
