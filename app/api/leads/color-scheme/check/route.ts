import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { callProvider } from "@/lib/ai-tools/run";
import { GEMINI_FLASH_MODEL } from "@/lib/ai-tools/config";
import { parseJsonLoose } from "@/lib/ai/json";
import {
  MAX_COLORS,
  normalizeHex,
  parseColorScheme,
  type ColorSchemeCheck,
} from "@/lib/leads/colorScheme";

export const runtime = "nodejs";

/** This is a form field, not a batch job — a slow answer is a useless answer. */
const TIMEOUT_MS = 12_000;

/**
 * The verdict itself is ~150 output tokens, but gemini-3.5-flash spends
 * ~1,600-1,800 tokens THINKING first and those count against max_tokens — a
 * 700 budget came back HTTP 200 with the JSON cut off mid-string (measured
 * live, and the identical failure lib/template-engine/vision.ts documents at
 * its own 2000). 8000 leaves several times the headroom either needs.
 */
const MAX_TOKENS = 8000;

/** The answer when the model is unavailable: the client falls back to deterministicIssues. */
const SOFT: ColorSchemeCheck = { ok: null, colors: [], issues: [], suggestion: [], note: "" };

const SYSTEM = `You are a brand-colour reviewer for a website agency. You reply with STRICT JSON only — no prose, no markdown fences.`;

function buildPrompt(input: {
  raw: string;
  business_name?: string;
  services?: string[];
  site_type?: string;
}): string {
  const ctx = [
    input.business_name ? `Business name: ${input.business_name}` : null,
    input.services?.length ? `Services: ${input.services.join(", ")}` : null,
    input.site_type ? `Site type: ${input.site_type}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `A salesperson recorded this colour scheme for a client's new website:

"""${input.raw}"""

${ctx ? `About the business:\n${ctx}\n` : ""}
Judge it and return JSON with exactly these keys:
{ "ok": boolean, "colors": ["#RRGGBB", ...], "issues": ["short human reason", ...],
  "suggestion": ["#RRGGBB","#RRGGBB","#RRGGBB"], "note": "one short sentence" }

Rules:
- Accept only real colours (hex, rgb(), or CSS colour names).
- Reject vague or non-colour input: "same as logo", "up to you", "upto us", "your choice", "any", "whatever", "professional", "modern", "client will decide", "n/a", and anything similar. These are ok:false.
- At most ${MAX_COLORS} colours. If MORE than ${MAX_COLORS} are given, set ok:false and set "suggestion" to the best ${MAX_COLORS} OF THE COLOURS SUPPLIED, chosen for contrast and legibility: one dominant brand colour, one supporting colour, and one accent that has reasonable contrast against a light background.
- If the input is vague, empty, or not colours at all, set ok:false and set "suggestion" to a ${MAX_COLORS}-colour palette that suits THIS business's niche and services, and use "note" to explain the choice in one sentence.
- "colors" must list the colours the salesperson actually supplied, normalised to #RRGGBB hex wherever a name can be resolved. Use [] when nothing usable was supplied.
- When the scheme is fine, set ok:true, leave "issues" empty, and you may leave "suggestion" empty.
- Keep every issue under 12 words. Return JSON only.`;
}

function hexList(v: unknown, limit: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const hex = normalizeHex(item);
    if (hex && !out.includes(hex)) out.push(hex);
    if (out.length >= limit) break;
  }
  return out;
}

function stringList(v: unknown, limit: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * POST { raw, business_name?, services?, site_type? } → ColorSchemeCheck
 *
 * Auth-gated to any signed-in user. NEVER returns 5xx for an AI failure: a
 * timed-out model must not be able to wedge the new-lead form, so every
 * failure path answers 200 with `ok: null` and the caller falls back to the
 * deterministic rules in lib/leads/colorScheme.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { raw?: unknown; business_name?: unknown; services?: unknown; site_type?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = typeof body.raw === "string" ? body.raw.trim() : "";
  if (!raw) return NextResponse.json({ error: "raw is required" }, { status: 400 });
  if (raw.length > 500) return NextResponse.json({ error: "raw is too long" }, { status: 400 });

  const prompt = buildPrompt({
    raw,
    business_name: typeof body.business_name === "string" ? body.business_name.slice(0, 120) : undefined,
    services: stringList(body.services, 12).map((s) => s.slice(0, 60)),
    site_type: typeof body.site_type === "string" ? body.site_type.slice(0, 40) : undefined,
  });

  let text: string;
  try {
    ({ text } = await callProvider("gemini", GEMINI_FLASH_MODEL, SYSTEM, prompt, {
      maxTokens: MAX_TOKENS,
      temperature: 0.2,
      timeoutMs: TIMEOUT_MS,
    }));
  } catch {
    return NextResponse.json(SOFT);
  }

  const parsed = parseJsonLoose<Record<string, unknown>>(text);
  if (!parsed || typeof parsed !== "object") return NextResponse.json(SOFT);

  // `ok` is only believed when the model actually committed to a boolean.
  const ok = typeof parsed.ok === "boolean" ? parsed.ok : null;
  const result: ColorSchemeCheck = {
    ok,
    colors: hexList(parsed.colors, MAX_COLORS * 3),
    issues: stringList(parsed.issues, 4),
    suggestion: hexList(parsed.suggestion, MAX_COLORS),
    note: typeof parsed.note === "string" ? parsed.note.trim().slice(0, 200) : "",
  };

  // A rejection with no stated reason is unusable in the UI — say something.
  if (result.ok === false && result.issues.length === 0) {
    result.issues.push(
      parseColorScheme(raw).length > MAX_COLORS
        ? `Pick at most ${MAX_COLORS} colours.`
        : "That is not a usable colour scheme."
    );
  }

  return NextResponse.json(result);
}
