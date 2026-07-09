import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { paymentLinkSchema } from "@/lib/payments/schema";

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

export async function GET() {
  const auth = await guard("payments.view");
  if ("error" in auth) return guardError(auth.error);

  const admin = createAdminClient();
  const query = admin
    .from("payment_links")
    .select("*")
    .order("category")
    .order("sort")
    .order("created_at");
  // Viewers without `payments.manage` only ever see active links — decided
  // server-side, never trusting a client-supplied filter.
  const { data, error } = await (auth.perms.has("payments.manage") ? query : query.eq("is_active", true));
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ links: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await guard("payments.manage");
  if ("error" in auth) return guardError(auth.error);

  const parsed = paymentLinkSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payment_links")
    .insert({ ...parsed.data, notes: parsed.data.notes ?? null, created_by: auth.userId })
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Create failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "payment_link.created",
    entity_type: "payment_link",
    entity_id: data.id,
    new_value: data,
  });

  return NextResponse.json({ link: data }, { status: 201 });
}
