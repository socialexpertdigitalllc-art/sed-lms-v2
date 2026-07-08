import type { Lead } from "./types";

export interface CsvColumn {
  key: string;
  label: string;
}

function cell(value: unknown): string {
  if (value == null) return "";
  const s = Array.isArray(value) ? value.join("; ") : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// RFC-4180-ish CSV. Header row + one row per record. CRLF line endings.
export function toCsv(rows: Record<string, unknown>[], columns: CsvColumn[]): string {
  const header = columns.map((c) => cell(c.label)).join(",");
  if (rows.length === 0) return header;
  const body = rows.map((r) => columns.map((c) => cell(r[c.key])).join(",")).join("\r\n");
  return `${header}\r\n${body}`;
}

/** Column set for the Leads table's "Export CSV" — a curated subset of lead fields
 *  (not a full dump). Row values are produced by `leadCsvRow`. */
export const LEAD_CSV_COLUMNS: CsvColumn[] = [
  { key: "created_at", label: "Date" },
  { key: "business_name", label: "Business" },
  { key: "business_email", label: "Email" },
  { key: "business_phone", label: "Phone" },
  { key: "status", label: "Status" },
  { key: "agent", label: "Agent" },
  { key: "site_type", label: "Type" },
  { key: "price_quoted", label: "Price" },
  { key: "rating", label: "Rating" },
  { key: "follow_up_time", label: "Follow-up" },
  { key: "design_reference_links", label: "Design Reference Sites" },
  { key: "add_ons", label: "Add-ons" },
  { key: "no_email", label: "No Email" },
  { key: "logo_via_sms", label: "Logo via SMS" },
  { key: "color_same_as_logo", label: "Color Same as Logo" },
  { key: "closed_by", label: "Closed By" },
];

/**
 * Maps a `Lead` to a CSV row for `LEAD_CSV_COLUMNS`. `nameById` resolves profile ids
 * (agent_id, closed_by) to display names — pass the same map already used for agent
 * names; an id with no match falls back to the raw id. `add_ons` is flattened to
 * "Label ($price)" strings (price omitted when null) so `cell()`'s array-join ("; ")
 * applies the same way it already does for plain string-array fields like
 * `design_reference_links`.
 */
export function leadCsvRow(lead: Lead, nameById: Record<string, string>): Record<string, unknown> {
  return {
    ...lead,
    agent: (lead.agent_id && nameById[lead.agent_id]) || "Unassigned",
    add_ons: (lead.add_ons ?? []).map((a) => (a.price != null ? `${a.label} ($${a.price})` : a.label)),
    closed_by: (lead.closed_by && nameById[lead.closed_by]) || lead.closed_by || "",
  };
}
