/**
 * Pure validators for the image-curation APIs (Phase 2, Task 5).
 *
 * The four curation routes (`more`, `select`, `custom`, `build`) each need a
 * small decision rule that touches neither the network nor the database —
 * whether a proposed `/select` is legal, how a `/custom` url earns a spot in
 * a capacity-limited slot, whether a fetched content-type/size counts as "a
 * real image", and which slots still need an operator pick before `/build`
 * can queue a run. Keeping these here (rather than inline in the route
 * handlers) makes them independently unit-testable; the routes themselves
 * are thin auth + I/O wrappers around this logic, which is why they carry no
 * unit tests of their own (see the plan's Task 6 for their live verification).
 */

import type { ImageSlot } from "./imageSlots";

/**
 * Validate a `/select` request against one slot: every url must already be a
 * candidate on the slot (an operator can only choose from what was gathered
 * — injecting an arbitrary url is `/custom`'s job, with its own fetch
 * validation), and the count must respect the slot's `pick_max`. Returns a
 * human-readable error, or null when the selection is legal.
 */
export function validateSelection(slot: ImageSlot, urls: string[]): string | null {
  if (urls.length > slot.pick_max) {
    return `Too many images selected: this slot allows at most ${slot.pick_max}`;
  }
  const candidateUrls = new Set(slot.candidates.map((c) => c.url));
  const invalid = urls.filter((u) => !candidateUrls.has(u));
  if (invalid.length > 0) {
    return `Not a candidate on this slot: ${invalid.join(", ")}`;
  }
  return null;
}

/**
 * Add a freshly-validated custom url to a slot's `selected` list, respecting
 * `pick_max`. A custom photo is a deliberate, explicit operator choice, so it
 * always earns a spot; when the slot is already at capacity we evict from
 * the FRONT (the oldest pick) rather than the back, so the newest decision —
 * the one the operator is actively making right now — is the one that
 * survives. A url that's already selected is a no-op (never a duplicate
 * entry).
 */
export function addCustomSelection(selected: string[], url: string, pickMax: number): string[] {
  if (selected.includes(url)) return selected;
  const next = [...selected, url];
  return next.length > pickMax ? next.slice(next.length - pickMax) : next;
}

/** A generous ceiling for a custom image url — big enough for any real stock/web photo, small enough to block a pathologically huge upload. */
export const MAX_CUSTOM_IMAGE_BYTES = 15 * 1024 * 1024;

/** True when a fetched `content-type` header reads as an image (case/whitespace-insensitive; ignores a trailing `; charset=...`). */
export function contentTypeIsImage(contentType: string | null | undefined): boolean {
  return !!contentType && contentType.trim().toLowerCase().startsWith("image/");
}

/** True when a fetched size is unknown (null — many CDNs omit content-length) or within the sane ceiling. */
export function sizeIsSane(bytes: number | null, maxBytes: number = MAX_CUSTOM_IMAGE_BYTES): boolean {
  return bytes === null || bytes <= maxBytes;
}

/**
 * Only http(s) urls are accepted for a custom image. `/custom` fetches
 * whatever url the operator supplies from the SERVER, so an unrestricted
 * scheme would let `file://`, `data:`, or similar be handed to `fetch` —
 * this closes that off before any request is made. An unparseable string is
 * also rejected (zod's `.url()` should already catch that upstream, but this
 * stays defensive on its own).
 */
export function isHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Which slots still lack an operator pick — the `/build` gate: every slot
 * needs `selected.length >= 1` before a build can be queued (runnerV2's
 * `imagesForFileFrom` falls back to a slot's top candidate only as a last
 * resort against a data gap; the operator should never be surprised by a
 * picture they never actually chose). Returns `{id, label}` for each empty
 * slot so the API can report exactly what's still missing.
 */
export function emptySlots(slots: ImageSlot[]): { id: string; label: string }[] {
  return slots.filter((s) => s.selected.length === 0).map((s) => ({ id: s.id, label: s.label }));
}
