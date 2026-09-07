// lib/forms/parse.ts
import type { PayloadField } from "@/lib/forms/types";

/** Web3forms-compatible reserved field names. Everything else is payload. */
export const RESERVED_KEYS = ["access_key", "subject", "from_name", "redirect", "botcheck", "replyto", "ccemail"] as const;
export type ReservedKey = (typeof RESERVED_KEYS)[number];
export type Reserved = Record<ReservedKey, string>;

export const LIMITS = { bodyBytes: 64 * 1024, fields: 50, valueChars: 10_000 } as const;

export type ParsedSubmission = { reserved: Reserved; payload: PayloadField[] };
export type ParseResult = { ok: true; value: ParsedSubmission } | { ok: false; status: 400; message: string };

const tooLarge: ParseResult = { ok: false, status: 400, message: "Payload too large" };
const invalid: ParseResult = { ok: false, status: 400, message: "Invalid request body" };

function emptyReserved(): Reserved {
  return { access_key: "", subject: "", from_name: "", redirect: "", botcheck: "", replyto: "", ccemail: "" };
}

/** Pure core: ordered (key, value) pairs → reserved + payload, with caps. */
export function fieldsToSubmission(entries: [string, string][]): ParseResult {
  const reserved = emptyReserved();
  const payload: PayloadField[] = [];
  for (const [rawKey, value] of entries) {
    const key = rawKey.trim().slice(0, 100);
    if (!key) continue;
    if (value.length > LIMITS.valueChars) return tooLarge;
    if ((RESERVED_KEYS as readonly string[]).includes(key)) {
      reserved[key as ReservedKey] = value;
      continue;
    }
    payload.push({ key, value });
    if (payload.length > LIMITS.fields) return tooLarge;
  }
  if (!reserved.access_key.trim()) return { ok: false, status: 400, message: "access_key is required" };
  reserved.access_key = reserved.access_key.trim();
  return { ok: true, value: { reserved, payload } };
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(scalar).join(", ");
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** Read a Request (JSON, multipart or urlencoded) into a ParsedSubmission. */
export async function parseSubmissionRequest(req: Request): Promise<ParseResult> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > LIMITS.bodyBytes) return tooLarge;
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();

  if (ct.includes("multipart/form-data")) {
    let fd: FormData;
    try { fd = await req.formData(); } catch { return invalid; }
    const entries: [string, string][] = [];
    fd.forEach((v, k) => { if (typeof v === "string") entries.push([k, v]); });
    return fieldsToSubmission(entries);
  }

  let text: string;
  try { text = await req.text(); } catch { return invalid; }
  // Byte length, not string length: a UTF-16 measure under-counts non-ASCII
  // payloads (CJK text is ~3 bytes per char), and content-length is absent on
  // some clients, so this fallback is the cap that actually holds.
  if (Buffer.byteLength(text, "utf8") > LIMITS.bodyBytes) return tooLarge;

  const wantsJson = ct.includes("application/json") || (!ct.includes("x-www-form-urlencoded") && text.trim().startsWith("{"));
  if (wantsJson) {
    let obj: unknown;
    try { obj = JSON.parse(text); } catch { return invalid; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return invalid;
    return fieldsToSubmission(Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, scalar(v)]));
  }
  const params = new URLSearchParams(text);
  const entries: [string, string][] = [];
  params.forEach((v, k) => entries.push([k, v]));
  return fieldsToSubmission(entries);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmailAddress(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

const NAME_KEYS = ["name", "full_name", "fullname", "your_name", "contact_name"];
const EMAIL_KEYS = ["email", "e-mail", "email_address", "your_email", "reply_to"];

/** Best-effort submitter identity for Reply-To and list display. */
export function extractSubmitter(payload: PayloadField[], reserved: Pick<Reserved, "replyto" | "from_name">): { name: string | null; email: string | null } {
  const byKey = new Map(payload.map((f) => [f.key.toLowerCase(), f.value.trim()]));
  let name: string | null = null;
  for (const k of NAME_KEYS) { const v = byKey.get(k); if (v) { name = v; break; } }
  if (!name) {
    const first = byKey.get("first_name") ?? byKey.get("firstname") ?? "";
    const last = byKey.get("last_name") ?? byKey.get("lastname") ?? "";
    const joined = `${first} ${last}`.trim();
    if (joined) name = joined;
  }
  if (!name && reserved.from_name.trim()) name = reserved.from_name.trim();

  let email: string | null = null;
  if (isEmailAddress(reserved.replyto)) email = reserved.replyto.trim();
  if (!email) for (const k of EMAIL_KEYS) { const v = byKey.get(k); if (v && isEmailAddress(v)) { email = v; break; } }
  return { name: name ? name.slice(0, 200) : null, email };
}
