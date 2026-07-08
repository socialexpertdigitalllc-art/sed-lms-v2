import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { z } from "zod";

async function guard(): Promise<{ error: 401 } | { error: 403 } | { userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.settings.manage")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json(
    { error: status === 401 ? "Unauthorized" : "Forbidden" },
    { status }
  );
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const admin = createAdminClient();
  const { data, error } = await admin.from("website_addons").select("*").order("sort");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ addons: data ?? [] });
}

const createSchema = z.object({
  label: z.string().trim().min(1),
  price: z.number().nullable().optional(),
  sort: z.number().int().optional(),
});

export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("website_addons")
    .insert({ ...parsed.data, created_by: auth.userId })
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Create failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "addon.created",
    entity_type: "website_addon",
    entity_id: data.id,
    new_value: data,
  });

  return NextResponse.json({ addon: data }, { status: 201 });
}
