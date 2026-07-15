import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { leadTagsSchema } from "@/lib/leads/tagsSchema";

/** Replace the full set of tags applied to a lead. */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.tags.manage")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = leadTagsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }
  // Dedupe so a repeated id can't trip the unique(lead_id, tag_id) constraint.
  const tagIds = Array.from(new Set(parsed.data.tagIds));

  // The lead must be visible to THIS user (RLS: view_all or own) — you can only
  // tag leads you can see. Verified via the user client, then written as admin.
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const admin = createAdminClient();

  // Tags are user-scoped: a user may only apply their OWN tags. Verify every
  // incoming id is owned by the caller before touching any links.
  if (tagIds.length) {
    const { data: owned } = await admin
      .from("lead_tags")
      .select("id")
      .in("id", tagIds)
      .eq("owner_id", user.id);
    if ((owned?.length ?? 0) !== tagIds.length) {
      return NextResponse.json({ error: "You can only apply your own tags." }, { status: 422 });
    }
  }

  // Replace only the caller's own links on this lead — other users' tags stay put.
  const { error: delError } = await admin
    .from("lead_tag_links")
    .delete()
    .eq("lead_id", id)
    .eq("added_by", user.id);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 400 });

  if (tagIds.length) {
    const { error: insError } = await admin
      .from("lead_tag_links")
      .insert(tagIds.map((tag_id) => ({ lead_id: id, tag_id, added_by: user.id })));
    if (insError) return NextResponse.json({ error: insError.message }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "lead.tags_updated",
    entity_type: "lead",
    entity_id: id,
    new_value: { tag_ids: tagIds },
  });

  return NextResponse.json({ ok: true });
}
