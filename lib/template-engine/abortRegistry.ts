// In-process registry of the live generations' stop controllers.
//
// WHY THIS EXISTS. Control used to be purely cooperative: /pause wrote a flag,
// the runner noticed it at its next checkpoint. Between checkpoints sits a
// 30-90s AI call, so "stop" could take a minute and a half to visibly do
// anything. The product requirement is that stop means stop, so the flag is no
// longer the mechanism — it is the FALLBACK. The mechanism is this map: the
// runner registers its `AbortController` under the generation id, and the
// pause/cancel routes abort it directly. On this deployment the API request and
// the runner share one Node process, so that path is a function call: the
// in-flight fetch rejects in milliseconds.
//
// The map is module-level, i.e. per-process. That is exactly the right scope
// (an AbortController cannot cross a process boundary anyway) and exactly why
// the DB watcher in control.ts still exists: a run whose process was replaced,
// or whose stop request landed on a different instance, is stopped by polling
// the `control` column instead. Both paths converge on the same controller.
//
// Everything here is synchronous and side-effect-free apart from the map, so
// the whole file is unit-tested without a DB, a runner or an AI call.

import type { HaltMode } from "./control";

/**
 * The abort `reason` the runner passes. Carrying the mode on the reason is what
 * lets a stop that surfaced from six layers down (fetch -> provider call ->
 * callForTask -> regenerateFile -> the concurrency pool -> the phase catch)
 * still know whether it was a pause or a cancel, without any of those layers
 * threading a second parameter.
 */
export class GenerationAbortReason extends Error {
  constructor(readonly mode: HaltMode) {
    super(`Generation ${mode === "pause" ? "paused" : "cancelled"} by operator`);
    this.name = "GenerationAbortReason";
  }
}

const controllers = new Map<string, AbortController>();

/**
 * Claim the slot for a generation about to run and hand back its controller.
 * The caller MUST pass that same controller to `unregisterGeneration` in a
 * `finally` — a leaked entry would let a later stop abort a controller nobody
 * is listening to, and would pin the object forever on a long-lived server.
 *
 * A pre-existing entry (two runners for one generation — a bug, but not one
 * worth crashing a paid run over) is replaced, so the newest runner is the one
 * a stop reaches.
 */
export function registerGeneration(generationId: string): AbortController {
  const controller = new AbortController();
  controllers.set(generationId, controller);
  return controller;
}

/**
 * Release the slot. The `controller` argument is a guard, not decoration: if
 * the slot has since been claimed by a newer runner, this call must not delete
 * that newer runner's entry when the older one finally unwinds.
 */
export function unregisterGeneration(generationId: string, controller?: AbortController): void {
  const current = controllers.get(generationId);
  if (!current) return;
  if (controller && current !== controller) return;
  controllers.delete(generationId);
}

/**
 * Stop a running generation NOW. Returns false when no runner for it lives in
 * this process (nothing was aborted) — the caller then relies on the `control`
 * column, which the DB watcher in the owning process picks up within ~1.5s.
 * Aborting an already-aborted controller is a no-op and reports false, so a
 * double-click cannot overwrite a pause with a cancel mid-unwind.
 */
export function abortGeneration(generationId: string, mode: HaltMode): boolean {
  const controller = controllers.get(generationId);
  if (!controller || controller.signal.aborted) return false;
  controller.abort(new GenerationAbortReason(mode));
  return true;
}

/**
 * Read the halt mode off an aborted signal. `null` when the signal is still
 * live. An abort with an unrecognised reason (something aborted the controller
 * that was not us) is treated as a cancel: the run must not be left believing
 * it can resume from work that was interrupted for an unknown reason.
 */
export function haltModeOf(signal: AbortSignal): HaltMode | null {
  if (!signal.aborted) return null;
  const reason: unknown = signal.reason;
  return reason instanceof GenerationAbortReason ? reason.mode : "cancel";
}

/** Is a runner for this generation live in THIS process? */
export function isGenerationRegistered(generationId: string): boolean {
  return controllers.has(generationId);
}

/** How many runners this process is tracking — the leak check, for tests. */
export function registeredGenerationCount(): number {
  return controllers.size;
}

/** Test-only reset. Never call from application code. */
export function clearAbortRegistry(): void {
  controllers.clear();
}
