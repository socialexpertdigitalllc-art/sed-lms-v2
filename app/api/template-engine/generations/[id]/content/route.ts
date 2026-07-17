import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { contentModelSchema } from "@/lib/template-engine/contentModel";
import { applyContentEdit } from "@/lib/template-engine/contentEdit";

interface GenRow {
  id: string;
  lead_id: string;
  status: string;
  content_model: unknown;
}

// PATCH /api/template-engine/generations/[id]/content - save the operator's
// step-2 edits. Only while the run is paused at `curating` (the build phase
// re-reads content_model, so edits made here flow into the build). Follows
// the curation routes' exact gate order: auth -> perm -> row -> RLS lead -> state.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: genRow } = await admin
    .from("template_generations")
    .select("id, lead_id, status, content_model")
    .eq("id", id)
    .maybeSingle();
  if (!genRow) return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  const gen = genRow as GenRow;

  // RLS-scoped lookup: a lead this user cannot see must 404, not edit (mirrors generate/route.ts).
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", gen.lead_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (gen.status !== "curating") {
    return NextResponse.json({ error: "Not in curation" }, { status: 409 });
  }
  const existing = contentModelSchema.safeParse(gen.content_model);
  if (!existing.success) {
    return NextResponse.json({ error: "Run has no editable content model" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  let next;
  try {
    next = applyContentEdit(existing.data, body);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Invalid content";
    return NextResponse.json({ error: "Invalid content", detail }, { status: 422 });
  }

  // CAS: a concurrent build start must not lose to a save. Supabase returns
  // NO error on a 0-row update, so the row must be selected back — the repo's
  // established pattern (see build/route.ts's curating->building flip).
  const { data: updated, error } = await admin
    .from("template_generations")
    .update({ content_model: next, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "curating")
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!updated) return NextResponse.json({ error: "Not in curation" }, { status: 409 }); // lost the race

  return NextResponse.json({ content_model: next });
}
