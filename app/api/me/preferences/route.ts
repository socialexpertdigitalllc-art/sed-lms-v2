import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED = new Set(["sidebarPinned", "density", "columns"]); // extend as prefs grow

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body ?? {})) if (ALLOWED.has(k)) patch[k] = v;
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const { data: row } = await admin.from("profiles").select("ui_preferences").eq("id", user.id).single();
  const merged = { ...((row?.ui_preferences as Record<string, unknown>) ?? {}), ...patch };
  const { error } = await admin.from("profiles").update({ ui_preferences: merged }).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, ui_preferences: merged });
}
