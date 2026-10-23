import type { SupabaseClient } from "@supabase/supabase-js";
import { logoBrief, type BrandColor, type LeadForBrief, type LogoBrief } from "./brief";
import { designScore, iconCheckPrompt, ICON_CHECK_SYSTEM, parseIconReading, type IconReading } from "./check";
import { cleanLogo, loadSharp, type CleanLogo } from "./cleanup";
import { composeLockup, initialsFor, type LockupInput } from "./compose";
import {
  CONCEPT_SYSTEM,
  conceptColors,
  conceptUserPrompt,
  fallbackConcepts,
  iconPrompt,
  normalizeConcept,
  parseConceptReply,
  type ConceptReply,
  type ConceptRequest,
  type LogoConcept,
} from "./prompt";
import { applyCase } from "./typeset";
import { IMAGES_PER_ROUND_MAX, LOGO_TABLE, type LogoCandidate, type LogoGeneration } from "./store";

/**
 * One logo round, start to finish, with nobody waiting on the request:
 *
 *   concepts  → a text model designs 4 logos as data: layout, symbol, font,
 *               case, line split, colours (code-written ones if it is down);
 *   drawing   → MiniMax image-01 draws each SYMBOL only — never any text.
 *               The symbol is cleaned (background removed), checked by a
 *               vision model for stray letters (drawn again once if it has
 *               any), then the business name is TYPESET beside it in the
 *               chosen font (compose.ts). So the name is always spelled
 *               exactly as typed, with properly formed letters;
 *   ready     → the designs, best first.
 *
 * Changing a design ("refine") reuses its symbol exactly unless the change is
 * about the symbol itself — so "bolder name" or "another font" really is the
 * same logo, changed. If MiniMax can't draw at all, the designs still come
 * back, with a badge of the initials in place of the symbol.
 *
 * Every write is guarded by status = running, so Stop (or the stale sweep)
 * wins over a late write.
 */

export const ROUND_SIZE = 4;
const HEARTBEAT_MS = 60_000;

export interface LogoStorage {
  /** Save a PNG; returns its public URL. */
  put(path: string, png: Buffer): Promise<string>;
  /** Read a saved PNG back (a design's symbol, to reuse it). */
  get(path: string): Promise<Buffer>;
}

export interface LogoRunnerDeps {
  db: SupabaseClient;
  storage: LogoStorage;
  /** The concept writer (text model): system + user prompt → reply text. */
  writeConcepts(system: string, user: string): Promise<string>;
  /** The symbol checker (vision model): one image URL → reply text. Null when none is set up. */
  readLogo: ((system: string, user: string, imageUrl: string) => Promise<string>) | null;
  /** MiniMax image-01: prompt + seed → a square picture of the symbol. */
  draw(prompt: string, seed: number): Promise<Buffer>;
  clean?: (img: Buffer, brand: BrandColor[]) => Promise<CleanLogo>;
  compose?: (input: LockupInput) => Promise<{ png: Buffer; width: number; height: number }>;
  now?: () => Date;
  random?: () => number;
}

export interface RunOptions {
  /** A font the person picked in Retry: every design uses it. */
  font?: string | null;
}

const LEAD_COLUMNS = "id, business_name, services, category, about_business, color_scheme";

const newSeed = (random: () => number) => 1 + Math.floor(random() * 2_000_000_000);
const firstMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Without the writer saying, a change request about the symbol's look (not its size) redraws it. PURE. */
export function wantsNewIcon(instructions: string | null | undefined): boolean {
  const t = (instructions ?? "").toLowerCase();
  if (!/\b(icon|symbol|graphic|picture|image|emblem|mark|drawing)\b/.test(t)) return false;
  return !/\b(bigger|smaller|larger|size|scale|move|left|right)\b/.test(t) || /\b(different|another|new|change|simpler|replace)\b/.test(t);
}

interface Icon {
  png: Buffer;
  width: number;
  height: number;
}

async function iconFromPng(png: Buffer): Promise<Icon> {
  const sharp = await loadSharp();
  const meta = await sharp(png).metadata();
  return { png, width: meta.width ?? 1, height: meta.height ?? 1 };
}

export async function runLogoGeneration(id: string, deps: LogoRunnerDeps, opts: RunOptions = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const clean = deps.clean ?? cleanLogo;
  const compose = deps.compose ?? composeLockup;
  const { db } = deps;

  const { data: row } = await db.from(LOGO_TABLE).select("*").eq("id", id).maybeSingle();
  const gen = row as LogoGeneration | null;
  if (!gen || gen.status !== "running") return;

  let candidates: LogoCandidate[] = [];
  let concepts: LogoConcept[] = [];
  const notes: string[] = [];
  let pictures = 0;
  let cancelled = false;

  // Writes go one at a time, in order; each carries the whole state.
  let chain: Promise<void> = Promise.resolve();
  const save = (patch: Record<string, unknown>) => {
    chain = chain.then(async () => {
      if (cancelled) return;
      const at = now().toISOString();
      const { data, error } = await db
        .from(LOGO_TABLE)
        .update({ ...patch, images_drawn: pictures, heartbeat_at: at, updated_at: at })
        .eq("id", id)
        .eq("status", "running")
        .select("id");
      if (error) console.error(`[logos] ${id}: ${error.message}`);
      else if (!data?.length) cancelled = true; // Cancelled (or expired) meanwhile.
    });
    return chain;
  };
  // A drawing can take minutes (MiniMax retries); a heartbeat meanwhile keeps
  // the round from looking dead to the stale sweep (store.ts LOGO_STALE_MS).
  const beat = setInterval(() => void save({}), HEARTBEAT_MS);

  try {
    const { data: leadRow } = await db.from("leads").select(LEAD_COLUMNS).eq("id", gen.lead_id).maybeSingle();
    if (!leadRow) throw new Error("The lead is gone.");
    const brief: LogoBrief = logoBrief(leadRow as LeadForBrief, gen.logo_text);

    // The design a refine starts from, and its symbol if it has a reusable one.
    let base: LogoConcept | null = null;
    let baseCand: LogoCandidate | null = null;
    if (gen.mode === "refine" && gen.parent_id != null && gen.parent_index != null) {
      const { data: parent } = await db.from(LOGO_TABLE).select("concepts, candidates").eq("id", gen.parent_id).maybeSingle();
      const p = parent as Pick<LogoGeneration, "concepts" | "candidates"> | null;
      baseCand = p?.candidates?.find((c) => c.index === gen.parent_index) ?? null;
      base = baseCand ? (p?.concepts?.[baseCand.concept] ?? null) : null;
    }
    const baseV2 = base ? normalizeConcept(base as unknown as Record<string, unknown>, brief) : null;
    const baseIconPath = baseCand?.iconPath ?? null;

    // 1. Concepts
    const req: ConceptRequest = {
      // A refine whose design is gone still follows the person's words, as an idea.
      mode: base ? "refine" : gen.instructions ? "idea" : "new",
      count: ROUND_SIZE,
      instructions: gen.instructions ?? undefined,
      base,
      baseHasIcon: !!baseIconPath,
      font: opts.font ?? null,
    };
    let reply: ConceptReply = { concepts: [], icon: null };
    try {
      reply = parseConceptReply(await deps.writeConcepts(CONCEPT_SYSTEM, conceptUserPrompt(brief, req)), req.count, brief);
    } catch (e) {
      console.warn(`[logos] ${id}: concept writer failed — ${firstMessage(e)}`);
    }
    concepts = reply.concepts;
    if (concepts.length < req.count) {
      if (!concepts.length) notes.push("SED AI couldn't write the design ideas, so standard layouts were used.");
      concepts = [...concepts, ...fallbackConcepts(brief, { ...req, base: baseV2 }).slice(concepts.length)].slice(0, req.count);
    }
    if (opts.font) concepts = concepts.map((c) => ({ ...c, font: opts.font! }));
    const keepIcon = !!baseIconPath && (reply.icon === "keep" || (reply.icon === null && !wantsNewIcon(gen.instructions)));
    await save({ concepts, notes, stage: "drawing" });
    if (cancelled) return;

    // The symbol being kept, read once.
    let keptIcon: Icon | null = null;
    if (keepIcon && baseIconPath) {
      try {
        keptIcon = await iconFromPng(await deps.storage.get(baseIconPath));
      } catch (e) {
        console.warn(`[logos] ${id}: couldn't read the kept symbol — ${firstMessage(e)}`);
      }
    }

    // 2. Symbols + lettering, one design at a time each, all four together.
    let nextIndex = 0;
    const drawErrors: string[] = [];

    /** Draw, clean and check one symbol; once more when it came out with writing or a busy background. */
    const drawIcon = async (c: LogoConcept, index: number, firstSeed: number) => {
      let last: { icon: Icon; path: string; url: string; check: IconReading | null; seed: number; prompt: string } | null = null;
      for (let attempt = 0; attempt < 2 && pictures < IMAGES_PER_ROUND_MAX; attempt++) {
        if (cancelled) return null;
        const seed = attempt === 0 ? firstSeed : newSeed(random);
        const prompt = iconPrompt(brief, c, { strict: attempt > 0 });
        pictures++;
        let cleaned: CleanLogo;
        try {
          cleaned = await clean(await deps.draw(prompt, seed), conceptColors(brief, c));
        } catch (e) {
          drawErrors.push(firstMessage(e));
          continue;
        }
        if (cleaned.background !== "removed") continue; // not a clean symbol on white — draw again
        if (cancelled) return null;
        const path = `lead-logos/${gen.lead_id}/${gen.id}/symbol-${index + 1}${attempt ? "-b" : ""}.png`;
        const url = await deps.storage.put(path, cleaned.png);
        let check: IconReading | null = null;
        if (deps.readLogo) {
          try {
            check = parseIconReading(await deps.readLogo(ICON_CHECK_SYSTEM, iconCheckPrompt(), url));
          } catch (e) {
            console.warn(`[logos] ${id}: symbol check failed — ${firstMessage(e)}`);
          }
        }
        last = { icon: { png: cleaned.png, width: cleaned.width, height: cleaned.height }, path, url, check, seed, prompt };
        if (!check?.text) break; // clean — keep it
      }
      return last;
    };

    const designOne = async (concept: LogoConcept, i: number) => {
      if (cancelled) return;
      let c = concept;
      let icon: Icon | null = null;
      let iconPath: string | null = null;
      let iconUrl: string | null = null;
      let iconCheck: IconReading | null = null;
      let seed = 0;
      let prompt = "";
      if (c.layout === "icon-left") {
        if (keepIcon && keptIcon && baseCand) {
          icon = keptIcon;
          iconPath = baseCand.iconPath ?? null;
          iconUrl = baseCand.iconUrl ?? null;
          iconCheck = baseCand.iconCheck ?? null;
          seed = baseCand.seed;
          prompt = baseCand.prompt;
        } else {
          const firstSeed = base && baseCand?.seed && i === 0 ? baseCand.seed : newSeed(random);
          const got = await drawIcon(c, i, firstSeed);
          if (cancelled) return;
          if (got) {
            ({ icon, path: iconPath, url: iconUrl, check: iconCheck, seed, prompt } = got);
          } else {
            c = { ...c, layout: "badge-left" }; // no usable symbol: the initials in a badge instead
          }
        }
      }
      const lockup = await compose({
        layout: c.layout,
        lines: c.lines,
        font: c.font,
        letterCase: c.letterCase,
        tracking: c.tracking,
        nameColor: c.nameColor,
        subColor: c.subColor,
        twoTone: c.twoTone,
        icon,
        iconScale: c.iconScale,
        badge: { shape: c.badge, color: c.subColor !== c.nameColor ? c.subColor : c.nameColor, initials: initialsFor(brief.logoText) },
      });
      if (cancelled) return;
      const index = nextIndex++;
      const path = `lead-logos/${gen.lead_id}/${gen.id}/${index + 1}.png`;
      const url = await deps.storage.put(path, lockup.png);
      const aspect = Math.round((lockup.width / lockup.height) * 100) / 100;
      const cand: LogoCandidate = {
        index,
        concept: i,
        seed,
        round: 1,
        prompt,
        path,
        url,
        width: lockup.width,
        height: lockup.height,
        aspect,
        horizontal: aspect >= 1.7,
        transparent: true,
        background: "removed",
        colors: { present: [...new Set([c.nameColor, c.subColor])], missing: [], offPalette: 0, dominant: [] },
        check: { verdict: "exact", read: c.lines.map((l, k) => applyCase(l, k === 0 ? c.letterCase : "upper")).join(" "), extra: [], issues: iconCheck?.issues ?? [], quality: iconCheck?.quality ?? null },
        score: designScore({ hasIcon: !!icon, check: iconCheck }),
        typeset: true,
        font: c.font,
        layout: c.layout,
        iconPath,
        iconUrl,
        iconCheck,
      };
      if (c !== concept) concepts = concepts.map((x, k) => (k === i ? c : x));
      candidates = [...candidates, cand];
      await save({ candidates, concepts });
    };

    await Promise.all(
      concepts.map((c, i) =>
        designOne(c, i).catch((e) => {
          drawErrors.push(firstMessage(e));
        }),
      ),
    );
    if (cancelled) return;
    if (!candidates.length) throw new Error(drawErrors[0] ?? "No design could be made. Try again.");

    // 3. Done
    const badgeSwaps = concepts.filter((c, i) => c.layout === "badge-left" && reply.concepts[i]?.layout === "icon-left").length;
    if (drawErrors.length) notes.push(`MiniMax couldn't draw ${drawErrors.length === 1 ? "a symbol" : "some symbols"} (${drawErrors[0]})${badgeSwaps ? " — those designs use a badge with the initials instead" : ""}.`);
    if (candidates.some((c) => c.iconCheck?.text)) notes.push("A symbol may still have letter-like marks in it — it's marked and sorted last.");
    await save({ candidates, concepts, notes, stage: null, status: "ready", finished_at: now().toISOString() });
  } catch (e) {
    const message = firstMessage(e);
    console.error(`[logos] ${id}: ${message}`);
    await save({ candidates, notes, stage: null, status: candidates.length ? "ready" : "failed", error: candidates.length ? null : message, finished_at: now().toISOString() });
  } finally {
    clearInterval(beat);
  }
  await chain;
}
