import { columnLetterToIndex } from "./columns";
import { LEAD_STATUSES } from "@/lib/leads/types";

const ARRAY_FIELDS = new Set(["services", "service_areas", "specify_pages", "image_links"]);
const NUMBER_FIELDS = new Set(["client_experience", "num_webpages", "price_quoted", "rating"]);
const BOOL_FIELDS = new Set(["has_service_areas", "direct_line_saved"]);
const DATE_FIELDS = new Set(["created_at", "follow_up_time"]);

function toArray(v: string): string[] {
  return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}
function toNumber(v: string): number | null {
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && v.trim() !== "" ? n : null;
}
function toBool(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (["yes", "true", "1", "y"].includes(s)) return true;
  if (["no", "false", "0", "n"].includes(s)) return false;
  return null;
}
// A parsed date is only usable if it's real AND in a sane range — spreadsheets
// often carry garbage in date cells (serial numbers, concatenations) that
// otherwise parse to absurd years and blow up the timestamptz insert.
function inRange(d: Date): boolean {
  if (Number.isNaN(d.getTime())) return false;
  const y = d.getFullYear();
  return y >= 1990 && y <= 2100;
}
function toDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  if (inRange(d)) return d.toISOString();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const a = m[1], b = m[2];
    const yr = m[3].length === 2 ? "20" + m[3] : m[3];
    // if the first part can't be a month, treat it as day (DD/MM); else month (MM/DD)
    const iso = Number(a) > 12 ? `${yr}-${b.padStart(2, "0")}-${a.padStart(2, "0")}` : `${yr}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
    const d2 = new Date(iso);
    if (inRange(d2)) return d2.toISOString();
  }
  return null;
}

export interface MappedRow {
  lead: Record<string, unknown>;
  agentName: string | null;
}

// Map a raw sheet row to a partial lead + the raw agent name. Returns null for
// invalid rows (no business name).
export function mapRow(row: string[], mapping: Record<string, string>): MappedRow | null {
  const lead: Record<string, unknown> = {};
  let agentName: string | null = null;

  for (const [letter, field] of Object.entries(mapping)) {
    if (!field || field === "(ignore)") continue;
    const raw = (row[columnLetterToIndex(letter)] ?? "").toString().trim();
    if (field === "agent") {
      agentName = raw || null;
      continue;
    }
    if (raw === "") continue;
    if (ARRAY_FIELDS.has(field)) lead[field] = toArray(raw);
    else if (NUMBER_FIELDS.has(field)) { const n = toNumber(raw); if (n !== null) lead[field] = n; }
    else if (BOOL_FIELDS.has(field)) { const b = toBool(raw); if (b !== null) lead[field] = b; }
    else if (DATE_FIELDS.has(field)) { const d = toDate(raw); if (d) lead[field] = d; }
    else if (field === "status") lead.status = (LEAD_STATUSES as readonly string[]).includes(raw) ? raw : "Not Ready";
    else lead[field] = raw;
  }

  if (!lead.business_name || String(lead.business_name).trim() === "") return null;
  if (!lead.status) lead.status = "Not Ready";
  return { lead, agentName };
}
