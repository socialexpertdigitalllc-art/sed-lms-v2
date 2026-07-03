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
