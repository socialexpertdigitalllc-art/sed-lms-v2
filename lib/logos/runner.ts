import type { SupabaseClient } from "@supabase/supabase-js";
import { logoBrief, type BrandColor, type LeadForBrief, type LogoBrief } from "./brief";
import { checkPrompt, CHECK_SYSTEM, judgeSpelling, parseReading, rankScore } from "./check";
import { cleanLogo, type CleanLogo } from "./cleanup";
import {
  CONCEPT_SYSTEM,
  conceptColors,
  conceptUserPrompt,
  fallbackConcepts,
  imagePrompt,
  parseConcepts,
  type ConceptRequest,
  type LogoConcept,
} from "./prompt";
import { IMAGES_PER_ROUND_MAX, LOGO_TABLE, type CandidateCheck, type GenerationStage, type LogoCandidate, type LogoGeneration } from "./store";

/**
 * One logo round, start to finish, with nobody waiting on the request:
 *
 *   concepts  → a text model writes distinct design ideas (code-written ones
 *               if it is unavailable, so the button always works);
 *   drawing   → MiniMax image-01 draws each one, wide, on white; each drawing
 *               is cleaned (background removed, cropped) and saved as soon as
 *               it is done, so the page shows designs as they arrive;
 *   checking  → a vision model reads each logo back and the reading is
 *               compared with the name (check.ts);
 *   redrawing → when nothing came back spelled right, one more round with
 *               plainer lettering;
 *   ready     → the designs, best first.
 *
 * Every write is guarded by status = running, so Cancel (or the stale sweep)
 * wins over a late write.
 */

export const ROUND_SIZE = 4;
const HEARTBEAT_MS = 60_000;
export const MAX_IMAGES = IMAGES_PER_ROUND_MAX;

export interface LogoStorage {
  /** Save a PNG; returns its public URL. */
  put(path: string, png: Buffer): Promise<string>;
}

export interface LogoRunnerDeps {
  db: SupabaseClient;
  storage: LogoStorage;
  /** The concept writer (text model): system + user prompt → reply text. */
  writeConcepts(system: string, user: string): Promise<string>;
  /** The proofreader (vision model): one image URL → reply text. Null when no vision model is set up. */
  readLogo: ((system: string, user: string, imageUrl: string) => Promise<string>) | null;
  /** MiniMax image-01: prompt + seed → image bytes. */
  draw(prompt: string, seed: number): Promise<Buffer>;
  clean?: (img: Buffer, brand: BrandColor[]) => Promise<CleanLogo>;
  now?: () => Date;
  random?: () => number;
}

const LEAD_COLUMNS = "id, business_name, services, category, about_business, color_scheme";

interface Job {
  concept: number;
  seed: number;
  round: 1 | 2;
  strict: boolean;
}

const newSeed = (random: () => number) => 1 + Math.floor(random() * 2_000_000_000);

const firstMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runLogoGeneration(id: string, deps: LogoRunnerDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;
  const clean = deps.clean ?? cleanLogo;
  const { db } = deps;

  const { data: row } = await db.from(LOGO_TABLE).select("*").eq("id", id).maybeSingle();
  const gen = row as LogoGeneration | null;
  if (!gen || gen.status !== "running") return;

  let candidates: LogoCandidate[] = [];
  let concepts: LogoConcept[] = [];
  const notes: string[] = [];
  let cancelled = false;

  // Writes go one at a time, in order; each carries the whole state.
  let chain: Promise<void> = Promise.resolve();
  const save = (patch: Record<string, unknown>) => {
    chain = chain.then(async () => {
      if (cancelled) return;
      const at = now().toISOString();
      const { data, error } = await db
        .from(LOGO_TABLE)
        .update({ ...patch, ...(Array.isArray(patch.candidates) ? { images_drawn: patch.candidates.length } : {}), heartbeat_at: at, updated_at: at })
        .eq("id", id)
        .eq("status", "running")
        .select("id");
      if (error) console.error(`[logos] ${id}: ${error.message}`);
      else if (!data?.length) cancelled = true; // Cancelled (or expired) meanwhile.
    });
    return chain;
  };
  const stage = (s: GenerationStage) => save({ stage: s });
  // A drawing can take minutes (MiniMax retries); a heartbeat meanwhile keeps
  // the round from looking dead to the stale sweep (store.ts LOGO_STALE_MS).
  const beat = setInterval(() => void save({}), HEARTBEAT_MS);

  try {
    const { data: leadRow } = await db.from("leads").select(LEAD_COLUMNS).eq("id", gen.lead_id).maybeSingle();
    if (!leadRow) throw new Error("The lead is gone.");
    const brief: LogoBrief = logoBrief(leadRow as LeadForBrief, gen.logo_text);

    // The design a refine starts from.
    let base: LogoConcept | null = null;
    let baseSeed: number | null = null;
    if (gen.mode === "refine" && gen.parent_id != null && gen.parent_index != null) {
      const { data: parent } = await db.from(LOGO_TABLE).select("concepts, candidates").eq("id", gen.parent_id).maybeSingle();
      const p = parent as Pick<LogoGeneration, "concepts" | "candidates"> | null;
      const cand = p?.candidates?.find((c) => c.index === gen.parent_index);
      if (cand) {
        base = p?.concepts?.[cand.concept] ?? null;
        baseSeed = cand.seed;
      }
    }

    // 1. Concepts
    const req: ConceptRequest = {
      // A refine whose design is gone still follows the person's words, as an idea.
      mode: base ? "refine" : gen.instructions ? "idea" : "new",
      count: base ? 1 : ROUND_SIZE,
      instructions: gen.instructions ?? undefined,
      base,
    };
    try {
      concepts = parseConcepts(await deps.writeConcepts(CONCEPT_SYSTEM, conceptUserPrompt(brief, req)), req.count);
    } catch (e) {
      console.warn(`[logos] ${id}: concept writer failed — ${firstMessage(e)}`);
    }
    if (concepts.length < req.count) {
      if (!concepts.length) notes.push("SED AI couldn't write the design ideas, so standard layouts were used.");
      concepts = [...concepts, ...fallbackConcepts(brief, req).slice(concepts.length)].slice(0, req.count);
    }
    await save({ concepts, notes, stage: "drawing" });
    if (cancelled) return;

    // 2. Drawing
    let nextIndex = 0;
    const drawErrors: string[] = [];
    const drawOne = async (job: Job) => {
      if (cancelled) return;
      const concept = concepts[job.concept];
      const prompt = imagePrompt(brief, concept, { strict: job.strict });
      try {
        const img = await deps.draw(prompt, job.seed);
        if (cancelled) return;
        const cleaned = await clean(img, conceptColors(brief, concept));
        const index = nextIndex++;
        const path = `lead-logos/${gen.lead_id}/${gen.id}/${index + 1}.png`;
        const url = await deps.storage.put(path, cleaned.png);
        const c: LogoCandidate = {
          index,
          concept: job.concept,
          seed: job.seed,
          round: job.round,
          prompt,
          path,
          url,
          width: cleaned.width,
          height: cleaned.height,
          aspect: cleaned.aspect,
          horizontal: cleaned.horizontal,
          transparent: cleaned.transparent,
          background: cleaned.background,
          colors: cleaned.colors,
          check: null,
          score: 0,
        };
        c.score = scoreOf(c, brief, concept);
        candidates = [...candidates, c];
        await save({ candidates });
      } catch (e) {
        drawErrors.push(firstMessage(e));
      }
    };
    const firstRound: Job[] = base
      ? [baseSeed ?? newSeed(random), newSeed(random), newSeed(random), newSeed(random)].map((seed) => ({ concept: 0, seed, round: 1 as const, strict: false }))
      : concepts.map((_, i) => ({ concept: i, seed: newSeed(random), round: 1 as const, strict: false }));
    await Promise.all(firstRound.slice(0, ROUND_SIZE).map(drawOne));
    if (cancelled) return;
    if (!candidates.length) throw new Error(drawErrors[0] ?? "MiniMax didn't draw anything. Try again.");

    // 3. Checking
    const checkAll = async (list: LogoCandidate[]) => {
      if (!deps.readLogo) return;
      const read = deps.readLogo;
      await Promise.all(
        list.map(async (c) => {
          let check: CandidateCheck;
          try {
            const reading = parseReading(await read(CHECK_SYSTEM, checkPrompt(), c.url));
            const spelling = judgeSpelling(reading, brief.logoText);
            check = { ...spelling, issues: reading?.issues ?? [], quality: reading?.quality ?? null };
          } catch (e) {
            console.warn(`[logos] ${id}: check failed — ${firstMessage(e)}`);
            check = { verdict: "unchecked", read: "", extra: [], issues: [], quality: null };
          }
          if (cancelled) return;
          candidates = candidates.map((x) => (x.index === c.index ? { ...x, check, score: scoreOf({ ...x, check }, brief, concepts[x.concept]) } : x));
          await save({ candidates });
        }),
      );
    };
    if (deps.readLogo) {
      await stage("checking");
      await checkAll(candidates);
      if (cancelled) return;
      if (candidates.every((c) => !c.check || c.check.verdict === "unchecked")) {
        notes.push("The spelling couldn't be checked this time — read each one before accepting.");
        await save({ notes });
      }
    } else {
      notes.push("No vision model is set up, so the spelling wasn't checked — read each one before accepting.");
      await save({ notes });
    }

    // 4. One more round when nothing is spelled right.
    const checked = candidates.filter((c) => c.check && c.check.verdict !== "unchecked");
    const anyRight = candidates.some((c) => c.check?.verdict === "exact");
    if (checked.length && !anyRight && candidates.length < MAX_IMAGES) {
      notes.push("The first designs had spelling mistakes, so it drew more with plainer lettering.");
      await save({ notes, stage: "redrawing" });
      const before = new Set(candidates.map((c) => c.index));
      const room = Math.min(ROUND_SIZE, MAX_IMAGES - candidates.length);
      const second: Job[] = Array.from({ length: room }, (_, i) => ({ concept: base ? 0 : i % concepts.length, seed: newSeed(random), round: 2 as const, strict: true }));
      await Promise.all(second.map(drawOne));
      if (cancelled) return;
      await stage("checking");
      await checkAll(candidates.filter((c) => !before.has(c.index)));
      if (cancelled) return;
    }

    // 5. Done
    if (drawErrors.length) notes.push(`${drawErrors.length} design${drawErrors.length === 1 ? "" : "s"} couldn't be drawn (${drawErrors[0]}).`);
    await save({ candidates, notes, stage: null, status: "ready", finished_at: now().toISOString() });
  } catch (e) {
    const message = firstMessage(e);
    console.error(`[logos] ${id}: ${message}`);
    await save({ candidates, notes, stage: null, status: candidates.length ? "ready" : "failed", error: candidates.length ? null : message, finished_at: now().toISOString() });
  } finally {
    clearInterval(beat);
  }
  await chain;
}

function scoreOf(c: LogoCandidate, brief: LogoBrief, concept: LogoConcept | undefined): number {
  const ink = (concept ? conceptColors(brief, concept) : brief.colors).filter((x) => x.role !== "light");
  return rankScore({
    spelling: c.check?.verdict ?? "unchecked",
    quality: c.check?.quality ?? null,
    horizontal: c.horizontal,
    background: c.background,
    colorShare: ink.length ? c.colors.present.length / ink.length : 1,
    offPalette: c.colors.offPalette,
  });
}
