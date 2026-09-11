import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";

/**
 * The shared lead-category catalog (migration 0077). Starts empty and grows
 * as agents add names at submission time; case-insensitively unique (the
 * `lead_categories_name_ci` index), so "Roofing" and "roofing" are one row.
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await createAdminClient()
    .from("lead_categories")
    .select("id, name")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ categories: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  // Anyone who can create or edit leads may grow the catalog — that is the
  // whole point: the list is built by the people submitting leads.
  if (!perms.has("leads.create") && !perms.has("leads.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name) return NextResponse.json({ error: "Category name is required" }, { status: 422 });
  if (name.length > 60) return NextResponse.json({ error: "Category name is too long (max 60)" }, { status: 422 });

  const admin = createAdminClient();
  // Return the existing row rather than erroring on a duplicate — the caller
  // just wants a category to exist; who typed it first is irrelevant.
  const { data: existing } = await admin.from("lead_categories").select("id, name").ilike("name", name).maybeSingle();
  if (existing) return NextResponse.json({ category: existing });

  const { data, error } = await admin
    .from("lead_categories")
    .insert({ name, created_by: user.id })
    .select("id, name")
    .single();
  if (error) {
    // Lost a create race to the unique index — the winner's row is the answer.
    const { data: raced } = await admin.from("lead_categories").select("id, name").ilike("name", name).maybeSingle();
    if (raced) return NextResponse.json({ category: raced });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ category: data }, { status: 201 });
}
