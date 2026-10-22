import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChainResult } from "@/lib/photo-capture/hosts/chain";
import { flattenOnWhite } from "./cleanup";
import { getGeneration, LogoError, LOGO_TABLE } from "./store";

/**
 * Accept: the chosen design goes to the company's image host (imgbb first,
 * then the fallbacks in Admin → Image hosts) and its direct link becomes the
 * lead's logo_link. Recorded on the lead's activity like any other edit, with
 * the old link kept in old_value.
 */

export type AcceptBackground = "transparent" | "white";

export interface AcceptDeps {
  db: SupabaseClient;
  readDesign(path: string): Promise<Buffer>;
  upload(png: Buffer, filename: string): Promise<ChainResult>;
  flatten?: (png: Buffer) => Promise<Buffer>;
  now?: () => Date;
}

export interface AcceptInput {
  lead: { id: string; business_name: string; logo_link: string | null };
  generationId: string;
  index: number;
  background: AcceptBackground;
  userId: string;
  /** The agent a closer is acting for (activity log), when one is. */
  actingAs?: unknown;
}

/** "ABC Roofing LLC" → "abc-roofing-llc-logo.png". PURE. */
export function logoFilename(businessName: string): string {
  const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "business";
  return `${slug}-logo.png`;
}

export async function acceptLogo(deps: AcceptDeps, input: AcceptInput): Promise<{ url: string; host: string | null }> {
  const now = (deps.now ?? (() => new Date()))();
  const gen = await getGeneration(deps.db, input.lead.id, input.generationId);
  if (!gen) throw new LogoError("That logo round is gone.", 404);
  const cand = (gen.candidates ?? []).find((c) => c.index === input.index);
  if (!cand) throw new LogoError("That design is gone.", 404);

  let png = await deps.readDesign(cand.path);
  if (input.background === "white") png = await (deps.flatten ?? flattenOnWhite)(png);

  const up = await deps.upload(png, logoFilename(input.lead.business_name));
  if (!up.directUrl) throw new LogoError(`Couldn't upload the logo to the image host: ${up.lastError ?? "every host refused it"}. Check Admin → Image hosts.`, 502);

  const { error } = await deps.db.from("leads").update({ logo_link: up.directUrl }).eq("id", input.lead.id);
  if (error) throw new Error(error.message);

  await deps.db.from("activity_log").insert({
    user_id: input.userId,
    action: "lead.updated",
    entity_type: "lead",
    entity_id: input.lead.id,
    old_value: { logo_link: input.lead.logo_link },
    new_value: {
      logo_link: up.directUrl,
      via: "logo_generator",
      logo_generation_id: gen.id,
      design: cand.index + 1,
      background: input.background,
      host: up.provider,
      ...(input.actingAs ? { acting_as: input.actingAs } : {}),
    },
  });

  await deps.db
    .from(LOGO_TABLE)
    .update({ accepted_index: cand.index, accepted_url: up.directUrl, accepted_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", gen.id);

  return { url: up.directUrl, host: up.provider };
}
