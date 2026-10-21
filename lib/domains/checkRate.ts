// lib/domains/checkRate.ts — a per-person brake on availability checks. They
// cost registrar API calls, and anyone with domains.view can make them (sales,
// on calls). Process-local like lib/assistant/runs.ts: prod is one Node
// instance, and the registrars enforce their own limits anyway.

export const CHECKS_PER_WINDOW = 40;
const WINDOW_MS = 5 * 60_000;
const recent = new Map<string, number[]>();

/** Take one check from the person's allowance; false when it's used up. */
export function takeDomainCheck(userId: string, now = Date.now()): boolean {
  const stamps = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (stamps.length >= CHECKS_PER_WINDOW) {
    recent.set(userId, stamps);
    return false;
  }
  stamps.push(now);
  recent.set(userId, stamps);
  return true;
}

export const TOO_MANY_CHECKS = "That's a lot of checks in a few minutes — wait a moment and try again.";

/** TESTS ONLY. */
export function resetDomainChecks(): void {
  recent.clear();
}
