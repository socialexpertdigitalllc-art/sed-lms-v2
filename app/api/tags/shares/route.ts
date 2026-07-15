import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { tagShareSchema } from "@/lib/leads/tagsSchema";

/** Auth + `leads.tags.share` gate. */
async function guard(): Promise<{ error: 401 } | { error: 403 } | { userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.tags.share")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 401 ? "Unauthorized" : "Forbidden" },
    { status }
  );
}

/** GET → my shares + the pickable targets (active departments, other users). */
export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const admin = createAdminClient();
  const [{ data: shares }, { data: departments }, { data: users }] = await Promise.all([
    admin.from("lead_tag_shares").select("id, target_type, target_id").eq("owner_id", auth.userId),
    admin.from("departments").select("id, name, color").eq("is_active", true).order("name"),
    admin
      .from("profiles")
      .select("id, display_name")
      .eq("is_active", true)
      .neq("id", auth.userId)
      .order("display_name"),
  ]);

  return NextResponse.json({
    shares: shares ?? [],
    departments: departments ?? [],
    users: (users ?? []).map((u) => ({ id: u.id, display_name: u.display_name ?? "—" })),
  });
}

/** POST { target_type, target_id } → share my tags with that target (conflict-ignore). */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const parsed = tagShareSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lead_tag_shares")
    .upsert(
      {
        owner_id: auth.userId,
        target_type: parsed.data.target_type,
        target_id: parsed.data.target_id,
        created_by: auth.userId,
      },
      { onConflict: "owner_id,target_type,target_id", ignoreDuplicates: true }
    )
    .select("id, target_type, target_id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // `data` is null when the share already existed (ignoreDuplicates) — the client
  // refetches in that case, so returning null is fine.
  return NextResponse.json({ share: data ?? null }, { status: 201 });
}

/** DELETE ?id= → unshare (only my own shares). */
export async function DELETE(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("lead_tag_shares")
    .delete()
    .eq("id", id)
    .eq("owner_id", auth.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
