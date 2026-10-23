import type { SupabaseClient } from "@supabase/supabase-js";
import { logoBrief, type BrandColor, type LeadForBrief, type LogoBrief } from "./brief";
import {
  artScore,
  designScore,
  iconCheckPrompt,
  ICON_CHECK_SYSTEM,
  judgeSpelling,
  parseIconReading,
  parseReading,
  spellCheckPrompt,
  SPELL_CHECK_SYSTEM,
  type IconReading,
  type LogoReading,
  type Spelling,
} from "./check";
import { cleanLogo, flattenOnWhite, loadSharp, type CleanLogo } from "./cleanup";
import { composeLockup, initialsFor, type LockupInput } from "./compose";
import {
  ART_CONCEPT_SYSTEM,
  artConceptPrompt,
  artImagePrompt,
  fallbackArtConcepts,
  fixLetteringPrompt,
  parseArtConcepts,
  refineArtPrompt,
  type ArtConcept,
} from "./artPrompt";
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
 * One logo round, start to finish, with nobody waiting on the request. Two
 * designers:
 *
 * GOOGLE (default when the Gemini key is set up) — complete logos:
 *   concepts → a creative director (the concept writer) briefs four
 *              agency-grade logos in different styles (artPrompt.ts);
 *   drawing  → Google's Nano Banana Pro draws each logo WHOLE — graphic and
 *              name — on white; it is cleaned (background removed), its
 *              lettering read back by a vision model and compared with the
 *              name in code; a wrong one goes back to Google to fix just the
 *              lettering (up to twice); one still wrong is flagged, last.
 *   A change ("refine") is an EDIT of the chosen picture itself — the same
 *   logo, changed as asked.
 *
 * MINIMAX — typeset designs: MiniMax draws only a symbol, the name is set
 * beside it in a real font (compose.ts) — spelling guaranteed. Also what a
 * Google round falls back to when Google can't design at all.
 *
 * Every write is guarded by status = running, so Stop (or the stale sweep)
 * wins over a late write.
 */

export const ROUND_SIZE = 4;
const HEARTBEAT_MS = 60_000;
/** Google: 4 logos, and up to 2 lettering fixes each — but never more than this per round. */
export const ART_MAX_PICTURES = 12;
const MAX_LETTERING_FIXES = 2;

export type LogoEngine = "google" | "minimax";

export interface LogoStorage {
  /** Save a PNG; returns its public URL. */
  put(path: string, png: Buffer): Promise<string>;
  /** Read a saved PNG back (a design to edit, a symbol to reuse). */
  get(path: string): Promise<Buffer>;
}

export interface LogoRunnerDeps {
  db: SupabaseClient;
  storage: LogoStorage;
  /** The concept writer (text model): system + user prompt → reply text. */
  writeConcepts(system: string, user: string): Promise<string>;
  /** The checker (vision model): one image URL → reply text. Null when none is set up. */
  readLogo: ((system: string, user: string, imageUrl: string) => Promise<string>) | null;
  /** MiniMax image-01: a square symbol. Null when MiniMax isn't set up. */
  draw: ((prompt: string, seed: number) => Promise<Buffer>) | null;
  /** Google's image model: a new logo, or an edit of `image`. Null when Gemini isn't set up. */
  art?: ((prompt: string, image?: Buffer | null) => Promise<{ png: Buffer; model: string }>) | null;
  clean?: (img: Buffer, brand: BrandColor[]) => Promise<CleanLogo>;
  compose?: (input: LockupInput) => Promise<{ png: Buffer; width: number; height: number }>;
  flatten?: (png: Buffer) => Promise<Buffer>;
  now?: () => Date;
  random?: () => number;
}

export interface RunOptions {
  /** A font the person picked in Retry: every design uses it. */
  font?: string | null;
  /** Which designer; defaults to Google when it is set up. */
  engine?: LogoEngine | null;
}

/** The designer a round uses: the one asked for if it is set up, else Google, else MiniMax. PURE. */
export function pickEngine(asked: LogoEngine | null | undefined, deps: Pick<LogoRunnerDeps, "art" | "draw">): LogoEngine {
  if (asked === "minimax" && deps.draw) return "minimax";
  if (asked === "google" && deps.art) return "google";
  return deps.art ? "google" : "minimax";
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

/** What a round's two designers share: the job, the state, and the guarded writer. */
interface Round {
  id: string;
  gen: LogoGeneration;
  brief: LogoBrief;
  deps: LogoRunnerDeps;
  opts: RunOptions;
  base: LogoConcept | null;
  baseCand: LogoCandidate | null;
  candidates: LogoCandidate[];
  concepts: LogoConcept[];
  notes: string[];
  pictures: number;
  cancelled: boolean;
  nextIndex: number;
  save(patch: Record<string, unknown>): Promise<void>;
  now(): Date;
  random(): number;
}

export async function runLogoGeneration(id: string, deps: LogoRunnerDeps, opts: RunOptions = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;

  const { data: row } = await db.from(LOGO_TABLE).select("*").eq("id", id).maybeSingle();
  const gen = row as LogoGeneration | null;
  if (!gen || gen.status !== "running") return;

  // Writes go one at a time, in order; each carries the whole state.
  let chain: Promise<void> = Promise.resolve();
  const r: Round = {
    id,
    gen,
    brief: null as unknown as LogoBrief,
    deps,
    opts,
    base: null,
    baseCand: null,
    candidates: [],
    concepts: [],
    notes: [],
    pictures: 0,
    cancelled: false,
    nextIndex: 0,
    now,
    random: deps.random ?? Math.random,
    save: (patch) => {
      chain = chain.then(async () => {
        if (r.cancelled) return;
        const at = now().toISOString();
        const { data, error } = await db
          .from(LOGO_TABLE)
          .update({ ...patch, images_drawn: r.pictures, heartbeat_at: at, updated_at: at })
          .eq("id", id)
          .eq("status", "running")
          .select("id");
        if (error) console.error(`[logos] ${id}: ${error.message}`);
        else if (!data?.length) r.cancelled = true; // Cancelled (or expired) meanwhile.
      });
      return chain;
    },
  };
  // A drawing can take minutes; a heartbeat meanwhile keeps the round from
  // looking dead to the stale sweep (store.ts LOGO_STALE_MS).
  const beat = setInterval(() => void r.save({}), HEARTBEAT_MS);

  try {
    const { data: leadRow } = await db.from("leads").select(LEAD_COLUMNS).eq("id", gen.lead_id).maybeSingle();
    if (!leadRow) throw new Error("The lead is gone.");
    r.brief = logoBrief(leadRow as LeadForBrief, gen.logo_text);

    // The design a refine starts from.
    if (gen.mode === "refine" && gen.parent_id != null && gen.parent_index != null) {
      const { data: parent } = await db.from(LOGO_TABLE).select("concepts, candidates").eq("id", gen.parent_id).maybeSingle();
      const p = parent as Pick<LogoGeneration, "concepts" | "candidates"> | null;
      r.baseCand = p?.candidates?.find((c) => c.index === gen.parent_index) ?? null;
      r.base = r.baseCand ? (p?.concepts?.[r.baseCand.concept] ?? null) : null;
    }

    if (pickEngine(opts.engine, deps) === "google") {
      let googleError: unknown = null;
      try {
        await artRound(r);
      } catch (e) {
        googleError = e;
      }
      if (r.cancelled) return;
      if (!r.candidates.length) {
        if (!deps.draw) throw googleError ?? new Error("Google couldn't design this round. Try again.");
        // Google can't design at all (key, billing, quota…): MiniMax makes the round instead.
        r.notes.push(`Google couldn't design these logos (${firstMessage(googleError ?? "no design came back")}) — they were made with MiniMax instead.`);
        r.concepts = [];
        r.pictures = 0;
        await typesetRound(r);
      }
    } else {
      await typesetRound(r);
    }
    if (r.cancelled) return;
    await r.save({ candidates: r.candidates, concepts: r.concepts, notes: r.notes, stage: null, status: "ready", finished_at: now().toISOString() });
  } catch (e) {
    const message = firstMessage(e);
    console.error(`[logos] ${id}: ${message}`);
    await r.save({ candidates: r.candidates, notes: r.notes, stage: null, status: r.candidates.length ? "ready" : "failed", error: r.candidates.length ? null : message, finished_at: now().toISOString() });
  } finally {
    clearInterval(beat);
  }
  await chain;
}

/* ---------------------------------------------------------- Google ---- */

/** An art concept, stored in the round's concepts (the page reads title and idea). */
function storedArtConcept(c: ArtConcept, b: LogoBrief): LogoConcept {
  return {
    ...normalizeConcept({ title: c.title, idea: c.idea, layout: "icon-left", symbol: c.brief.slice(0, 200), lines: [b.logoText] }, b),
    style: c.style,
    brief: c.brief,
    typography: c.typography,
  };
}

async function artRound(r: Round): Promise<void> {
  const { brief, deps, gen } = r;
  const art = deps.art!;
  const clean = deps.clean ?? cleanLogo;
  const flatten = deps.flatten ?? flattenOnWhite;
  const errors: string[] = [];

  // What to draw: four new logos — or four versions of the chosen one, edited.
  let jobs: { concept: number; prompt: string; image: Buffer | null }[];
  if (r.baseCand) {
    const original = await flatten(await deps.storage.get(r.baseCand.path));
    const said = gen.instructions ?? "";
    r.concepts = [{ ...normalizeConcept({ title: r.base?.title ? `${r.base.title} — changed` : "Your design, changed", idea: said, layout: "icon-left", symbol: said, lines: [brief.logoText] }, brief), style: r.base?.style, brief: said }];
    jobs = Array.from({ length: ROUND_SIZE }, (_, k) => ({ concept: 0, prompt: refineArtPrompt(brief, said, k, { font: r.opts.font }), image: original }));
  } else {
    let concepts: ArtConcept[] = [];
    try {
      concepts = parseArtConcepts(await deps.writeConcepts(ART_CONCEPT_SYSTEM, artConceptPrompt(brief, { count: ROUND_SIZE, instructions: gen.instructions ?? undefined, font: r.opts.font })), ROUND_SIZE);
    } catch (e) {
      console.warn(`[logos] ${r.id}: concept writer failed — ${firstMessage(e)}`);
    }
    if (concepts.length < ROUND_SIZE) {
      if (!concepts.length) r.notes.push("SED AI couldn't write the design briefs, so standard briefs were used.");
      concepts = [...concepts, ...fallbackArtConcepts(brief, { count: ROUND_SIZE, instructions: gen.instructions ?? undefined }).slice(concepts.length)].slice(0, ROUND_SIZE);
    }
    r.concepts = concepts.map((c) => storedArtConcept(c, brief));
    jobs = concepts.map((c, i) => ({ concept: i, prompt: artImagePrompt(brief, c, { font: r.opts.font }), image: null }));
  }
  await r.save({ concepts: r.concepts, notes: r.notes, stage: "drawing" });
  if (r.cancelled) return;

  const ink = brief.colors;
  const design = async (job: (typeof jobs)[number], n: number) => {
    let prompt = job.prompt;
    let image = job.image;
    let model = "";
    let fixes = -1;
    let best: { cleaned: CleanLogo; path: string; url: string; spelling: Spelling; reading: LogoReading | null } | null = null;
    for (let pass = 0; pass <= MAX_LETTERING_FIXES; pass++) {
      if (r.cancelled || r.pictures >= ART_MAX_PICTURES) break;
      r.pictures++;
      const out = await art(prompt, image);
      if (r.cancelled) return;
      model = out.model;
      const cleaned = await clean(out.png, ink);
      const path = `lead-logos/${gen.lead_id}/${gen.id}/${n + 1}${pass ? `-fix${pass}` : ""}.png`;
      const url = await deps.storage.put(path, cleaned.png);
      let reading: LogoReading | null = null;
      if (deps.readLogo) {
        try {
          reading = parseReading(await deps.readLogo(SPELL_CHECK_SYSTEM, spellCheckPrompt(), url));
        } catch (e) {
          console.warn(`[logos] ${r.id}: spelling check failed — ${firstMessage(e)}`);
        }
      }
      const spelling = judgeSpelling(reading, brief.logoText);
      fixes = pass;
      best = { cleaned, path, url, spelling, reading };
      if (spelling.verdict === "exact" || spelling.verdict === "unchecked") break;
      // Wrong lettering: Google fixes just the lettering, on the picture it drew.
      prompt = fixLetteringPrompt(brief, spelling.read);
      image = out.png;
    }
    if (!best || r.cancelled) return;
    const c = best.cleaned;
    const index = r.nextIndex++;
    const cand: LogoCandidate = {
      index,
      concept: job.concept,
      seed: 0,
      round: 1,
      prompt: job.prompt,
      path: best.path,
      url: best.url,
      width: c.width,
      height: c.height,
      aspect: c.aspect,
      horizontal: c.horizontal,
      transparent: c.transparent,
      background: c.background,
      colors: c.colors,
      check: { ...best.spelling, issues: best.reading?.issues ?? [], quality: best.reading?.quality ?? null },
      score: artScore({ spelling: best.spelling.verdict, quality: best.reading?.quality ?? null, horizontal: c.horizontal }),
      typeset: false,
      engine: "google",
      model,
      fixes: Math.max(0, fixes),
    };
    r.candidates = [...r.candidates, cand];
    await r.save({ candidates: r.candidates });
  };

  await Promise.all(jobs.map((job, n) => design(job, n).catch((e) => void errors.push(firstMessage(e)))));
  if (r.cancelled) return;
  if (!r.candidates.length) throw new Error(errors[0] ?? "Google didn't draw anything. Try again.");
  if (errors.length) r.notes.push(`${errors.length} design${errors.length === 1 ? "" : "s"} couldn't be drawn (${errors[0]}).`);
  const fixed = r.candidates.filter((c) => (c.fixes ?? 0) > 0 && c.check?.verdict === "exact").length;
  if (fixed) r.notes.push(`${fixed} design${fixed === 1 ? "" : "s"} came out misspelled and ${fixed === 1 ? "was" : "were"} corrected automatically.`);
  if (r.candidates.some((c) => c.check?.verdict === "misspelled" || c.check?.verdict === "extra")) r.notes.push("A design still has wrong lettering after two fixes — it's marked and sorted last. Retry → Change this design can fix it.");
  if (r.candidates.every((c) => c.check?.verdict === "unchecked")) r.notes.push("The spelling couldn't be checked this time — read each design before accepting.");
}

/* --------------------------------------------------------- MiniMax ---- */

async function typesetRound(r: Round): Promise<void> {
  const { brief, deps, gen } = r;
  if (!deps.draw) throw new Error("MiniMax isn't set up — an admin needs to add its API key under Admin → AI providers.");
  const draw = deps.draw;
  const clean = deps.clean ?? cleanLogo;
  const compose = deps.compose ?? composeLockup;
  const base = r.base;
  const baseCand = r.baseCand;
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
    font: r.opts.font ?? null,
  };
  let reply: ConceptReply = { concepts: [], icon: null };
  try {
    reply = parseConceptReply(await deps.writeConcepts(CONCEPT_SYSTEM, conceptUserPrompt(brief, req)), req.count, brief);
  } catch (e) {
    console.warn(`[logos] ${r.id}: concept writer failed — ${firstMessage(e)}`);
  }
  let concepts = reply.concepts;
  if (concepts.length < req.count) {
    if (!concepts.length) r.notes.push("SED AI couldn't write the design ideas, so standard layouts were used.");
    concepts = [...concepts, ...fallbackConcepts(brief, { ...req, base: baseV2 }).slice(concepts.length)].slice(0, req.count);
  }
  if (r.opts.font) concepts = concepts.map((c) => ({ ...c, font: r.opts.font! }));
  r.concepts = concepts;
  const keepIcon = !!baseIconPath && (reply.icon === "keep" || (reply.icon === null && !wantsNewIcon(gen.instructions)));
  await r.save({ concepts: r.concepts, notes: r.notes, stage: "drawing" });
  if (r.cancelled) return;

  // The symbol being kept, read once.
  let keptIcon: Icon | null = null;
  if (keepIcon && baseIconPath) {
    try {
      keptIcon = await iconFromPng(await deps.storage.get(baseIconPath));
    } catch (e) {
      console.warn(`[logos] ${r.id}: couldn't read the kept symbol — ${firstMessage(e)}`);
    }
  }

  // 2. Symbols + lettering, one design at a time each, all four together.
  const drawErrors: string[] = [];

  /** Draw, clean and check one symbol; once more when it came out with writing or a busy background. */
  const drawIcon = async (c: LogoConcept, index: number, firstSeed: number) => {
    let last: { icon: Icon; path: string; url: string; check: IconReading | null; seed: number; prompt: string } | null = null;
    for (let attempt = 0; attempt < 2 && r.pictures < IMAGES_PER_ROUND_MAX; attempt++) {
      if (r.cancelled) return null;
      const seed = attempt === 0 ? firstSeed : newSeed(r.random);
      const prompt = iconPrompt(brief, c, { strict: attempt > 0 });
      r.pictures++;
      let cleaned: CleanLogo;
      try {
        cleaned = await clean(await draw(prompt, seed), conceptColors(brief, c));
      } catch (e) {
        drawErrors.push(firstMessage(e));
        continue;
      }
      if (cleaned.background !== "removed") continue; // not a clean symbol on white — draw again
      if (r.cancelled) return null;
      const path = `lead-logos/${gen.lead_id}/${gen.id}/symbol-${index + 1}${attempt ? "-b" : ""}.png`;
      const url = await deps.storage.put(path, cleaned.png);
      let check: IconReading | null = null;
      if (deps.readLogo) {
        try {
          check = parseIconReading(await deps.readLogo(ICON_CHECK_SYSTEM, iconCheckPrompt(), url));
        } catch (e) {
          console.warn(`[logos] ${r.id}: symbol check failed — ${firstMessage(e)}`);
        }
      }
      last = { icon: { png: cleaned.png, width: cleaned.width, height: cleaned.height }, path, url, check, seed, prompt };
      if (!check?.text) break; // clean — keep it
    }
    return last;
  };

  const designOne = async (concept: LogoConcept, i: number) => {
    if (r.cancelled) return;
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
        const firstSeed = base && baseCand?.seed && i === 0 ? baseCand.seed : newSeed(r.random);
        const got = await drawIcon(c, i, firstSeed);
        if (r.cancelled) return;
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
    if (r.cancelled) return;
    const index = r.nextIndex++;
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
      engine: "minimax",
      font: c.font,
      layout: c.layout,
      iconPath,
      iconUrl,
      iconCheck,
    };
    if (c !== concept) r.concepts = r.concepts.map((x, k) => (k === i ? c : x));
    r.candidates = [...r.candidates, cand];
    await r.save({ candidates: r.candidates, concepts: r.concepts });
  };

  await Promise.all(r.concepts.map((c, i) => designOne(c, i).catch((e) => void drawErrors.push(firstMessage(e)))));
  if (r.cancelled) return;
  if (!r.candidates.length) throw new Error(drawErrors[0] ?? "No design could be made. Try again.");

  const badgeSwaps = r.concepts.filter((c, i) => c.layout === "badge-left" && reply.concepts[i]?.layout === "icon-left").length;
  if (drawErrors.length) r.notes.push(`MiniMax couldn't draw ${drawErrors.length === 1 ? "a symbol" : "some symbols"} (${drawErrors[0]})${badgeSwaps ? " — those designs use a badge with the initials instead" : ""}.`);
  if (r.candidates.some((c) => c.iconCheck?.text)) r.notes.push("A symbol may still have letter-like marks in it — it's marked and sorted last.");
}
