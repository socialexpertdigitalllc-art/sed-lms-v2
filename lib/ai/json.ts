/**
 * Parse JSON from an LLM response. Gemini wraps JSON in ```json fences and
 * sometimes adds prose; never JSON.parse a raw completion.
 * Returns null instead of throwing so callers can fail loudly with context.
 */

// Ceiling on candidate start offsets the extraction scan will consider, so
// adversarial input (e.g. a long run of "{{{{") cannot blow up. Real prose
// carries far fewer bracket tokens than this ahead of the payload, and the
// plain/fenced fast path never reaches the scan at all.
const MAX_CANDIDATE_STARTS = 200;

/**
 * Index of the bracket closing the value that opens at `start`, or -1 if it
 * never balances. String-aware: brackets inside "..." are literal text, not
 * structure, so {"note":"use } carefully"} closes at the last brace.
 */
function balancedEnd(s: string, start: number): number {
  const close = s[start] === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (--depth === 0) return c === close ? i : -1;
      if (depth < 0) return -1;
    }
  }
  return -1; // Ran off the end: truncated. Never return a partial value.
}

export function parseJsonLoose<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s) as T; // Fast path: plain or cleanly fenced JSON.
  } catch {
    /* fall through to extraction */
  }

  // Extraction: collect every balanced, parseable value and keep the largest.
  // Size is the tiebreak that matters — a bare "[1]" prose citation must never
  // outrank the real payload just by appearing first. Equal sizes resolve to
  // the earliest, so the first of two fenced blocks wins.
  let best: { value: T; len: number } | null = null;
  let starts = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "{" && c !== "[") continue;
    if (++starts > MAX_CANDIDATE_STARTS) break;
    const end = balancedEnd(s, i);
    if (end === -1) continue;
    const slice = s.slice(i, end + 1);
    try {
      const value = JSON.parse(slice) as T;
      if (!best || slice.length > best.len) best = { value, len: slice.length };
      i = end; // A nested value can never beat the container that just parsed.
    } catch {
      /* Not a value. Try the next start, including ones inside this span. */
    }
  }
  return best ? best.value : null;
}
