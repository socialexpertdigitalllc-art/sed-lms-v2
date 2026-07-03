import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const admin = createAdminClient();

  // profile fields (self only)
  const profileUpdate: Record<string, string> = {};
  if (typeof body.displayName === "string" && body.displayName.trim()) {
    profileUpdate.display_name = body.displayName.trim();
  }
  if (typeof body.fullName === "string") {
    profileUpdate.full_name = body.fullName.trim();
  }
  if (Object.keys(profileUpdate).length > 0) {
    const { error } = await admin.from("profiles").update(profileUpdate).eq("id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // password change (self)
  if (body.newPassword) {
    if (typeof body.newPassword !== "string" || body.newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 422 });
    }
    const { error } = await admin.auth.admin.updateUserById(user.id, { password: body.newPassword });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "account.updated",
    entity_type: "user",
    entity_id: user.id,
    new_value: {
      profile: Object.keys(profileUpdate),
      passwordChanged: !!body.newPassword,
    },
  });

  return NextResponse.json({ ok: true });
}
