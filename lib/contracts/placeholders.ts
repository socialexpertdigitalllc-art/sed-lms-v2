import type { ContractSnapshot } from "@/lib/contracts/types";
import type { AddOn, Lead } from "@/lib/leads/types";
import { formatUsd, parsePrice } from "@/lib/contracts/merge";
import { SERVICE_PROVIDER } from "@/lib/contracts/provider";

export type PlaceholderGroup = "Client" | "Pricing" | "Agent" | "Provider" | "Date & time";

export interface PlaceholderDef {
  token: string;
  label: string;
  group: PlaceholderGroup;
}

/**
 * The catalog of every token the merge engine fills — the single source of
 * truth. `buildReplacements` below is asserted (in tests) to produce exactly
 * these tokens, so the admin reference list can never drift from reality.
 */
export const BUILT_IN_PLACEHOLDERS: PlaceholderDef[] = [
  { token: "{{business_name}}", label: "Client business name", group: "Client" },
  { token: "{{business_phone}}", label: "Client phone", group: "Client" },
  { token: "{{business_email}}", label: "Client email", group: "Client" },
  { token: "{{one_time_price}}", label: "One-time price", group: "Pricing" },
  { token: "{{yearly_price}}", label: "Yearly price", group: "Pricing" },
  { token: "{{date}}", label: "Contract date", group: "Date & time" },
  { token: "{{agent_name}}", label: "Agent name", group: "Agent" },
  { token: "{{provider_name}}", label: "Provider name", group: "Provider" },
  { token: "{{provider_phone}}", label: "Provider phone", group: "Provider" },
  { token: "{{provider_email}}", label: "Provider email", group: "Provider" },
  { token: "{{current_date}}", label: "Today (YYYY-MM-DD)", group: "Date & time" },
  { token: "{{current_time}}", label: "Current time", group: "Date & time" },
  { token: "{{current_datetime}}", label: "Current date and time", group: "Date & time" },
  { token: "{{date_long}}", label: "Today, long form (July 19, 2026)", group: "Date & time" },
  { token: "{{year}}", label: "Current year", group: "Date & time" },
  { token: "{{month}}", label: "Current month (2-digit)", group: "Date & time" },
  { token: "{{day}}", label: "Current day of month (2-digit)", group: "Date & time" },
];

/** Flat token list, derived from the catalog. Kept for existing callers/tests. */
export const SUPPORTED_PLACEHOLDERS: readonly string[] = BUILT_IN_PLACEHOLDERS.map((p) => p.token);

/** Display order for grouped UI listings. */
export const PLACEHOLDER_GROUPS: PlaceholderGroup[] = ["Client", "Pricing", "Agent", "Provider", "Date & time"];

/** Unique `{{token}}` strings in first-seen order (whitespace-tolerant). */
export function extractPlaceholders(text: string): string[] {
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = `{{${m[1]}}}`;
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

// ── Date & time ───────────────────────────────────────────────────────────────

type DateParts = { year: string; month: string; day: string; monthLong: string; time: string };

/** Split `now` into display parts in `timeZone`, falling back to UTC if the zone is bogus. */
function dateParts(now: Date, timeZone: string): DateParts {
  const read = (tz: string): DateParts => {
    const get = (opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).formatToParts(now);
    const dp = Object.fromEntries(
      get({ year: "numeric", month: "2-digit", day: "2-digit" }).map((p) => [p.type, p.value])
    );
    const monthLong = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long" }).format(now);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true })
      .format(now)
      // Node/ICU can emit a narrow no-break space before AM/PM.
      .replace(/ | /g, " ");
    return { year: dp.year ?? "", month: dp.month ?? "", day: dp.day ?? "", monthLong, time };
  };
  try {
    return read(timeZone);
  } catch {
    return read("UTC");
  }
}

// ── Replacements ──────────────────────────────────────────────────────────────

/**
 * Map supported tokens → formatted values. The clock is injected (`opts.now`,
 * `opts.timeZone`) so date/time tokens stay deterministic and testable; callers
 * pass `app_settings.work_timezone` and default to UTC when unset.
 */
export function buildReplacements(
  s: ContractSnapshot,
  opts?: { now?: Date; timeZone?: string }
): { token: string; value: string }[] {
  const now = opts?.now ?? new Date();
  const tz = opts?.timeZone?.trim() || "UTC";
  const d = dateParts(now, tz);
  const currentDate = `${d.year}-${d.month}-${d.day}`;
  const dateLong = `${d.monthLong} ${Number(d.day)}, ${d.year}`;

  return [
    { token: "{{business_name}}", value: s.business_name || "" },
    { token: "{{business_phone}}", value: s.business_phone || "" },
    { token: "{{business_email}}", value: s.business_email || "" },
    { token: "{{one_time_price}}", value: formatUsd(s.one_time_price) },
    { token: "{{yearly_price}}", value: formatUsd(s.yearly_price) },
    { token: "{{date}}", value: s.contract_date },
    { token: "{{agent_name}}", value: s.agent_name || "" },
    { token: "{{provider_name}}", value: SERVICE_PROVIDER.name },
    { token: "{{provider_phone}}", value: SERVICE_PROVIDER.phone },
    { token: "{{provider_email}}", value: SERVICE_PROVIDER.email },
    { token: "{{current_date}}", value: currentDate },
    { token: "{{current_time}}", value: d.time },
    { token: "{{current_datetime}}", value: `${currentDate} ${d.time}` },
    { token: "{{date_long}}", value: dateLong },
    { token: "{{year}}", value: d.year },
    { token: "{{month}}", value: d.month },
    { token: "{{day}}", value: d.day },
  ];
}

// ── Custom placeholders bound to lead fields ──────────────────────────────────

export type LeadFieldKind = "text" | "money" | "number" | "list";

/**
 * Whitelist of lead columns a custom placeholder may read. Client-safe only:
 * internal sales state (rating, comments, agent_id, follow-up fields, tags,
 * created_by, deleted_at) is deliberately absent and must stay that way.
 */
export const LEAD_FIELD_SOURCES: Record<string, { label: string; kind: LeadFieldKind }> = {
  business_name: { label: "Business name", kind: "text" },
  business_phone: { label: "Business phone", kind: "text" },
  business_email: { label: "Business email", kind: "text" },
  website_link: { label: "Website link", kind: "text" },
  business_profile_link: { label: "Business profile link", kind: "text" },
  site_type: { label: "Site type", kind: "text" },
  platform: { label: "Platform", kind: "text" },
  services: { label: "Services", kind: "list" },
  service_areas: { label: "Service areas", kind: "list" },
  specify_pages: { label: "Specified pages", kind: "list" },
  num_webpages: { label: "Number of web pages", kind: "number" },
  client_experience: { label: "Client experience (years)", kind: "number" },
  color_scheme: { label: "Color scheme", kind: "text" },
  price_quoted: { label: "Price quoted", kind: "money" },
  yearly_price: { label: "Yearly price", kind: "money" },
  add_ons: { label: "Add-ons", kind: "list" },
  reference_link: { label: "Reference link", kind: "text" },
};

export function isLeadFieldSource(key: string): boolean {
  return Object.hasOwn(LEAD_FIELD_SOURCES, key);
}

function isAddOn(v: unknown): v is AddOn {
  return typeof v === "object" && v !== null && "label" in (v as Record<string, unknown>);
}

/** Render one whitelisted lead field as merge-ready text ("" when absent). */
export function formatLeadField(lead: Lead, fieldKey: string): string {
  const source = LEAD_FIELD_SOURCES[fieldKey];
  if (!source) return "";
  const raw = (lead as unknown as Record<string, unknown>)[fieldKey];
  if (raw === null || raw === undefined) return "";

  switch (source.kind) {
    case "list": {
      if (!Array.isArray(raw)) return "";
      const parts = raw
        .map((v) => (isAddOn(v) ? String(v.label ?? "") : typeof v === "string" ? v : String(v ?? "")))
        .map((v) => v.trim())
        .filter(Boolean);
      return parts.join(", ");
    }
    case "money": {
      const n = parsePrice(raw as number | string | null);
      return n === null ? "" : formatUsd(n);
    }
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? String(raw) : "";
    default:
      return typeof raw === "string" ? raw.trim() : String(raw);
  }
}

/**
 * Normalise operator input into a canonical `{{token}}`. Accepts `foo` or
 * `{{foo}}` (any surrounding/inner whitespace), lowercases, and allows only
 * `[a-z0-9_]`. Returns null when the input can't be a valid token.
 */
export function normalizeToken(input: string): string | null {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return null;
  const hasOpen = trimmed.startsWith("{{");
  const hasClose = trimmed.endsWith("}}");
  if (hasOpen !== hasClose) return null;
  const inner = (hasOpen ? trimmed.slice(2, -2) : trimmed).trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(inner)) return null;
  return `{{${inner}}}`;
}

/** True when a token is already provided by the built-in catalog. */
export function isBuiltInToken(token: string): boolean {
  return (SUPPORTED_PLACEHOLDERS as readonly string[]).includes(token);
}

/**
 * Tokens a template uses that we can't fill — surfaced in the UI as "unmapped".
 * Registered custom placeholders count as mapped.
 */
export function unmappedPlaceholders(found: string[], customTokens: string[] = []): string[] {
  const known = new Set<string>([...SUPPORTED_PLACEHOLDERS, ...customTokens]);
  return found.filter((t) => !known.has(t));
}

/** A custom placeholder row (`contract_placeholders`). */
export interface ContractPlaceholderRow {
  id: string;
  token: string;
  lead_field: string;
  label: string;
  created_at?: string;
}
