import { formatPhone, PHONE_RE } from "@/lib/forms/phone";
import { formatColorScheme, isLikelyColor, parseColorScheme } from "@/lib/leads/colorScheme";
import { isYmd, tzOffsetMs, zonedParts } from "../dates";
import type { CardField, EditSpec } from "./card";
import { isUuid, looksLikeUuid, resolveRef } from "./refs";
import type { ActionContext, ActionDef, FieldSpec, Problem, Values } from "./types";

/**
 * Turning what the model sent into clean, checked values — the same way for
 * every action. SERVER ONLY.
 *
 * The model fills fields from conversation: "(252) 401 2775", "tomorrow 10am"
 * already converted to "2026-10-15T10:00", "Sara", "$500". Each field type
 * normalises its input (a US phone to "(252) 401-2775", a local time to an
 * instant in the company timezone, a name to the record's id) or says exactly
 * what is wrong with it. Then the action's required fields are counted —
 * including the ones only required in some cases — and anything missing goes
 * back to the model as a question to ask, never as a guess.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Absent": nothing the person actually said. */
export function isBlank(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0 || v.every(isBlank);
  return false;
}

export function isRequired(spec: FieldSpec, v: Values): boolean {
  if (spec.showIf && !spec.showIf(v)) return false;
  return typeof spec.required === "function" ? spec.required(v) : Boolean(spec.required);
}

export function isShown(spec: FieldSpec, v: Values): boolean {
  return !spec.showIf || spec.showIf(v);
}

export async function optionsOf(spec: FieldSpec, ctx: ActionContext): Promise<readonly string[]> {
  if (!spec.options) return [];
  return typeof spec.options === "function" ? await spec.options(ctx) : spec.options;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The option `input` means: exact, then ignoring case, spaces and punctuation. */
export function matchOption(input: string, options: readonly string[]): string | null {
  const t = input.trim();
  if (options.includes(t)) return t;
  const lower = t.toLowerCase();
  const ci = options.find((o) => o.toLowerCase() === lower);
  if (ci) return ci;
  const sq = squash(t);
  return options.find((o) => squash(o) === sq) ?? null;
}

/** Money / numbers as people write them: "$1,200", "1.2k", "500 dollars". */
export function parseNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim().toLowerCase().replace(/[$,\s]|usd|dollars?|rs\.?|pkr/g, "");
  let mult = 1;
  if (/k$/.test(s)) {
    mult = 1000;
    s = s.slice(0, -1);
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s) * mult;
}

export function parseBoolean(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (["yes", "y", "true", "1", "on", "haan", "ha", "ji"].includes(s)) return true;
  if (["no", "n", "false", "0", "off", "nahi", "nahin"].includes(s)) return false;
  return null;
}

/** "https://…": adds the scheme people leave off; null when it is not a web address. */
export function normalizeUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(s)) s = `https://${s}`;
    else return null;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** A list from an array or a "a, b; c" / one-per-line string. */
export function parseList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\r?\n|;|,(?![^(]*\))/) : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    // A bullet is "- ", "• " or "* " — not the "*" of a wildcard like *.acme.com.
    const s = typeof item === "string" ? item.replace(/^\s*[-•*]\s+/, "").trim() : typeof item === "number" ? String(item) : "";
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * An instant from what the model sent. A time WITHOUT a zone is wall-clock
 * time in the company timezone (that is what the prompt tells the model to
 * send); a time with "Z" or an offset is taken as given.
 */
export function parseDateTime(v: unknown, tz: string): Date | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(" ", "T");
  const naive = /^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(s);
  if (naive) {
    const [, y, mo, d, h, mi, se] = naive.map(Number) as unknown as number[];
    if (!isYmd(`${naive[1]}-${naive[2]}-${naive[3]}`) || h > 23 || mi > 59) return null;
    const guess = Date.UTC(y, mo - 1, d, h, mi, se || 0);
    const first = guess - tzOffsetMs(guess, tz);
    return new Date(guess - tzOffsetMs(first, tz));
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

/** "Wed, Oct 15, 10:00 AM" in the company timezone (with the year when it is not this year). */
export function formatDateTime(at: Date | string, tz: string, now = new Date()): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const sameYear = zonedParts(d.getTime(), tz).year === zonedParts(now.getTime(), tz).year;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** The editor's value for a datetime: "YYYY-MM-DDTHH:mm" wall-clock in the company timezone. */
export function localInputValue(at: Date | string, tz: string): string {
  const p = zonedParts(new Date(at).getTime(), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function todayYmd(tz: string, now: Date): string {
  const p = zonedParts(now.getTime(), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export interface Normalized {
  /** Clean values, keyed by field name. Refs are ids. */
  values: Values;
  /** How each value reads on the card ("Jumbo's Pizza", "Wed, Oct 15, 10:00 AM"). */
  display: Record<string, string>;
  problems: Problem[];
}

/** Plan-step references ("@1" = what step 1 creates), allowed where a later step names an earlier step's record. */
export const STEP_REF_RE = /^@(\d{1,2})$/;

/**
 * Check and clean every value the model sent for this action. `raw` may also
 * carry values from earlier (a stored proposal being edited on its card).
 */
export async function normalizeFields(def: ActionDef, raw: Values, ctx: ActionContext, opts: { stepRefs?: boolean } = {}): Promise<Normalized> {
  const values: Values = {};
  const display: Record<string, string> = {};
  const problems: Problem[] = [];
  const known = new Map(def.fields.map((f) => [f.name, f]));

  for (const key of Object.keys(raw)) {
    // "__name" and friends: values a check worked out last time; it works them out again.
    if (key.startsWith("__") || known.has(key) || isBlank(raw[key])) continue;
    const guess = closestField(key, def.fields);
    problems.push({ field: key, message: `There is no field "${key}" on this action${guess ? ` — did you mean "${guess}"?` : ""}. Check the field names with describe_action.` });
  }

  for (const spec of def.fields) {
    const input = raw[spec.name];
    if (isBlank(input)) continue;
    const r = await normalizeOne(spec, input, ctx, opts);
    if ("problem" in r) problems.push({ field: spec.name, message: r.problem, ...(r.choices ? { choices: r.choices } : {}) });
    else {
      values[spec.name] = r.value;
      display[spec.name] = r.display;
    }
  }

  // Defaults fill what the person left out — never what they said.
  for (const spec of def.fields) {
    if (spec.name in values || problems.some((p) => p.field === spec.name) || spec.default === undefined) continue;
    if (!isShown(spec, values)) continue;
    const d = typeof spec.default === "function" ? await (spec.default as (c: ActionContext, v: Values) => unknown)(ctx, values) : spec.default;
    if (isBlank(d)) continue;
    const r = await normalizeOne(spec, d, ctx, opts);
    if (!("problem" in r)) {
      values[spec.name] = r.value;
      display[spec.name] = r.display;
    }
  }

  // Values for fields that no longer apply (a reference link on a new build)
  // are dropped, so they neither show on the card nor reach the endpoint.
  for (const spec of def.fields) {
    if (spec.name in values && !isShown(spec, values)) {
      delete values[spec.name];
      delete display[spec.name];
    }
  }
  return { values, display, problems };
}

function closestField(key: string, fields: FieldSpec[]): string | null {
  const k = squash(key);
  const hit = fields.find((f) => squash(f.name).includes(k) || k.includes(squash(f.name)) || squash(f.label).includes(k));
  return hit?.name ?? null;
}

type One = { value: unknown; display: string } | { problem: string; choices?: string[] };

async function normalizeOne(spec: FieldSpec, input: unknown, ctx: ActionContext, opts: { stepRefs?: boolean }): Promise<One> {
  const label = spec.label;
  switch (spec.type) {
    case "text":
    case "longtext": {
      if (typeof input !== "string" && typeof input !== "number") return { problem: `${label} should be text.` };
      const s = spec.type === "text" ? String(input).replace(/\s+/g, " ").trim() : String(input).replace(/\r\n/g, "\n").trim();
      const max = spec.max ?? (spec.type === "text" ? 300 : 10_000);
      if (s.length > max) return { problem: `${label} is too long (${s.length} characters; at most ${max}).` };
      if (spec.min && s.length < spec.min) return { problem: `${label} is too short (at least ${spec.min} characters).` };
      return { value: s, display: s };
    }
    case "phone": {
      const s = formatPhone(String(input));
      if (!PHONE_RE.test(s)) return { problem: `${label} must be a 10-digit US number, like (252) 401-2775.` };
      return { value: s, display: s };
    }
    case "email": {
      const s = String(input).trim().toLowerCase();
      if (!EMAIL_RE.test(s)) return { problem: `${label} is not a valid email address.` };
      return { value: s, display: s };
    }
    case "url": {
      const u = normalizeUrl(input);
      if (!u) return { problem: `${label} must be a web address (https://…).` };
      return { value: u, display: u };
    }
    case "integer":
    case "number":
    case "money":
    case "rating": {
      const n = parseNumber(input);
      if (n === null) return { problem: `${label} must be a number.` };
      if ((spec.type === "integer" || spec.type === "rating") && !Number.isInteger(n)) return { problem: `${label} must be a whole number.` };
      const min = spec.type === "rating" ? (spec.min ?? 1) : spec.min;
      const max = spec.type === "rating" ? (spec.max ?? 10) : spec.max;
      if (min !== undefined && n < min) return { problem: `${label} must be at least ${min}.` };
      if (max !== undefined && n > max) return { problem: `${label} must be at most ${max}.` };
      if (spec.type === "money" && n < 0) return { problem: `${label} cannot be negative.` };
      return { value: n, display: spec.type === "money" ? money(n) : spec.type === "rating" ? `${n} / ${max}` : n.toLocaleString("en-US") };
    }
    case "boolean": {
      const b = parseBoolean(input);
      if (b === null) return { problem: `${label} must be yes or no.` };
      return { value: b, display: b ? "Yes" : "No" };
    }
    case "date": {
      const s = String(input).trim().slice(0, 10);
      if (!isYmd(s)) return { problem: `${label} must be a date as YYYY-MM-DD.` };
      if (spec.future && s < todayYmd(ctx.timezone, ctx.now)) return { problem: `${label} must be today or later.` };
      return { value: s, display: formatDate(s) };
    }
    case "datetime": {
      const d = parseDateTime(input, ctx.timezone);
      if (!d) return { problem: `${label} must be a date and time, like 2026-10-15T10:00 (company time, ${ctx.timezone}).` };
      if (spec.future && d.getTime() <= ctx.now.getTime()) {
        return { problem: `${label} must be in the future — ${formatDateTime(d, ctx.timezone, ctx.now)} has passed.` };
      }
      return { value: d.toISOString(), display: formatDateTime(d, ctx.timezone, ctx.now) };
    }
    case "enum": {
      const options = await optionsOf(spec, ctx);
      const hit = matchOption(String(input), options);
      if (!hit) return { problem: `${label} must be one of: ${options.join(", ")}.` };
      return { value: hit, display: hit };
    }
    case "multi": {
      const options = await optionsOf(spec, ctx);
      const items = parseList(input);
      const out: string[] = [];
      for (const item of items) {
        const hit = matchOption(item, options);
        if (!hit) return { problem: `"${item}" is not a choice for ${label}. Use: ${options.join(", ")}.` };
        if (!out.includes(hit)) out.push(hit);
      }
      if (spec.min !== undefined && out.length < spec.min) return { problem: `${label} needs at least ${spec.min}.` };
      if (spec.max !== undefined && out.length > spec.max) return { problem: `${label} takes at most ${spec.max}.` };
      return { value: out, display: out.join(", ") };
    }
    case "list": {
      const items = parseList(input);
      const max = spec.max ?? 100;
      if (items.length > max) return { problem: `${label} takes at most ${max} entries.` };
      if (spec.min !== undefined && items.length < spec.min) return { problem: `${label} needs at least ${spec.min}.` };
      if (items.some((i) => i.length > 1000)) return { problem: `Each ${label.toLowerCase()} entry must be under 1,000 characters.` };
      return { value: items, display: items.join(", ") };
    }
    case "colors": {
      const raw = Array.isArray(input) ? input.join(", ") : String(input);
      const colors = parseColorScheme(raw);
      const bad = colors.filter((c) => !isLikelyColor(c));
      if (bad.length) return { problem: `Not recognisable as colours: ${bad.join(", ")}. Use hex codes (#1E40AF) or common colour names.` };
      const min = spec.min ?? 1;
      const max = spec.max ?? 5;
      if (colors.length < min) return { problem: `${label} needs at least ${min} colours.` };
      if (colors.length > max) return { problem: `${label} takes at most ${max} colours.` };
      const value = formatColorScheme(colors);
      return { value, display: value };
    }
    case "ref": {
      if (opts.stepRefs && typeof input === "string" && STEP_REF_RE.test(input.trim())) {
        return { value: input.trim(), display: `the record from step ${input.trim().slice(1)}` };
      }
      const r = await resolveRef(spec.ref!, input, ctx, spec.refFilter);
      if (!r.ok) return { problem: r.message, choices: r.choices };
      return { value: r.hit.id, display: r.hit.label };
    }
    case "refs": {
      const items = Array.isArray(input) ? input : parseList(input);
      const ids: string[] = [];
      const labels: string[] = [];
      for (const item of items) {
        const r = await resolveRef(spec.ref!, item, ctx, spec.refFilter);
        if (!r.ok) return { problem: `${label}: ${r.message}`, choices: r.choices };
        if (!ids.includes(r.hit.id)) {
          ids.push(r.hit.id);
          labels.push(r.hit.label);
        }
      }
      const max = spec.max ?? 500;
      if (ids.length > max) return { problem: `${label} takes at most ${max}.` };
      return { value: ids, display: labels.length > 6 ? `${labels.slice(0, 5).join(", ")} and ${labels.length - 5} more` : labels.join(", ") };
    }
    case "attachment":
    case "attachments": {
      // A file attached in the chat (its id), or — where a link will do — a web address.
      const items = spec.type === "attachments" ? (Array.isArray(input) ? input : parseList(input)) : [input];
      const values: string[] = [];
      const names: string[] = [];
      for (const item of items) {
        let s = typeof item === "string" ? item.trim() : item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id : "";
        if (s.startsWith(UPLOAD_PREFIX)) s = s.slice(UPLOAD_PREFIX.length);
        if (looksLikeUuid(s) || (s && !/^https?:\/\//i.test(s) && !s.includes("."))) {
          const r = await resolveRef("upload", s, ctx);
          if (!r.ok) return { problem: `${label}: ${r.message}`, choices: r.choices };
          values.push(`${UPLOAD_PREFIX}${r.hit.id}`);
          names.push(r.hit.label);
          continue;
        }
        const u = normalizeUrl(s);
        if (!u) return { problem: `${label} must be a file attached in this chat, or a web address.` };
        values.push(u);
        names.push(u);
      }
      const max = spec.type === "attachments" ? (spec.max ?? 10) : 1;
      if (values.length > max) return { problem: `${label} takes at most ${max} files.` };
      return spec.type === "attachments" ? { value: values, display: names.join(", ") } : { value: values[0], display: names[0] };
    }
    case "json":
      return { value: input, display: typeof input === "string" ? input : JSON.stringify(input).slice(0, 300) };
  }
}

/** How an attached chat file is stored in an action's values: "upload:<id>". */
export const UPLOAD_PREFIX = "upload:";

/** One value, normalised the way its field type says (for values a check worked out). */
export function normalizeValue(spec: FieldSpec, input: unknown, ctx: ActionContext): Promise<{ value: unknown; display: string } | { problem: string; choices?: string[] }> {
  return normalizeOne(spec, input, ctx, {});
}

/** Fields still needed, in declaration order. */
export function missingFields(def: ActionDef, values: Values, problems: Problem[]): FieldSpec[] {
  const bad = new Set(problems.map((p) => p.field));
  return def.fields.filter((f) => isRequired(f, values) && isBlank(values[f.name]) && !bad.has(f.name));
}

const CARD_EDITABLE = new Set<FieldSpec["type"]>(["text", "longtext", "email", "phone", "url", "integer", "number", "money", "colors", "boolean", "date", "datetime", "enum", "rating"]);

/** Is this field offered for editing on the card? (The confirm route accepts edits only for these.) */
export function isCardEditable(spec: FieldSpec): boolean {
  if (spec.editable === false || spec.hidden) return false;
  return CARD_EDITABLE.has(spec.type) || spec.editable === true;
}

/** How a field can be edited on the card, or null when it is changed by asking the assistant. */
export async function editSpecFor(spec: FieldSpec, value: unknown, ctx: ActionContext): Promise<EditSpec | null> {
  if (spec.editable === false || spec.hidden) return null;
  const raw = value === undefined || value === null ? "" : String(value);
  switch (spec.type) {
    case "text":
    case "longtext":
    case "email":
    case "phone":
    case "url":
      return { type: spec.type, raw };
    case "integer":
    case "number":
    case "money":
      return { type: "number", raw };
    case "colors":
      return { type: "text", raw };
    case "boolean":
      return { type: "boolean", raw: value === true ? "true" : value === false ? "false" : "" };
    case "date":
      return { type: "date", raw };
    case "datetime":
      return { type: "datetime", raw: typeof value === "string" && value ? localInputValue(value, ctx.timezone) : "" };
    case "enum": {
      const options = await optionsOf(spec, ctx);
      return { type: "enum", raw, options: options.map((o) => ({ value: o, label: o })) };
    }
    case "rating": {
      const max = spec.max ?? 10;
      return { type: "enum", raw, options: Array.from({ length: max - (spec.min ?? 1) + 1 }, (_, i) => String((spec.min ?? 1) + i)).map((o) => ({ value: o, label: `${o} / ${max}` })) };
    }
    default:
      return spec.editable ? { type: "text", raw } : null;
  }
}

/** The card's field list: every shown, non-hidden field that has a value. */
export async function cardFields(def: ActionDef, n: Pick<Normalized, "values" | "display">, ctx: ActionContext): Promise<CardField[]> {
  const out: CardField[] = [];
  for (const spec of def.fields) {
    if (spec.hidden || !isShown(spec, n.values)) continue;
    const v = n.values[spec.name];
    if (isBlank(v) && !isRequired(spec, n.values)) continue;
    out.push({ name: spec.name, label: spec.label, value: n.display[spec.name] ?? "", edit: await editSpecFor(spec, v, ctx) });
  }
  return out;
}

/** What each field is, for the model (describe_action). */
export async function describeFields(def: ActionDef, ctx: ActionContext): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const f of def.fields) {
    const required = typeof f.required === "function" ? "sometimes (see help)" : f.required ? (f.showIf ? "when it applies" : "yes") : "no";
    const entry: Record<string, unknown> = { name: f.name, label: f.label, type: f.type, required };
    if (f.help) entry.help = f.help;
    if (f.type === "enum" || f.type === "multi") entry.options = await optionsOf(f, ctx);
    if (f.ref) entry.points_at = f.ref;
    if (f.type === "datetime") entry.format = `YYYY-MM-DDTHH:mm in company time (${ctx.timezone})${f.future ? ", in the future" : ""}`;
    if (f.type === "date") entry.format = "YYYY-MM-DD";
    if (f.default !== undefined && typeof f.default !== "function") entry.default = f.default;
    out.push(entry);
  }
  return out;
}

/** Reject anything that looks like an id we did not issue (the model inventing one). */
export const looksLikeId = isUuid;
