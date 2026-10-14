import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assistantGuard, UUID_RE } from "@/lib/assistant/http";
import { deleteRecipe, RecipeError, recipeSchema, updateRecipe } from "@/lib/assistant/recipes";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Rename / edit a shortcut, or count a use ({ used: true }). */
export async function PATCH(req: Request, { params }: Ctx) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Shortcut not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const used = body?.used === true;
  const parsed = recipeSchema.partial().safeParse({ ...(body ?? {}), used: undefined });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 422 });
  try {
    const recipe = await updateRecipe(createAdminClient(), guard.caller.user.id, id, { ...parsed.data, used });
    if (!recipe) return NextResponse.json({ error: "Shortcut not found" }, { status: 404 });
    return NextResponse.json({ recipe });
  } catch (e) {
    if (e instanceof RecipeError) return NextResponse.json({ error: e.message }, { status: 409 });
    console.error("[assistant] recipe update:", e);
    return NextResponse.json({ error: "Could not update the shortcut." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Shortcut not found" }, { status: 404 });
  try {
    const removed = await deleteRecipe(createAdminClient(), guard.caller.user.id, id);
    if (!removed) return NextResponse.json({ error: "Shortcut not found" }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (e) {
    console.error("[assistant] recipe delete:", e);
    return NextResponse.json({ error: "Could not delete the shortcut." }, { status: 500 });
  }
}
