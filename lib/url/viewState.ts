/** Overlay query-string params onto defaults; keys not in defaults are ignored. */
export function parseViewState<T extends Record<string, string>>(defaults: T, qs: string): T {
  const out = { ...defaults };
  const sp = new URLSearchParams(qs);
  for (const key of Object.keys(defaults)) {
    const v = sp.get(key);
    if (v !== null) (out as Record<string, string>)[key] = v;
  }
  return out;
}

/** Filter a stored JSON blob down to known string-valued keys (null if unusable). */
export function pickStoredView<T extends Record<string, string>>(
  defaults: T,
  raw: string | null
): Partial<T> | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out: Record<string, string> = {};
  for (const key of Object.keys(defaults)) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === "string") out[key] = v;
  }
  return out as Partial<T>;
}
