/**
 * Live output registry: what each generating page has streamed so far.
 *
 * `runId → file → { chars, lastChunkAt, tail }` — fed a delta at a time by
 * `generateRunNow`'s `onOutput` wiring, read whole by the polled
 * `GET /api/site-builder/runs/[id]/live` route so the run screen can show
 * "the model is 34,000 chars into this page and last spoke 3s ago" instead
 * of a spinner that cannot tell writing from wedged.
 *
 * MODULE-LEVEL AND IN-MEMORY IS CORRECT HERE, for the same single-process
 * reason as the rate gate's registry (lib/ai-tools/providers/gate.ts, "the
 * registry" section): production is one long-lived `next start` process and
 * every site-builder route pins the nodejs runtime, so the route that reads
 * this Map shares it with the engine that writes it. The same caveat carries
 * over too — putting the live route on a different server runtime would give
 * it an empty Map of its own. Persisting this instead would mean a row write
 * per streamed delta for data that is worthless minutes later.
 *
 * A restart loses the tail, NEVER the run: the run's real progress lives on
 * its `builder_runs` row (`pages`), and this registry is rebuilt from the
 * next delta of the next attempt. `clearLive` runs on claim and on every
 * exit of a generation attempt, so a snapshot never describes an attempt
 * that is not the live one.
 */

/** Tail cap, in characters — enough raw output to see what the model is
 *  doing, small enough that a 2s poll of a many-page run stays cheap. */
const TAIL_MAX_CHARS = 2048;

export interface LiveFileProgress {
  /** Total streamed characters so far — monotonically growing, unlike the tail. */
  chars: number;
  /** Epoch ms of the last delta — the client derives "idle seconds" from this
   *  and the route's own `now`, so clock skew cancels out. */
  lastChunkAt: number;
  /** The LAST ~2KB of raw output, for the expandable live view. */
  tail: string;
}

const registry = new Map<string, Map<string, LiveFileProgress>>();

/** Record one streamed delta of one file's generation. Empty deltas are
 *  ignored — they carry no output and would only stamp a fake liveness. */
export function recordOutput(runId: string, file: string, delta: string): void {
  if (!delta) return;
  let files = registry.get(runId);
  if (!files) {
    files = new Map();
    registry.set(runId, files);
  }
  const prev = files.get(file);
  files.set(file, {
    chars: (prev?.chars ?? 0) + delta.length,
    lastChunkAt: Date.now(),
    tail: ((prev?.tail ?? "") + delta).slice(-TAIL_MAX_CHARS),
  });
}

export interface LiveFileSnapshot extends LiveFileProgress {
  file: string;
}

/** The run's current live output as plain JSON — files sorted by name so the
 *  polled list never reorders between frames. Empty for an unknown run. */
export function liveSnapshot(runId: string): LiveFileSnapshot[] {
  const files = registry.get(runId);
  if (!files) return [];
  return [...files.entries()]
    .map(([file, p]) => ({ file, ...p }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/** Forget a run's live output — on claim (a fresh attempt must not show a
 *  previous attempt's tail) and on every exit of a generation attempt. */
export function clearLive(runId: string): void {
  registry.delete(runId);
}
