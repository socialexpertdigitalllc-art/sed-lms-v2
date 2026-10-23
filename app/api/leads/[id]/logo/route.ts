import { NextResponse, after } from "next/server";
import { z } from "zod";
import { logoAccess, logoErrorResponse } from "@/lib/logos/access";
import { logoBrief } from "@/lib/logos/brief";
import { isLogoFont } from "@/lib/logos/fontList";
import { defaultEngine, designers, NO_DESIGNER_MESSAGE, productionLogoDeps } from "@/lib/logos/deps";
import { runLogoGeneration } from "@/lib/logos/runner";
import {
  budgetMessage,
  dailyImageBudget,
  generationView,
  getGeneration,
  imagesUsedToday,
  IMAGES_PER_ROUND_MAX,
  listGenerations,
  LogoError,
  rateLimitReason,
  startGeneration,
} from "@/lib/logos/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The lead's AI logo generator (lib/logos/*).
 * GET: the rounds so far (newest first), what the generator will use, and
 * which designers are set up (Google, MiniMax).
 * POST: start a round — fresh designs, the person's own idea, or a change to
 * one design — with a designer (default: Google when set up). The work runs
 * after the response; the page polls the round.
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await logoAccess(id);
  if (!a.ok) return a.response;
  const brief = logoBrief(a.lead);
  try {
    const now = new Date();
    const [rows, used, d] = await Promise.all([listGenerations(a.admin, id, now), imagesUsedToday(a.admin, now), designers()]);
    return NextResponse.json({
      generations: rows.map((r) => generationView(r)),
      brief: { logoText: brief.logoText, trade: brief.trade, colors: brief.colors },
      budget: { used, limit: dailyImageBudget() },
      engines: { google: !!d.google, minimax: !!d.minimax, default: defaultEngine(d) },
    });
  } catch (e) {
    return logoErrorResponse(e);
  }
}

const startSchema = z
  .object({
    mode: z.enum(["new", "idea", "refine"]),
    instructions: z.string().trim().max(1000).optional(),
    logoText: z.string().trim().min(1).max(80).optional(),
    parentId: z.string().uuid().optional(),
    parentIndex: z.number().int().min(0).max(50).optional(),
    /** A font the person picked (fontList.ts); every design uses it. */
    font: z.string().refine(isLogoFont, "Unknown font").optional(),
    /** The designer: google (complete logos) or minimax (symbol + typeset name). */
    engine: z.enum(["google", "minimax"]).optional(),
  })
  .refine((b) => b.mode !== "refine" || (b.parentId && b.parentIndex !== undefined), { message: "Pick the design to change." })
  .refine((b) => b.mode !== "refine" || !!b.instructions, { message: "Say what to change." });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await logoAccess(id);
  if (!a.ok) return a.response;
  const parsed = startSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 422 });
  const body = parsed.data;
  try {
    if (!a.lead.business_name?.trim()) throw new LogoError("This lead has no business name to put on a logo.", 422);
    if (body.mode === "refine") {
      const parent = await getGeneration(a.admin, id, body.parentId!);
      if (!parent?.candidates?.some((c) => c.index === body.parentIndex)) throw new LogoError("That design is gone — pick another.", 404);
    }
    const d = await designers();
    const engine = body.engine ?? defaultEngine(d);
    if (!engine) throw new LogoError(NO_DESIGNER_MESSAGE, 503);
    if (!d[engine]) throw new LogoError(engine === "google" ? "Google isn't set up — an admin needs to add the Gemini API key under Admin → AI providers." : "MiniMax isn't set up — an admin needs to add its API key under Admin → AI providers.", 503);
    const now = new Date();
    const limited = await rateLimitReason(a.admin, a.userId, id, now);
    if (limited) throw new LogoError(limited, 429);
    // Only when an admin set a daily cap (LOGO_DAILY_IMAGE_BUDGET); otherwise MiniMax's plan is the limit.
    const limit = dailyImageBudget();
    if (limit !== null && (await imagesUsedToday(a.admin, now)) + Math.min(4, IMAGES_PER_ROUND_MAX) > limit) throw new LogoError(budgetMessage(limit), 429);
    const logoText = body.logoText || logoBrief(a.lead).logoText;
    const { created, row } = await startGeneration(
      a.admin,
      { leadId: id, userId: a.userId, mode: body.mode, logoText, instructions: body.instructions, parentId: body.parentId, parentIndex: body.parentIndex },
      now,
    );
    if (created) {
      const deps = productionLogoDeps(a.admin, d);
      after(() => runLogoGeneration(row.id, deps, { font: body.font ?? null, engine }).catch((e) => console.error(`[logos] ${row.id}:`, e)));
    }
    return NextResponse.json({ created, generation: generationView(row) }, { status: created ? 201 : 200 });
  } catch (e) {
    return logoErrorResponse(e);
  }
}
