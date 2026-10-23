import type { SupabaseClient } from "@supabase/supabase-js";
import { providerSpecFor } from "@/lib/ai-tools/providers/config";
import { callForTask } from "@/lib/ai-tools/providers/run";
import type { ProviderSpec } from "@/lib/ai-tools/run";
import { drawImage } from "./minimaxImage";
import type { LogoRunnerDeps, LogoStorage } from "./runner";
import { LogoError } from "./store";

/** The production wiring of the logo runner (MiniMax, the routed text/vision models, Supabase storage). */

export const LOGO_BUCKET = "branding";
const SYMBOL_SIZE = 1024;

export function logoStorage(admin: SupabaseClient): LogoStorage {
  return {
    async put(path, png) {
      const { error } = await admin.storage.from(LOGO_BUCKET).upload(path, png, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
      if (error) throw new Error(`Couldn't save the design (${error.message}).`);
      return admin.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
    },
    async get(path) {
      const { data, error } = await admin.storage.from(LOGO_BUCKET).download(path);
      if (error || !data) throw new Error(`Couldn't read the design (${error?.message ?? "missing"}).`);
      return Buffer.from(await data.arrayBuffer());
    },
  };
}

export const MINIMAX_SETUP_MESSAGE = "MiniMax isn't set up — an admin needs to add its API key under Admin → AI providers.";

/** The MiniMax account's spec (the image model shares the chat models' key and rate budget). */
export async function minimaxSpec(): Promise<ProviderSpec> {
  const r = await providerSpecFor("minimax", "MiniMax-M3");
  if (!r.spec) throw new LogoError(MINIMAX_SETUP_MESSAGE, 503);
  return r.spec;
}

export function productionLogoDeps(admin: SupabaseClient, spec: ProviderSpec): LogoRunnerDeps {
  return {
    db: admin,
    storage: logoStorage(admin),
    writeConcepts: async (system, user) =>
      (await callForTask("logo_concepts", system, user, { maxTokens: 8000, temperature: 0.9, timeoutMs: 120_000, maxAttempts: 2 })).text,
    readLogo: async (system, user, imageUrl) =>
      (await callForTask("logo_check", system, user, { maxTokens: 4000, temperature: 0, images: [imageUrl], timeoutMs: 75_000, maxAttempts: 2 })).text,
    // The symbol only, square; the name is typeset beside it (compose.ts).
    draw: (prompt, seed) => drawImage(spec, { prompt, seed, width: SYMBOL_SIZE, height: SYMBOL_SIZE }),
  };
}
