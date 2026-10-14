import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assistantGuard } from "@/lib/assistant/http";
import { ACTIONS_MIGRATION_MESSAGE, isMissingActionTables } from "@/lib/assistant/actions/store";
import { createRecipe, listRecipes, RecipeError, recipeSchema } from "@/lib/assistant/recipes";

export const runtime = "nodejs";

/** The caller's saved shortcuts ("/google-lead"). */
export async function GET() {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ recipes: await listRecipes(createAdminClient(), guard.caller.user.id) });
  } catch (e) {
    if (isMissingActionTables(e)) return NextResponse.json({ recipes: [], unavailable: ACTIONS_MIGRATION_MESSAGE });
    console.error("[assistant] recipes:", e);
    return NextResponse.json({ error: "Could not load your shortcuts." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const guard = await assistantGuard();
  if (!guard.ok) return guard.response;
  const parsed = recipeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 422 });
  const data = { ...parsed.data, mode: parsed.data.mode === "act" && !guard.caller.perms.has("assistant.act") ? ("ask" as const) : parsed.data.mode };
  try {
    return NextResponse.json({ recipe: await createRecipe(createAdminClient(), guard.caller.user.id, data) }, { status: 201 });
  } catch (e) {
    if (e instanceof RecipeError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (isMissingActionTables(e)) return NextResponse.json({ error: ACTIONS_MIGRATION_MESSAGE }, { status: 503 });
    console.error("[assistant] recipe save:", e);
    return NextResponse.json({ error: "Could not save the shortcut." }, { status: 500 });
  }
}
