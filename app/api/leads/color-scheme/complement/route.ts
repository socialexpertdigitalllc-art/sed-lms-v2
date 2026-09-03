import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callProvider } from "@/lib/ai-tools/run";
import { GEMINI_FLASH_MODEL } from "@/lib/ai-tools/config";
import { parseJsonLoose } from "@/lib/ai/json";
import { colorToHex, normalizeHex } from "@/lib/leads/colorScheme";
import { bestComplement, harmonyOptions, HARMONY_LABEL } from "@/lib/leads/colorHarmony";

export const runtime = "nodejs";

/** A form field, not a batch job — a slow answer is a useless answer. */
const TIMEOUT_MS = 9_000;
/** Same headroom the sibling check route documents: flash "thinks" first. */
const MAX_TOKENS = 4000;

export interface ComplementSuggestion {
  /** The recommended partner colour, #RRGGBB. */
  hex: string;
  /** One short sentence an agent can repeat to the client. */
  note: string;
  /** false when the model was unavailable and this is colour theory alone. */
  fromAi: boolean;
}

const SYSTEM =
  "You are a brand-colour consultant for a website agency. You reply with STRICT JSON only — no prose, no markdown fences.";

function buildPrompt(base: string, ctx: { business_name?: string; services?: string[]; site_type?: string }) {
  const about = [
    ctx.business_name ? `Business name: ${ctx.business_name}` : null,
    ctx.services?.length ? `Services: ${ctx.services.join(", ")}` : null,
    ctx.site_type ? `Site type: ${ctx.site_type}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `A salesperson has recorded the client's FIRST brand colour: ${base}

${about ? `About the business:\n${about}\n` : ""}
Recommend ONE second colour to pair with it for this website.

Return JSON with exactly these keys:
{ "hex": "#RRGGBB", "note": "one short sentence" }

Rules:
- "hex" must be a real hex colour that genuinely works WITH ${base} — complementary, analogous or a considered accent — never a near-duplicate of it.
- It must stay legible: usable for buttons and headings against a light page background.
- Avoid near-black and near-white; those are page colours, not brand colours.
- "note" says in one plain sentence why this pairing suits THIS business. No jargon.`;
}

/**
 * The best partner for a client's first brand colour.
 *
 * Fails OPEN, like the sibling check route: colour theory (colorHarmony.ts)
 * produces a usable answer with no model at all, and the AI only improves on
 * it. An agent filling a form must never be left waiting on a suggestion that
 * never lands — so a model outage downgrades the note, not the feature.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rawBase = typeof body?.base === "string" ? body.base : "";
  const base = colorToHex(rawBase);
  if (!base) {
    return NextResponse.json({ error: "Enter a colour first" }, { status: 422 });
  }

  const options = harmonyOptions(base);
  const fallbackHex = bestComplement(base) ?? base;
  const fallbackKind = options[0]?.kind ?? "complement";
  const fallback: ComplementSuggestion = {
    hex: fallbackHex,
    note: `${HARMONY_LABEL[fallbackKind]} to ${base} — a clear contrast that stays readable on a light page.`,
    fromAi: false,
  };

  try {
    const prompt = buildPrompt(base, {
      business_name: typeof body?.business_name === "string" ? body.business_name : undefined,
      services: Array.isArray(body?.services)
        ? body.services.filter((s: unknown): s is string => typeof s === "string")
        : undefined,
      site_type: typeof body?.site_type === "string" ? body.site_type : undefined,
    });
    // Same discipline as the sibling check route: one attempt, no retry — this
    // is a spinner next to a form field, and colour theory already has an answer.
    const { text } = await callProvider("gemini", GEMINI_FLASH_MODEL, SYSTEM, prompt, {
      maxTokens: MAX_TOKENS,
      temperature: 0.3,
      timeoutMs: TIMEOUT_MS,
      maxAttempts: 1,
    });
    const parsed = parseJsonLoose(text) as { hex?: unknown; note?: unknown } | null;
    const hex = typeof parsed?.hex === "string" ? normalizeHex(parsed.hex) : null;
    // A model that echoes the base back has not answered the question.
    if (hex && hex.toLowerCase() !== base.toLowerCase()) {
      return NextResponse.json({
        hex,
        note: typeof parsed?.note === "string" && parsed.note.trim() ? parsed.note.trim() : fallback.note,
        fromAi: true,
      } satisfies ComplementSuggestion);
    }
  } catch {
    /* fall through to colour theory */
  }

  return NextResponse.json(fallback);
}
