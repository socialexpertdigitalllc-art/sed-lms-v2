import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import {
  LEAD_FIELD_SOURCES,
  isBuiltInToken,
  isLeadFieldSource,
  normalizeToken,
} from "@/lib/contracts/placeholders";

export const runtime = "nodejs";

async function guard(): Promise<{ error: 401 } | { error: 403 } | { userId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contract_placeholders")
    .select("id, token, lead_field, label, created_at")
    .order("token", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ placeholders: data ?? [] });
}

const createSchema = z.object({
  token: z.string().trim().min(1).max(80),
  lead_field: z.string().trim().min(1).max(80),
});

export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const token = normalizeToken(parsed.data.token);
  if (!token) {
    return NextResponse.json(
      { error: "Token must use letters, numbers and underscores only (e.g. owner_name)" },
      { status: 422 }
    );
  }
  if (!isLeadFieldSource(parsed.data.lead_field)) {
    return NextResponse.json({ error: "Unknown lead field" }, { status: 422 });
  }
  if (isBuiltInToken(token)) {
    return NextResponse.json({ error: `${token} is a built-in placeholder` }, { status: 409 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contract_placeholders")
    .insert({
      token,
      lead_field: parsed.data.lead_field,
      label: LEAD_FIELD_SOURCES[parsed.data.lead_field].label,
      created_by: auth.userId,
    })
    .select("id, token, lead_field, label, created_at")
    .single();

  if (error || !data) {
    const dup = error?.code === "23505";
    return NextResponse.json(
      { error: dup ? `${token} is already registered` : error?.message ?? "Create failed" },
      { status: dup ? 409 : 400 }
    );
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "contract_placeholder.created",
    entity_type: "contract_placeholder",
    entity_id: data.id,
    new_value: data,
  });

  return NextResponse.json({ placeholder: data }, { status: 201 });
}
