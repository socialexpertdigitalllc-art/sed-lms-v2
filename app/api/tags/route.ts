import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { createTagSchema } from "@/lib/leads/tagsSchema";

/** Auth + permission gate. Passes when the user has ANY of `anyOf`. */
async function guard(
  anyOf: string[]
): Promise<{ error: 401 } | { error: 403 } | { userId: string; perms: Set<string> }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!anyOf.some((p) => perms.has(p))) return { error: 403 };
  return { userId: user.id, perms };
}

function guardError(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 401 ? "Unauthorized" : "Forbidden" },
    { status }
  );
}

export async function GET() {
  const auth = await guard(["leads.tags.view", "leads.tags.manage"]);
  if ("error" in auth) return guardError(auth.error);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_tags")
    .select("id, name, color")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ tags: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await guard(["leads.tags.manage"]);
  if ("error" in auth) return guardError(auth.error);

  const parsed = createTagSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_tags")
    .insert({ name: parsed.data.name, color: parsed.data.color, created_by: auth.userId })
    .select("id, name, color")
    .single();
  if (error || !data) {
    // 23505 = unique_violation on name.
    if (error?.code === "23505") {
      return NextResponse.json({ error: "A tag with that name already exists." }, { status: 422 });
    }
    return NextResponse.json({ error: error?.message ?? "Create failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "lead_tag.created",
    entity_type: "lead_tag",
    entity_id: data.id,
    new_value: data,
  });

  return NextResponse.json({ tag: data }, { status: 201 });
}
