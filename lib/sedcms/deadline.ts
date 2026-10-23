/**
 * Time limits for what SED CMS makes the LMS do to a host. SERVER ONLY.
 *
 * The CMS's publish lease assumes an apply ends within 300 s of being sent,
 * and the installed Next.js doesn't enforce maxDuration on a self-hosted
 * server, so the LMS enforces its own:
 *   - every single-file host call (Hostinger's File Browser and TUS,
 *     DirectAdmin's file manager, a Cloudflare purge batch) has its own 30 s,
 *     through an AbortSignal, in the host clients themselves;
 *   - an apply starts no host call after 240 s from when its request was
 *     accepted (lock wait included). A write already in flight then finishes
 *     within its own 30 s, so the last host activity ends by 300 s;
 *   - live-files and checksums stop at 100 s, under the CMS's 120 s timeout.
 */

export const HOST_CALL_TIMEOUT_MS = 30_000;
export const APPLY_DEADLINE_MS = 240_000;
export const READ_DEADLINE_MS = 100_000;

/**
 * A point in time after which no new host call starts. Its signal aborts at
 * that time, which stops reads and listings already in flight; writes never
 * take it, so a write is never cut in the middle.
 */
export class Deadline {
  readonly at: number;
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(at: number) {
    this.at = at;
    const ms = at - Date.now();
    if (ms <= 0) {
      this.controller.abort();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.controller.abort();
    }, ms);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Aborts when the deadline passes. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  passed(): boolean {
    return this.controller.signal.aborted || Date.now() >= this.at;
  }

  /** Stops the timer once the work is done. */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
