export function buildQuery(
  current: string,
  defaults: Record<string, string>,
  patch: Record<string, string | undefined>
): string {
  const params = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "" || v === defaults[k]) params.delete(k);
    else params.set(k, v);
  }
  return params.toString();
}
