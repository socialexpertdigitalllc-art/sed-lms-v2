/**
 * Parse JSON from an LLM response. Gemini wraps JSON in ```json fences and
 * sometimes adds prose; never JSON.parse a raw completion.
 * Returns null instead of throwing so callers can fail loudly with context.
 */
export function parseJsonLoose<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    /* fall through to extraction */
  }
  const start = s.search(/[[{]/);
  if (start === -1) return null;
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  const end = s.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
