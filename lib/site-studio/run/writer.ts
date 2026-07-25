import { parseJsonLoose } from "@/lib/ai/json";
import type { PageDef, RepeatDef, SlotDef } from "../schema";
import type { Dossier } from "./dossier";

/** The model-call seam. Production passes callForTask("site_studio_write", ...);
 *  tests pass a stub. Kept minimal so no route/network types leak in here. */
export type AiCall = (system: string, user: string) => Promise<{ text: string }>;

export interface WritePageOptions {
  /** Set for a stamped fan-out page (one per service/area) — the value this
   *  particular instance is about, e.g. "Sewer Repair". */
  stampValue?: string;
}

export type WriteResult =
  | { ok: true; title: string; slots: Record<string, string>; repeats: Record<string, Record<string, string>[]> }
  | { ok: false; error: string };

/**
 * The Writer's non-negotiable content rules. Each one cost a real v2
 * production incident — kept intact, verbatim, in the system prompt.
 */
export const WRITER_SYSTEM = `You are writing the text content for ONE page of a client's website, from a template that was built for a DIFFERENT demo business. Every value you write is plain text — never HTML, never a URL, never a template token.

Follow these rules. They are non-negotiable; each one previously shipped a broken client site when it was violated:

1. Never invent licences, awards, certifications, insurance claims, years in business, prices, or guarantees. Years only if the dossier supplies them.
2. Write for the CLIENT's trade, not the template's. The template was built for a different business. Any sample text describing a service or trade the client doesn't offer must be rewritten from scratch, not lightly edited. (v2 shipped an auto-tinting client a site that still said "cabinetry" and "kitchen remodel" — it passed every identity gate, because a real remodeler's site is supposed to say that.)
3. about_business is supplied facts, not licence to invent. Anything it doesn't state stays off-limits; it never overrides explicit fields. Design-reference links inform look and feel only — never copy claims.
4. Never emit markup, URLs, or tokens. Plain strings only. Identity (name, phone, email, logo, map) is injected deterministically and must never be written by the model.
5. Respect max_chars. The sample text shows the intended length and tone; a headline slot is not a paragraph.
6. Pricing never reaches a public site. The dossier deliberately excludes price_quoted, yearly_price, rating, comments, platform.

Reply with STRICT JSON only, no prose, no code fences:
{"title": "<page title>", "slots": {"<slot_id>": "<value>", ...}, "repeats": {"<repeat_id>": [{"<slot_id>": "<value>"}, ...], ...}}
Every text slot id listed below must appear as a key in "slots". Every repeat id listed below must appear as a key in "repeats", with one row object per sample row shown.`;

const factLine = (label: string, value: string | undefined): string | null =>
  value ? `${label}: ${value}` : null;

/** Builds the per-page user prompt: the client's facts, the stamp value for
 *  a fan-out page, one line per TEXT slot to fill, and one block per repeat.
 *  Image slots are never mentioned — the Writer is never asked about them. */
export function buildPagePrompt(page: PageDef, dossier: Dossier, opts: WritePageOptions): string {
  const lines: string[] = [];

  lines.push("CLIENT FACTS");
  const facts = [
    factLine("Business", dossier.business_name),
    factLine("Phone", dossier.phone),
    factLine("Trade / site type", dossier.site_type),
    dossier.services.length ? `Services: ${dossier.services.join(", ")}` : null,
    dossier.service_areas.length ? `Service areas: ${dossier.service_areas.join(", ")}` : null,
    dossier.years_experience != null ? `Years in business: ${dossier.years_experience}` : null,
    factLine("About (supplied facts only, do not add to this)", dossier.about_business),
    dossier.no_email ? "This business has no public email — do not write one." : null,
  ].filter((l): l is string => Boolean(l));
  lines.push(...facts);
  lines.push("");

  lines.push(`PAGE: ${page.id} (${page.kind})`);
  if (opts.stampValue) {
    lines.push(`This page is specifically about: ${opts.stampValue}`);
  }
  lines.push(`Page title sample (tone/length guide): "${page.title_sample}"`);
  lines.push("");

  const textSlots: SlotDef[] = page.slots.filter((s) => s.type === "text");
  if (textSlots.length) {
    lines.push('TEXT SLOTS TO WRITE (one key per id in the "slots" object):');
    for (const slot of textSlots) {
      const semantic = slot.semantic ? ` | ${slot.semantic}` : "";
      const budget = slot.max_chars ? ` | max ${slot.max_chars} chars` : "";
      lines.push(`- ${slot.id}${semantic}${budget} | sample: "${slot.sample}"`);
    }
    lines.push("");
  }

  const repeats: RepeatDef[] = page.repeats;
  if (repeats.length) {
    lines.push('REPEATING CARDS (one key per id in the "repeats" object, one row object per sample row):');
    for (const rep of repeats) {
      lines.push(`- ${rep.id}: write ${rep.samples.length} row(s), fields: ${rep.slots.map((s) => s.id).join(", ")}`);
      rep.samples.forEach((row, i) => {
        const rowText = Object.entries(row).map(([k, v]) => `${k}="${v}"`).join(", ");
        lines.push(`    sample row ${i + 1}: ${rowText}`);
      });
    }
  }

  return lines.join("\n");
}

/** Cuts a value down to maxChars at the last word boundary that keeps it
 *  under the budget; falls back to a hard cut when there is no space (e.g. a
 *  single very long token). Truncating rather than failing the page — a
 *  slightly long headline is not worth losing a page over. */
function truncateAtWord(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const slice = value.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd();
}

const DISALLOWED = /<|\{\{|https?:\/\/|www\./i;

/** One AI call for one page. Parses strict JSON (tolerating code fences),
 *  validates every text slot is present and every value is plain text, then
 *  truncates any value over its slot's max_chars. Never silently blanks a
 *  page: a page the model fails on returns `ok:false` with the reason. */
export async function writePage(
  page: PageDef,
  dossier: Dossier,
  opts: WritePageOptions,
  call: AiCall,
): Promise<WriteResult> {
  const { text } = await call(WRITER_SYSTEM, buildPagePrompt(page, dossier, opts));

  const parsed = parseJsonLoose<{ title?: unknown; slots?: unknown; repeats?: unknown }>(text);
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "writer: reply was not valid JSON" };
  }

  const textSlots = page.slots.filter((s) => s.type === "text");
  const rawSlots =
    parsed.slots && typeof parsed.slots === "object" ? (parsed.slots as Record<string, unknown>) : {};

  const missing: string[] = [];
  const slots: Record<string, string> = {};
  for (const slot of textSlots) {
    const v = rawSlots[slot.id];
    if (typeof v !== "string") {
      missing.push(slot.id);
      continue;
    }
    slots[slot.id] = v;
  }
  if (missing.length) {
    return { ok: false, error: `writer: missing slot(s): ${missing.join(", ")}` };
  }

  // Repeats: every repeat the page declares must come back with at least one
  // row and every field on every row present as a string — never silently
  // blank. A missing/short repeat isn't just an incomplete page: the
  // renderer refuses ANY repeat region below its declared minimum (typically
  // 1), so an under-filled repeat would otherwise surface as a render
  // failure long after this page "succeeded". Catching it here, per page, is
  // what makes it retryable instead of a whole-run failure.
  const rawRepeats =
    parsed.repeats && typeof parsed.repeats === "object" ? (parsed.repeats as Record<string, unknown>) : {};
  const missingRepeats: string[] = [];
  const repeats: Record<string, Record<string, string>[]> = {};
  for (const rep of page.repeats) {
    const rowsRaw = rawRepeats[rep.id];
    if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) {
      missingRepeats.push(rep.id);
      continue;
    }
    const rows: Record<string, string>[] = [];
    let complete = true;
    for (const rowRaw of rowsRaw) {
      if (typeof rowRaw !== "object" || rowRaw === null) {
        complete = false;
        break;
      }
      const row: Record<string, string> = {};
      for (const slot of rep.slots) {
        const v = (rowRaw as Record<string, unknown>)[slot.id];
        if (typeof v !== "string") {
          complete = false;
          break;
        }
        row[slot.id] = v;
      }
      if (!complete) break;
      rows.push(row);
    }
    if (!complete) {
      missingRepeats.push(rep.id);
      continue;
    }
    repeats[rep.id] = rows;
  }
  if (missingRepeats.length) {
    return { ok: false, error: `writer: missing or incomplete repeat row(s): ${missingRepeats.join(", ")}` };
  }

  const title = typeof parsed.title === "string" ? parsed.title : "";

  // Markup/token/URL rejection covers EVERY value the model produced,
  // including repeat rows — a repeat row is exactly as public-facing as any
  // top-level slot (a testimonial card is not a lesser field than a
  // headline), and `{{id:*}}` in a card would resolve at render time to the
  // client's real identity data just as readily as it would in a headline.
  const allValues = [
    title,
    ...Object.values(slots),
    ...Object.values(repeats).flatMap((rows) => rows.flatMap((row) => Object.values(row))),
  ];
  if (allValues.some((v) => DISALLOWED.test(v))) {
    return { ok: false, error: "writer: a value contained markup, a URL, or token syntax" };
  }

  for (const slot of textSlots) {
    if (slot.max_chars && slots[slot.id].length > slot.max_chars) {
      slots[slot.id] = truncateAtWord(slots[slot.id], slot.max_chars);
    }
  }

  for (const rep of page.repeats) {
    for (const row of repeats[rep.id]) {
      for (const slot of rep.slots) {
        if (slot.max_chars && row[slot.id].length > slot.max_chars) {
          row[slot.id] = truncateAtWord(row[slot.id], slot.max_chars);
        }
      }
    }
  }

  return { ok: true, title, slots, repeats };
}
