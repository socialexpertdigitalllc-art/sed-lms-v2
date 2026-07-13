/**
 * If `values[index]` contains commas, split it into trimmed non-empty parts and
 * splice them in at that position. Returns a NEW array, or null if no change
 * (no comma at that index). If every part is empty (e.g. ",,"), a single ""
 * is kept at that position so the row doesn't vanish under the user.
 */
export function splitCommaRow(values: string[], index: number): string[] | null {
  const v = values[index];
  if (typeof v !== "string" || !v.includes(",")) return null;
  const parts = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const replacement = parts.length > 0 ? parts : [""];
  return [...values.slice(0, index), ...replacement, ...values.slice(index + 1)];
}
