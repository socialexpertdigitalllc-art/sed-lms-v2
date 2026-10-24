import type { SupabaseClient } from "@supabase/supabase-js";
import { providerSpecFor } from "@/lib/ai-tools/providers/config";
import { callForTask } from "@/lib/ai-tools/providers/run";
import type { ProviderSpec } from "@/lib/ai-tools/run";
import { geminiImage } from "./geminiImage";
import { drawImage } from "./minimaxImage";
import type { LogoEngine, LogoRunnerDeps, LogoStorage } from "./runner";
import { LogoError } from "./store";

/**
 * The production wiring of the logo runner: the two designers (Google's image
 * model through the Gemini API key, MiniMax image-01), the routed text/vision
 * models, Supabase storage.
 */

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

export const NO_DESIGNER_MESSAGE = "No logo designer is set up — an admin needs to add a Google Gemini or MiniMax API key under Admin → AI providers.";

export interface Designers {
  /** The Gemini API key's spec (Google's image models share it), or null. */
  google: ProviderSpec | null;
  /** The MiniMax account's spec (image-01 shares the chat key), or null. */
  minimax: ProviderSpec | null;
}

/** Which designers are set up. Any model id resolves the provider's key; these are the registry's. */
export async function designers(): Promise<Designers> {
  const [g, m] = await Promise.all([providerSpecFor("gemini", "gemini-3.5-flash").catch(() => null), providerSpecFor("minimax", "MiniMax-M3").catch(() => null)]);
  return { google: g?.spec ?? null, minimax: m?.spec ?? null };
}

/**
 * The designer a round uses when nobody picked one: LOGO_IMAGE_ENGINE when an
 * admin set it (and it is set up), else MiniMax (the plan the company already
 * pays for) — Google, billed per picture, is chosen per round ("Design with
 * Google", Retry → Designer) — else whichever is set up.
 */
export function defaultEngine(d: Designers, env = process.env.LOGO_IMAGE_ENGINE): LogoEngine | null {
  const wanted = env === "minimax" || env === "google" ? env : null;
  if (wanted && d[wanted]) return wanted;
  return d.minimax ? "minimax" : d.google ? "google" : null;
}

export function productionLogoDeps(admin: SupabaseClient, d: Designers): LogoRunnerDeps {
  if (!d.google && !d.minimax) throw new LogoError(NO_DESIGNER_MESSAGE, 503);
  const google = d.google;
  const minimax = d.minimax;
  return {
    db: admin,
    storage: logoStorage(admin),
    writeConcepts: async (system, user) =>
      (await callForTask("logo_concepts", system, user, { maxTokens: 8000, temperature: 0.9, timeoutMs: 120_000, maxAttempts: 2 })).text,
    readLogo: async (system, user, imageUrl) =>
      (await callForTask("logo_check", system, user, { maxTokens: 4000, temperature: 0, images: [imageUrl], timeoutMs: 75_000, maxAttempts: 2 })).text,
    // A complete logo, wide, at 2K — or an edit of a picture (a change, a lettering fix).
    art: google ? (prompt, image) => geminiImage(google, { prompt, image: image ?? null, aspectRatio: "16:9", imageSize: "2K" }) : null,
    // MiniMax: the symbol only, square; the name is typeset beside it (compose.ts).
    draw: minimax ? (prompt, seed) => drawImage(minimax, { prompt, seed, width: SYMBOL_SIZE, height: SYMBOL_SIZE }) : null,
  };
}
