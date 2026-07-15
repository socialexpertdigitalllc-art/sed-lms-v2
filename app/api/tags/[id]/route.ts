import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { updateTagSchema } from "@/lib/leads/tagsSchema";

async function guard(): Promise<{ error: 401 } | { error: 403 } | { userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.tags.manage")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 401 ? "Unauthorized" : "Forbidden" },
    { status }
  );
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await params;

  const parsed = updateTagSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  // Ownership check: the route uses the admin client (bypasses RLS), so verify
  // the caller owns this tag before mutating it.
  const { data: existing } = await admin.from("lead_tags").select("owner_id").eq("id", id).single();
  if (!existing) return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  if (existing.owner_id !== auth.userId) {
    return NextResponse.json({ error: "You can only edit your own tags." }, { status: 403 });
  }

  const { data, error } = await admin
    .from("lead_tags")
    .update(parsed.data)
    .eq("id", id)
    .select("id, name, color, owner_id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "You already have a tag with that name." }, { status: 422 });
    }
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "lead_tag.updated",
    entity_type: "lead_tag",
    entity_id: id,
    new_value: parsed.data,
  });

  return NextResponse.json({ tag: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await params;

  const admin = createAdminClient();
  // Ownership check (admin client bypasses RLS — verify explicitly).
  const { data: existing } = await admin.from("lead_tags").select("owner_id").eq("id", id).single();
  if (!existing) return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  if (existing.owner_id !== auth.userId) {
    return NextResponse.json({ error: "You can only edit your own tags." }, { status: 403 });
  }
  // Links are removed by the `on delete cascade` on lead_tag_links.tag_id.
  const { error } = await admin.from("lead_tags").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "lead_tag.deleted",
    entity_type: "lead_tag",
    entity_id: id,
  });

  return NextResponse.json({ ok: true });
}
