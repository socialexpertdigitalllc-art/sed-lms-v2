import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Saved shortcuts ("recipes"): a request someone makes often, saved under a
 * command — "/google-lead" — and run from the message box with one pick.
 * Owned by one person; SERVER ONLY (the shapes are shared with the UI).
 */

export interface Recipe {
  id: string;
  name: string;
  command: string;
  prompt: string;
  mode: "ask" | "act";
  uses: number;
  last_used_at: string | null;
  created_at: string;
}

const COLUMNS = "id, name, command, prompt, mode, uses, last_used_at, created_at";
export const MAX_RECIPES = 50;

/** "Google lead!" → "google-lead". */
export function toCommand(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export const recipeSchema = z.object({
  name: z.string().trim().min(1, "Give the shortcut a name.").max(80),
  command: z
    .string()
    .trim()
    .transform(toCommand)
    .refine((c) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(c), "Use letters, numbers and dashes for the command."),
  prompt: z.string().trim().min(1, "The shortcut needs the request it sends.").max(4000),
  mode: z.enum(["ask", "act"]).default("act"),
});

export async function listRecipes(admin: SupabaseClient, userId: string): Promise<Recipe[]> {
  const { data, error } = await admin.from("assistant_recipes").select(COLUMNS).eq("user_id", userId).order("uses", { ascending: false }).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Recipe[];
}

export class RecipeError extends Error {}

export async function createRecipe(admin: SupabaseClient, userId: string, input: z.infer<typeof recipeSchema>): Promise<Recipe> {
  const existing = await listRecipes(admin, userId);
  if (existing.length >= MAX_RECIPES) throw new RecipeError(`You can keep up to ${MAX_RECIPES} shortcuts. Delete one first.`);
  if (existing.some((r) => r.command === input.command)) throw new RecipeError(`You already have /${input.command}. Pick another command.`);
  const { data, error } = await admin.from("assistant_recipes").insert({ ...input, user_id: userId }).select(COLUMNS).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save the shortcut");
  return data as Recipe;
}

export async function updateRecipe(
  admin: SupabaseClient,
  userId: string,
  id: string,
  patch: Partial<z.infer<typeof recipeSchema>> & { used?: boolean },
): Promise<Recipe | null> {
  const { used, ...rest } = patch;
  const next: Record<string, unknown> = { ...rest, updated_at: new Date().toISOString() };
  if (used) {
    const { data: row } = await admin.from("assistant_recipes").select("uses").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!row) return null;
    next.uses = ((row as { uses: number }).uses ?? 0) + 1;
    next.last_used_at = new Date().toISOString();
  }
  const { data, error } = await admin.from("assistant_recipes").update(next).eq("id", id).eq("user_id", userId).select(COLUMNS).maybeSingle();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) throw new RecipeError("You already have a shortcut with that command.");
    throw new Error(error.message);
  }
  return (data as Recipe | null) ?? null;
}

export async function deleteRecipe(admin: SupabaseClient, userId: string, id: string): Promise<boolean> {
  const { data, error } = await admin.from("assistant_recipes").delete().eq("id", id).eq("user_id", userId).select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
