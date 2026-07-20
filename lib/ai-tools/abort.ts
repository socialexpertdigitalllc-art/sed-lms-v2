// Cancellation primitives shared by the AI call layer and its callers.
//
// Two things live here, both deliberately dependency-free so they can be
// unit-tested without a provider, a DB or a runtime feature check:
//
//  1. `AiCallAborted` — the error a provider call throws when an EXTERNAL
//     signal (not its own timeout) cut it short. It exists so a caller's retry
//     loop can tell "the network blipped, try again" apart from "the operator
//     pressed Stop". Retrying an abort is not resilience, it is disobedience.
//  2. `combineAbortSignals` — one signal that fires when ANY of its inputs
//     fires, whichever is first. The call layer needs this because every
//     request already has a timeout controller and now may also have a
//     per-generation stop controller.

/**
 * Thrown by the provider call when an external `AbortSignal` aborted it.
 * `reason` carries whatever the aborter passed (the runner passes a
 * `GenerationAbortReason`, so the halt mode survives the trip back up).
 */
export class AiCallAborted extends Error {
  constructor(label: string, readonly reason?: unknown) {
    super(`${label} call aborted`);
    this.name = "AiCallAborted";
  }
}

/**
 * Is this error an external abort? Name-based as well as instanceof so an
 * error that crossed a module boundary (or a DOM `AbortError` surfaced by a
 * fetch we did not wrap) is still recognised as a stop, never as a blip.
 */
export function isAbortedError(e: unknown): boolean {
  if (e instanceof AiCallAborted) return true;
  return e instanceof Error && (e.name === "AiCallAborted" || e.name === "AbortError");
}

export interface CombinedSignal {
  signal: AbortSignal;
  /**
   * Detach the listeners this combination installed. MUST be called in a
   * `finally`: without it a long-lived external signal accumulates one listener
   * per call, which on a run that regenerates dozens of files is a real leak
   * (and Node warns at 11).
   */
  cleanup: () => void;
}

/**
 * The portable implementation: one controller, aborted by whichever input
 * aborts first, with the reason propagated. Exported separately from
 * `combineAbortSignals` so the fallback path is tested directly instead of
 * only on runtimes that happen to lack `AbortSignal.any`.
 */
export function combineAbortSignalsManual(signals: AbortSignal[]): CombinedSignal {
  const controller = new AbortController();
  const already = signals.find((s) => s.aborted);
  if (already) {
    controller.abort(already.reason);
    return { signal: controller.signal, cleanup: () => {} };
  }
  const onAbort = (ev: Event): void => {
    const src = ev.target as AbortSignal | null;
    controller.abort(src?.reason);
  };
  for (const s of signals) s.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const s of signals) s.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * Combine any number of (possibly undefined) signals into one. Undefined
 * entries are dropped, a single real signal is passed straight through (no
 * wrapper, nothing to clean up), and more than one goes through
 * `AbortSignal.any` when the runtime has it — falling back to
 * `combineAbortSignalsManual` otherwise. Whichever input aborts first wins.
 */
export function combineAbortSignals(signals: (AbortSignal | undefined | null)[]): CombinedSignal {
  const live = signals.filter((s): s is AbortSignal => !!s);
  if (live.length === 0) return { signal: new AbortController().signal, cleanup: () => {} };
  if (live.length === 1) return { signal: live[0], cleanup: () => {} };
  const anyOf = (AbortSignal as unknown as { any?: (list: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyOf === "function") return { signal: anyOf.call(AbortSignal, live), cleanup: () => {} };
  return combineAbortSignalsManual(live);
}
