// lib/site-agent/diff.ts
export type DiffOp = { type: "same" | "add" | "del"; text: string };

/** Line-level LCS diff for the review screen. Site pages are small; past the
 *  guard we degrade to replace-everything rather than burn CPU in a route. */
export function lineDiff(before: string | null, after: string | null): DiffOp[] {
  // Line-ending differences are presentation, not content — a CRLF live site
  // vs the agent's LF output must not read as a full-file rewrite. Also note
  // the ""-vs-null convention: "" is one empty line (a real, empty file);
  // null is absence. Callers must not conflate the two.
  const a = before === null ? [] : before.split(/\r\n|\r|\n/);
  const b = after === null ? [] : after.split(/\r\n|\r|\n/);
  // One side empty (created/deleted file): the answer is trivially all-add /
  // all-del — skip the DP entirely (the m*n size guard below is blind here).
  if (a.length === 0 || b.length === 0) {
    return [...a.map((text) => ({ type: "del" as const, text })), ...b.map((text) => ({ type: "add" as const, text }))];
  }
  if (a.length * b.length > 25_000_000) {
    return [...a.map((text) => ({ type: "del" as const, text })), ...b.map((text) => ({ type: "add" as const, text }))];
  }
  const m = a.length, n = b.length;
  const lcs = new Uint32Array((m + 1) * (n + 1));
  const at = (i: number, j: number) => lcs[i * (n + 1) + j];
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
    lcs[i * (n + 1) + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
  }
  const out: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i] }); i++; j++; }
    else if (at(i + 1, j) >= at(i, j + 1)) { out.push({ type: "del", text: a[i] }); i++; }
    else { out.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < m) out.push({ type: "del", text: a[i++] });
  while (j < n) out.push({ type: "add", text: b[j++] });
  return out;
}
