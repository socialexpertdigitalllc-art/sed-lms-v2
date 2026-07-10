import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().trim().max(40).optional(),
});
function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "dept";
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.departments.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });

  const admin = createAdminClient();
  const base = slugify(parsed.data.name);
  // unique-ify the slug
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const { data: hit } = await admin.from("departments").select("id").eq("slug", slug).maybeSingle();
    if (!hit) break;
    slug = `${base}-${i}`;
  }
  const { data: row, error } = await admin.from("departments").insert({
    name: parsed.data.name,
    slug,
    description: parsed.data.description ?? null,
    color: parsed.data.color ?? "#0D9488",
    icon: parsed.data.icon ?? "building",
  }).select("id, name, slug, color, description").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: user.id, action: "department.created", entity_type: "department", entity_id: row.id,
    new_value: { name: row.name, slug: row.slug },
  });
  return NextResponse.json({ department: row }, { status: 201 });
}
