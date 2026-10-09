/**
 * In-process bookkeeping for answers being generated right now: one answer
 * per conversation at a time, a small cap per user, a rolling hourly budget,
 * and the handle a Stop request aborts.
 *
 * Process-local on purpose, like the provider rate gates: production is one
 * Node instance. A second instance would only weaken the per-user caps, never
 * the vendor's limits (the gate enforces those) or anyone's data scope.
 */

export const MAX_CONCURRENT_PER_USER = 2;
export const MAX_MESSAGES_PER_HOUR = 60;
const HOUR_MS = 3_600_000;

interface ActiveRun {
  userId: string;
  controller: AbortController;
}

const active = new Map<string, ActiveRun>();
const recent = new Map<string, number[]>();

export type StartRefusal = { reason: "busy" | "concurrency" | "rate"; message: string };

/** Claim the conversation for a new answer, or say why not. */
export function startRun(userId: string, conversationId: string, now = Date.now()): { controller: AbortController } | StartRefusal {
  if (active.has(conversationId)) {
    return { reason: "busy", message: "Still answering your previous message in this chat — wait for it, or press Stop." };
  }
  const mine = [...active.values()].filter((r) => r.userId === userId).length;
  if (mine >= MAX_CONCURRENT_PER_USER) {
    return { reason: "concurrency", message: `You already have ${mine} answers in progress. Wait for one to finish.` };
  }
  const stamps = (recent.get(userId) ?? []).filter((t) => now - t < HOUR_MS);
  if (stamps.length >= MAX_MESSAGES_PER_HOUR) {
    return { reason: "rate", message: `That's ${MAX_MESSAGES_PER_HOUR} messages in the last hour — the assistant needs a short break. Try again in a few minutes.` };
  }
  stamps.push(now);
  recent.set(userId, stamps);
  const controller = new AbortController();
  active.set(conversationId, { userId, controller });
  return { controller };
}

export function endRun(conversationId: string, controller: AbortController): void {
  // Only the run that claimed it may release it.
  if (active.get(conversationId)?.controller === controller) active.delete(conversationId);
}

/** Stop the conversation's answer, if this user owns one in progress. */
export function stopRun(userId: string, conversationId: string): boolean {
  const run = active.get(conversationId);
  if (!run || run.userId !== userId) return false;
  run.controller.abort("stopped by user");
  return true;
}

export function isRunning(conversationId: string): boolean {
  return active.has(conversationId);
}

/** TESTS ONLY. */
export function resetRuns(): void {
  active.clear();
  recent.clear();
}
