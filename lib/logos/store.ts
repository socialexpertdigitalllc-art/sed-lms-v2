import type { SupabaseClient } from "@supabase/supabase-js";
import type { SpellingVerdict } from "./check";
import type { ColorReport } from "./cleanup";
import type { GenerationMode, LogoConcept } from "./prompt";

/**
 * lead_logo_generations (migration 0093): one row per press of Generate /
 * Retry. The row is the job — the runner (runner.ts) writes the designs into
 * it as they are drawn, and the lead page polls it.
 */

export const LOGO_TABLE = "lead_logo_generations";
/** A running generation that hasn't written for this long died with the server. */
export const LOGO_STALE_MS = 5 * 60_000;
/** Per person, per rolling hour. */
export const LOGO_HOURLY_LIMIT = 15;
/** Per lead, per rolling day. */
export const LOGO_DAILY_LEAD_LIMIT = 40;
/**
 * Designs the whole company may draw per day (UTC). The MiniMax Max plan
 * allows about 120 image-01 pictures a day; keeping some back means one busy
 * afternoon can't leave the plan empty. LOGO_DAILY_IMAGE_BUDGET overrides it.
 */
export const DEFAULT_DAILY_IMAGE_BUDGET = 100;
export function dailyImageBudget(): number {
  const n = Number(process.env.LOGO_DAILY_IMAGE_BUDGET);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_IMAGE_BUDGET;
}
/** At most this many designs per round (a first round of 4, and 4 more when the spelling was off). */
export const IMAGES_PER_ROUND_MAX = 8;

export type GenerationStatus = "running" | "ready" | "failed" | "cancelled";
export type GenerationStage = "concepts" | "drawing" | "checking" | "redrawing" | "finishing";

export interface CandidateCheck {
  verdict: SpellingVerdict;
  /** What the logo says, as read back. */
  read: string;
  extra: string[];
  issues: string[];
  quality: number | null;
}

export interface LogoCandidate {
  /** Stable within its generation (the Accept / Refine reference). */
  index: number;
  /** Index into the generation's concepts. */
  concept: number;
  seed: number;
  round: 1 | 2;
  prompt: string;
  /** Storage path in the branding bucket. */
  path: string;
  url: string;
  width: number;
  height: number;
  aspect: number;
  horizontal: boolean;
  transparent: boolean;
  background: "removed" | "busy" | "dark";
  colors: ColorReport;
  check: CandidateCheck | null;
  score: number;
}

export interface LogoGeneration {
  id: string;
  lead_id: string;
  user_id: string;
  mode: GenerationMode;
  parent_id: string | null;
  parent_index: number | null;
  instructions: string | null;
  logo_text: string;
  status: GenerationStatus;
  stage: GenerationStage | null;
  concepts: LogoConcept[];
  candidates: LogoCandidate[];
  notes: string[];
  images_drawn?: number;
  error: string | null;
  accepted_index: number | null;
  accepted_url: string | null;
  accepted_at: string | null;
  heartbeat_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

type Db = SupabaseClient;

/** The table isn't there yet: migration 0093 hasn't been applied. */
export function isLogoTableMissing(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e ?? "");
  return /lead_logo_generations/.test(msg) && /(does not exist|schema cache|could not find)/i.test(msg);
}

export const LOGO_MIGRATION_MESSAGE = "The logo generator isn't set up yet. An admin needs to apply migration 0093_lead_logo_generations.sql.";

export class LogoError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function fail(error: { message: string } | null): void {
  if (!error) return;
  if (isLogoTableMissing(error)) throw new LogoError(LOGO_MIGRATION_MESSAGE, 503);
  throw new Error(error.message);
}

/** A running row that stopped sending heartbeats is shown (and stored) as failed. */
export function isStale(row: Pick<LogoGeneration, "status" | "heartbeat_at" | "created_at">, now: number): boolean {
  if (row.status !== "running") return false;
  const last = Date.parse(row.heartbeat_at ?? row.created_at);
  return Number.isFinite(last) && now - last > LOGO_STALE_MS;
}

export const STALE_MESSAGE = "It stopped part-way (the server restarted). Try again.";

/** Mark this lead's dead runs failed, so they neither block nor spin forever. */
export async function expireStale(db: Db, leadId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - LOGO_STALE_MS).toISOString();
  const { error } = await db
    .from(LOGO_TABLE)
    .update({ status: "failed", stage: null, error: STALE_MESSAGE, finished_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("lead_id", leadId)
    .eq("status", "running")
    .lt("heartbeat_at", cutoff);
  fail(error);
}

export async function listGenerations(db: Db, leadId: string, now = new Date(), limit = 12): Promise<LogoGeneration[]> {
  await expireStale(db, leadId, now);
  const { data, error } = await db.from(LOGO_TABLE).select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(limit);
  fail(error);
  return (data ?? []) as LogoGeneration[];
}

export async function getGeneration(db: Db, leadId: string, id: string): Promise<LogoGeneration | null> {
  const { data, error } = await db.from(LOGO_TABLE).select("*").eq("id", id).eq("lead_id", leadId).maybeSingle();
  fail(error);
  return (data as LogoGeneration | null) ?? null;
}

/** Why this person can't start another one right now, or null. */
export async function rateLimitReason(db: Db, userId: string, leadId: string, now: Date): Promise<string | null> {
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const [mine, lead] = await Promise.all([
    db.from(LOGO_TABLE).select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", hourAgo),
    db.from(LOGO_TABLE).select("id", { count: "exact", head: true }).eq("lead_id", leadId).gte("created_at", dayAgo),
  ]);
  fail(mine.error);
  fail(lead.error);
  if ((mine.count ?? 0) >= LOGO_HOURLY_LIMIT) return `That's ${LOGO_HOURLY_LIMIT} logo rounds in the last hour — the most one person can run. Try again a little later.`;
  if ((lead.count ?? 0) >= LOGO_DAILY_LEAD_LIMIT) return `This lead has had ${LOGO_DAILY_LEAD_LIMIT} logo rounds today. Pick from the earlier tries, or try again tomorrow.`;
  return null;
}

/** Designs the company has drawn today (UTC). */
export async function imagesUsedToday(db: Db, now: Date): Promise<number> {
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { data, error } = await db.from(LOGO_TABLE).select("images_drawn, status").gte("created_at", midnight);
  fail(error);
  // A running round may still draw up to a full round more.
  return (data ?? []).reduce((sum, r) => {
    const row = r as { images_drawn?: number | null; status?: string };
    const drawn = row.images_drawn ?? 0;
    return sum + (row.status === "running" ? Math.max(drawn, 4) : drawn);
  }, 0);
}

export function budgetMessage(limit: number): string {
  return `Today's logo allowance is used up (${limit} designs for the whole company). It starts again at midnight UTC — meanwhile, pick from the earlier rounds.`;
}

export interface StartInput {
  leadId: string;
  userId: string;
  mode: GenerationMode;
  logoText: string;
  instructions?: string | null;
  parentId?: string | null;
  parentIndex?: number | null;
}

/** Start one — or hand back the one already running for this lead. */
export async function startGeneration(db: Db, input: StartInput, now = new Date()): Promise<{ created: boolean; row: LogoGeneration }> {
  await expireStale(db, input.leadId, now);
  const running = await db.from(LOGO_TABLE).select("*").eq("lead_id", input.leadId).eq("status", "running").maybeSingle();
  fail(running.error);
  if (running.data) return { created: false, row: running.data as LogoGeneration };
  const at = now.toISOString();
  const { data, error } = await db
    .from(LOGO_TABLE)
    .insert({
      lead_id: input.leadId,
      user_id: input.userId,
      mode: input.mode,
      logo_text: input.logoText,
      instructions: input.instructions?.trim() || null,
      parent_id: input.parentId ?? null,
      parent_index: input.parentIndex ?? null,
      status: "running",
      stage: "concepts",
      heartbeat_at: at,
      created_at: at,
      updated_at: at,
    })
    .select("*")
    .single();
  if (error && /duplicate key|23505|one_running/i.test(error.message)) {
    // Someone started one a moment ago — show theirs.
    const again = await db.from(LOGO_TABLE).select("*").eq("lead_id", input.leadId).eq("status", "running").maybeSingle();
    if (again.data) return { created: false, row: again.data as LogoGeneration };
  }
  fail(error);
  return { created: true, row: data as LogoGeneration };
}

export async function cancelGeneration(db: Db, leadId: string, id: string, now = new Date()): Promise<LogoGeneration | null> {
  const { data, error } = await db
    .from(LOGO_TABLE)
    .update({ status: "cancelled", stage: null, finished_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", id)
    .eq("lead_id", leadId)
    .eq("status", "running")
    .select("*")
    .maybeSingle();
  fail(error);
  return (data as LogoGeneration | null) ?? null;
}

/** A design as the lead page sees it (no storage path, no prompt). PURE. */
export function candidateView(c: LogoCandidate) {
  return {
    index: c.index,
    concept: c.concept,
    round: c.round,
    url: c.url,
    width: c.width,
    height: c.height,
    aspect: c.aspect,
    horizontal: c.horizontal,
    transparent: c.transparent,
    background: c.background,
    colors: c.colors,
    check: c.check,
    score: c.score,
  };
}

/** What the lead page gets: the row without the storage paths, dead runs shown as failed. PURE. */
export function generationView(row: LogoGeneration, now = Date.now()) {
  const stale = isStale(row, now);
  return {
    id: row.id,
    mode: row.mode,
    parentId: row.parent_id,
    parentIndex: row.parent_index,
    instructions: row.instructions,
    logoText: row.logo_text,
    status: stale ? ("failed" as const) : row.status,
    stage: stale ? null : row.stage,
    concepts: row.concepts ?? [],
    candidates: [...(row.candidates ?? [])].sort((a, b) => b.score - a.score || a.index - b.index).map(candidateView),
    notes: row.notes ?? [],
    error: stale ? STALE_MESSAGE : row.error,
    acceptedIndex: row.accepted_index,
    acceptedUrl: row.accepted_url,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    userId: row.user_id,
  };
}

export type LogoGenerationView = ReturnType<typeof generationView>;
export type LogoCandidateView = LogoGenerationView["candidates"][number];
