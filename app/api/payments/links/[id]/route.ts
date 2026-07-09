import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { paymentLinkPatchSchema } from "@/lib/payments/schema";

async function guard(
  minPerm: string
): Promise<{ error: 401 } | { error: 403 } | { userId: string; perms: Set<string> }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has(minPerm)) return { error: 403 };
  return { userId: user.id, perms };
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
  const auth = await guard("payments.manage");
  if ("error" in auth) return guardError(auth.error);
  const { id } = await params;

  const parsed = paymentLinkPatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payment_links")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "payment_link.updated",
    entity_type: "payment_link",
    entity_id: id,
    new_value: parsed.data,
  });

  return NextResponse.json({ link: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("payments.manage");
  if ("error" in auth) return guardError(auth.error);
  const { id } = await params;

  const admin = createAdminClient();
  const { error } = await admin.from("payment_links").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "payment_link.deleted",
    entity_type: "payment_link",
    entity_id: id,
  });

  return NextResponse.json({ ok: true });
}
