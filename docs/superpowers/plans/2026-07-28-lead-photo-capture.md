# Lead Photo Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture up to 30 photos from a lead's Google Business Profile using the agent's own browser, let the agent pick which ones to keep, re-host them through a fallback chain of image hosts, and store the direct URLs in `leads.image_links`.

**Architecture:** The existing `photo-extractor` Chrome extension becomes the capture arm — a content script on the LMS origin announces itself over `window.postMessage`, and the service worker opens an unfocused popup window at the profile URL and drives the existing `googleAdapter`. Harvested URLs are stored as candidate rows; selected candidates are uploaded **server-side** (so credentials never reach a browser) through an ordered host chain modelled on the existing `lib/email-verify/providers/chain.ts`.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19, Supabase (service-role admin client), zod, vitest for the LMS; a Manifest V3 extension with `node --test` for pure logic.

**Read first:** [the design](../specs/2026-07-28-lead-photo-capture-design.md). Section numbers referenced below (§4, §8 …) point at it.

---

## File Structure

**Extension** (`photo-extractor/`)

| File | Responsibility |
|---|---|
| `core/collect-filter.js` (new) | Pure: is a DOM box actually rendered; parse the place key out of a Maps URL. Tested. |
| `core/capture.js` (new) | Pure: cap and normalise harvested items into the wire shape. Tested. |
| `content/content.js` (modify) | Scope collection to the live gallery; reset on place change. |
| `content/lms-bridge.js` (new) | Content script on the LMS origin. `postMessage` ⇄ service worker relay. |
| `background/service-worker.js` (modify) | Capture orchestration: open popup window, drive adapter, close, reply. |
| `manifest.json` (modify) | `key`, LMS content script + host permission, version bump. |
| `sidepanel/sidepanel.js` (modify) | Clear the stale selection between runs. |

**LMS server**

| File | Responsibility |
|---|---|
| `lib/photo-capture/googleLink.ts` | Pure: is this a Google Business Profile URL. |
| `lib/photo-capture/hosts/types.ts` | `ImageHost`, `UploadAdapter`, `HostStateStore`, result types. |
| `lib/photo-capture/hosts/order.ts` | Pure: provider rank → position ordering, cooldown filtering. |
| `lib/photo-capture/hosts/errors.ts` | Pure: HTTP status/message → `quota` \| `auth` \| `error`. |
| `lib/photo-capture/hosts/imgbb.ts` | imgbb adapter (uploads **by URL** — no bytes transferred). |
| `lib/photo-capture/hosts/postimages.ts` | postimages adapter + pure token/og:image parsers. |
| `lib/photo-capture/hosts/imgchest.ts` | imgchest adapter (Bearer, multipart). |
| `lib/photo-capture/hosts/chain.ts` | `runUploadChain` — the fallback loop. |
| `lib/photo-capture/hosts/config.ts` | DB CRUD + AES-GCM encryption. Server only. |
| `lib/photo-capture/store.ts` | Captures/candidates DB access. Server only. |
| `app/api/leads/[id]/photos/route.ts` | GET capture state + candidates. |
| `app/api/leads/[id]/photos/candidates/route.ts` | POST harvest results. |
| `app/api/leads/[id]/photos/upload/route.ts` | POST selected keys → chain → `image_links`. |
| `app/api/admin/image-hosts/route.ts`, `[id]/route.ts` | Key management. |
| `app/api/extension/version/route.ts` | Current version + download path. |

**LMS client**

| File | Responsibility |
|---|---|
| `hooks/usePhotoExtension.ts` | Bridge client: handshake, version, `capture()`. |
| `components/leads/LeadPhotoPicker.tsx` | Thumbnail grid, selection, upload button. |
| `components/leads/ExtensionInstallCard.tsx` | Install / update card. |
| `components/admin/ImageHostsPanel.tsx` | Key management UI. |
| `app/(app)/admin/image-hosts/page.tsx` | Admin page shell. |
| `scripts/build-extension.mjs` | Zip the extension into `public/downloads/`. |

---

## Phase 1 — Extension in git, and the two bugs

### Task 1: Commit the extension and fix the stale-selection bug

The extension folder is currently untracked. Nothing downstream (the build script, the version route) can work until it is in git.

**Files:**
- Modify: `photo-extractor/sidepanel/sidepanel.js:149`

- [ ] **Step 1: Confirm the folder is untracked**

Run: `git status --short photo-extractor`
Expected: `?? photo-extractor/`

- [ ] **Step 2: Verify the extension's own tests pass before you touch anything**

Run: `cd photo-extractor && npm test`
Expected: all tests pass. If they do not, stop and report — you are not starting from a clean base.

- [ ] **Step 3: Commit the extension as-is**

```bash
git add photo-extractor
git commit -m "chore(photo-extractor): track the extension in git"
```

- [ ] **Step 4: Fix the selection leak**

In `photo-extractor/sidepanel/sidepanel.js`, `onLoadAll` starts at line 149. Add the clear as the first statement of the function body, immediately before `el('loadBtn').disabled = true;`:

```js
async function onLoadAll() {
  // Each run is a different business: a selection carried over from the last
  // one inflates the "N selected" count with ids that are no longer on screen.
  state.selected.clear();
  el('loadBtn').disabled = true;
```

- [ ] **Step 5: Commit**

```bash
git add photo-extractor/sidepanel/sidepanel.js
git commit -m "fix(photo-extractor): clear the selection between runs"
```

---

### Task 2: Confirm the stale-photo diagnosis before changing collection

The design (§11) says the leak is retained hidden DOM from the previously viewed place. **Do not skip this.** If the numbers do not match, the fix in Task 3 is wrong and you must report back rather than proceed.

**Files:** none — this is a measurement.

- [ ] **Step 1: Reproduce**

1. Load the extension unpacked (`chrome://extensions` → Developer mode → Load unpacked → `photo-extractor`).
2. Open a business on Google Maps, open its Photos gallery, run **Load all photos**. Note the count.
3. **Without reloading the tab**, navigate to a different business and open its gallery. Run **Load all photos** again.
4. Confirm the reported symptom: a handful of the first business's photos appear in the second run's grid.

- [ ] **Step 2: Measure the gap in the page console (F12)**

```js
// Whole document — what collect() sees today
document.querySelectorAll('img[src*="googleusercontent"], [style*="googleusercontent"]').length
```

```js
// Only nodes that are actually rendered right now
[...document.querySelectorAll('img[src*="googleusercontent"], [style*="googleusercontent"]')]
  .filter(el => el.getBoundingClientRect().width > 0 && el.offsetParent !== null).length
```

Expected: the first number exceeds the second by roughly 5–6 — the retained place card.

- [ ] **Step 3: Record the finding**

Write the two numbers into the task's completion note. If the gap is ~0, the hypothesis is wrong: the leak is elsewhere (start with whether `adapter.collect()` is being called against a stale `adapter` reference) and you should report before writing code.

---

### Task 3: Scope collection to the live gallery

**Files:**
- Create: `photo-extractor/core/collect-filter.js`
- Create: `photo-extractor/test/collect-filter.test.js`
- Modify: `photo-extractor/content/content.js`

- [ ] **Step 1: Write the failing test**

Create `photo-extractor/test/collect-filter.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRenderedBox, placeKeyFromUrl } from '../core/collect-filter.js';

test('a laid-out node with an offset parent is rendered', () => {
  assert.equal(isRenderedBox({ width: 120, height: 90, hasOffsetParent: true }), true);
});

test('a zero-width node is not rendered', () => {
  assert.equal(isRenderedBox({ width: 0, height: 90, hasOffsetParent: true }), false);
});

test('a zero-height node is not rendered', () => {
  assert.equal(isRenderedBox({ width: 120, height: 0, hasOffsetParent: true }), false);
});

test('a detached / display:none node is not rendered', () => {
  assert.equal(isRenderedBox({ width: 120, height: 90, hasOffsetParent: false }), false);
});

test('reads the place key from a maps place url', () => {
  const u = 'https://www.google.com/maps/place/Joe+Plumbing/@40.7,-73.9,17z/data=!3m1!4b1!4m6';
  assert.equal(placeKeyFromUrl(u), 'Joe+Plumbing');
});

test('reads the place key from a data-only url', () => {
  const u = 'https://www.google.com/maps/place/data=!4m2!3m1!1s0x89c25a:0xabc';
  assert.equal(placeKeyFromUrl(u), 'data=!4m2!3m1!1s0x89c25a:0xabc');
});

test('returns null when there is no place segment', () => {
  assert.equal(placeKeyFromUrl('https://www.google.com/maps/@40.7,-73.9,12z'), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd photo-extractor && node --test test/collect-filter.test.js`
Expected: FAIL — `Cannot find module '../core/collect-filter.js'`.

- [ ] **Step 3: Write the implementation**

Create `photo-extractor/core/collect-filter.js`:

```js
// Pure helpers for scoping photo collection to the LIVE gallery.
// No DOM/chrome dependencies — unit-testable under node --test.
//
// WHY THIS EXISTS. Google Maps is a single-page app: navigating from one
// business to another never reloads the document, and Maps keeps the previous
// place card in the DOM (hidden) for back-navigation. A document-wide scan
// therefore picks up ~5-6 photos belonging to the business you just left.

/** True when a box is actually laid out on screen right now. */
export function isRenderedBox({ width, height, hasOffsetParent }) {
  return width > 0 && height > 0 && hasOffsetParent === true;
}

/**
 * Identifies which place a Maps URL is showing, so a change can reset state.
 * Returns null when the URL is not on a place (e.g. a bare map view).
 */
export function placeKeyFromUrl(href) {
  const m = String(href).match(/\/maps\/place\/([^/@?#]+)/);
  return m ? m[1] : null;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd photo-extractor && node --test test/collect-filter.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Apply the fix in the content script**

`content/content.js` is a self-contained classic script — it cannot import. Mirror the helpers, exactly as the file already mirrors `core/url-tools.js`.

Add after the `makeMonitor` block (around line 40):

```js
  // ---- render/scope helpers (mirror core/collect-filter.js) ----
  const isRendered = (el) => {
    try {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.offsetParent !== null;
    } catch { return false; }
  };
  const placeKey = (href) => { const m = String(href).match(/\/maps\/place\/([^/@?#]+)/); return m ? m[1] : null; };
```

Replace `googleAdapter.collect()` (currently lines 75-85) with a version that searches only inside the live gallery container and only rendered nodes:

```js
    collect() {
      const map = new Map();
      const add = (u) => { if (!isGoogle(u)) return; const id = gId(u); if (id && !map.has(id)) map.set(id, u); };
      // Scope: the scroll container IS the live gallery. Falling back to
      // document keeps a first-run-before-scroll case working, but the
      // isRendered() filter still drops the retained previous place card.
      let root;
      try { root = this.getScrollContainer(); } catch { root = null; }
      if (!root || !root.querySelectorAll) root = document;
      for (const img of root.querySelectorAll('img[src*="googleusercontent"]')) {
        if (isRendered(img)) add(img.currentSrc || img.src);
      }
      for (const el of root.querySelectorAll('[style*="googleusercontent"], [role="img"], button[jsaction*="pane"] div, a[data-photo-index] div')) {
        if (!isRendered(el)) continue;
        const inl = (el.getAttribute && el.getAttribute('style')) || ''; let m = inl.match(G_BG);
        if (!m) { try { m = getComputedStyle(el).backgroundImage.match(G_BG); } catch { m = null; } }
        if (m) add(m[1]);
      }
      return map;
    },
```

In `loadAll()`, reset the adapter when the place changes. Replace the first two lines of `loadAll` (currently `adapter = pick();` and the `prepare` line) with:

```js
  let lastPlace = null;

  async function loadAll() {
    adapter = pick();
    const here = placeKey(location.href);
    if (here !== lastPlace) { lastPlace = here; }
    try { if (adapter.prepare) await adapter.prepare(); } catch { /* best-effort */ }
```

(`lastPlace` goes just above `async function loadAll()`, inside the same IIFE.)

- [ ] **Step 6: Re-run the full extension suite**

Run: `cd photo-extractor && npm test`
Expected: all tests pass, including the 7 new ones.

- [ ] **Step 7: Verify against the real bug**

Repeat Task 2's reproduction: two businesses, one tab, no reload. Expected: the second run shows **only** the second business's photos. Record the before/after counts.

- [ ] **Step 8: Commit**

```bash
git add photo-extractor/core/collect-filter.js photo-extractor/test/collect-filter.test.js photo-extractor/content/content.js
git commit -m "fix(photo-extractor): collect only the live gallery, not retained DOM"
```

---

## Phase 2 — The upload chain

### Task 4: Host ordering

**Files:**
- Create: `lib/photo-capture/hosts/types.ts`
- Create: `lib/photo-capture/hosts/order.ts`
- Create: `tests/photoHostOrder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/photoHostOrder.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { orderHosts, PROVIDER_RANK } from "@/lib/photo-capture/hosts/order";
import type { ImageHost } from "@/lib/photo-capture/hosts/types";

function host(p: Partial<ImageHost> & Pick<ImageHost, "id" | "provider">): ImageHost {
  return {
    label: p.id,
    position: 0,
    enabled: true,
    exhaustedUntil: null,
    credentials: { api_key: "k" },
    ...p,
  } as ImageHost;
}

const NOW = new Date("2026-07-28T12:00:00Z");

describe("orderHosts", () => {
  it("puts imgbb before postimages before imgchest", () => {
    expect(PROVIDER_RANK).toEqual({ imgbb: 0, postimages: 1, imgchest: 2 });
    const out = orderHosts(
      [host({ id: "c", provider: "imgchest" }), host({ id: "p", provider: "postimages" }), host({ id: "b", provider: "imgbb" })],
      NOW
    );
    expect(out.map((h) => h.id)).toEqual(["b", "p", "c"]);
  });

  it("orders keys within a provider by position, i.e. the order they were added", () => {
    const out = orderHosts(
      [host({ id: "second", provider: "imgbb", position: 1 }), host({ id: "first", provider: "imgbb", position: 0 })],
      NOW
    );
    expect(out.map((h) => h.id)).toEqual(["first", "second"]);
  });

  it("drops disabled hosts", () => {
    const out = orderHosts([host({ id: "off", provider: "imgbb", enabled: false })], NOW);
    expect(out).toEqual([]);
  });

  it("drops hosts still cooling down", () => {
    const out = orderHosts(
      [host({ id: "cooling", provider: "imgbb", exhaustedUntil: new Date("2026-07-28T12:30:00Z") })],
      NOW
    );
    expect(out).toEqual([]);
  });

  it("readmits a host once its cooldown has passed", () => {
    const out = orderHosts(
      [host({ id: "back", provider: "imgbb", exhaustedUntil: new Date("2026-07-28T11:59:00Z") })],
      NOW
    );
    expect(out.map((h) => h.id)).toEqual(["back"]);
  });

  it("breaks a position tie deterministically by id", () => {
    const out = orderHosts(
      [host({ id: "b", provider: "imgbb" }), host({ id: "a", provider: "imgbb" })],
      NOW
    );
    expect(out.map((h) => h.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/photoHostOrder.test.ts`
Expected: FAIL — cannot resolve `@/lib/photo-capture/hosts/order`.

- [ ] **Step 3: Write the types**

Create `lib/photo-capture/hosts/types.ts`:

```ts
/** The three image hosts, in the fixed fallback order (see the design, §8). */
export type HostProvider = "imgbb" | "postimages" | "imgchest";

/** One configured credential slot. postimages has no API, so its rows carry no credentials. */
export type ImageHost = {
  id: string;
  provider: HostProvider;
  label: string;
  /** Insertion order within a provider. Lower goes first. */
  position: number;
  enabled: boolean;
  /** Set when the host reported a limit; it rejoins the chain after this. */
  exhaustedUntil: Date | null;
  /** Decrypted. NEVER serialise into an HTTP response. */
  credentials: Record<string, string> | null;
};

/** Why an upload attempt failed, which decides what we do to the host. */
export type UploadFailure = "quota" | "auth" | "error";

/**
 * One photo to upload. `fetchBytes` is lazy on purpose: imgbb accepts a URL and
 * fetches the image itself, so that path must never download anything.
 */
export type UploadSource = {
  url: string;
  filename: string;
  fetchBytes: () => Promise<Buffer>;
};

export type UploadResult =
  | { ok: true; directUrl: string }
  | { ok: false; reason: UploadFailure; message: string };

export type UploadAdapter = {
  provider: HostProvider;
  /** False for postimages, which needs no key at all. */
  needsCredentials: boolean;
  isConfigured(credentials: Record<string, string> | null): boolean;
  upload(source: UploadSource, ctx: { credentials: Record<string, string> | null }): Promise<UploadResult>;
};

/** Persistence the chain needs. Injected so the chain is unit-testable. */
export type HostStateStore = {
  markExhausted(hostId: string, until: Date, message: string): Promise<void>;
  markAuthFailed(hostId: string, message: string): Promise<void>;
  recordSuccess(hostId: string): Promise<void>;
};
```

- [ ] **Step 4: Write the ordering**

Create `lib/photo-capture/hosts/order.ts`:

```ts
import type { HostProvider, ImageHost } from "./types";

/**
 * The fallback order is a product decision, not a config value: imgbb first
 * (it uploads by URL, so we transfer no bytes), then postimages, then imgchest.
 */
export const PROVIDER_RANK: Record<HostProvider, number> = {
  imgbb: 0,
  postimages: 1,
  imgchest: 2,
};

/**
 * Usable hosts, in the order the chain must try them. Pure, so the rule is
 * testable without a database.
 */
export function orderHosts(hosts: ImageHost[], now: Date): ImageHost[] {
  return hosts
    .filter((h) => h.enabled)
    .filter((h) => !h.exhaustedUntil || h.exhaustedUntil.getTime() <= now.getTime())
    .slice()
    .sort(
      (a, b) =>
        PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider] ||
        a.position - b.position ||
        a.id.localeCompare(b.id)
    );
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run tests/photoHostOrder.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/photo-capture/hosts/types.ts lib/photo-capture/hosts/order.ts tests/photoHostOrder.test.ts
git commit -m "feat(photo-capture): image host ordering and chain types"
```

---

### Task 5: Error classification

A rate limit and a dead key look similar and must be treated oppositely: a limit earns a cooldown, a bad key earns disablement (§8).

**Files:**
- Create: `lib/photo-capture/hosts/errors.ts`
- Create: `tests/photoHostErrors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/photoHostErrors.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { classifyUploadError } from "@/lib/photo-capture/hosts/errors";

describe("classifyUploadError", () => {
  it("treats 429 as a quota problem", () => {
    expect(classifyUploadError({ status: 429 })).toBe("quota");
  });

  it("treats an imgchest X-RateLimit-Remaining of 0 as quota, whatever the status", () => {
    expect(classifyUploadError({ status: 200, rateLimitRemaining: "0" })).toBe("quota");
  });

  it("does not treat remaining headroom as quota", () => {
    expect(classifyUploadError({ status: 500, rateLimitRemaining: "42" })).toBe("error");
  });

  it("treats 401 as an auth problem", () => {
    expect(classifyUploadError({ status: 401 })).toBe("auth");
  });

  it("does NOT let a 403 block page disable a host", () => {
    // An `auth` verdict disables the host with no cooldown. A WAF or geo-block
    // returns 403; none of the three providers reports a bad credential that
    // way. So a bare 403 must stay `error`.
    expect(classifyUploadError({ status: 403, message: "Access Forbidden" })).toBe("error");
  });

  it("still catches each provider's real credential failure", () => {
    expect(classifyUploadError({ status: 400, message: "Invalid API key" })).toBe("auth"); // imgbb
    expect(classifyUploadError({ status: 401, message: "Unauthenticated." })).toBe("auth"); // imgchest
    expect(classifyUploadError({ status: 400, message: "invalid key" })).toBe("auth");
  });

  it("reads a quota verdict out of the message when the status does not say so", () => {
    expect(classifyUploadError({ status: 400, message: "Rate limit exceeded" })).toBe("quota");
    expect(classifyUploadError({ status: 400, message: "Too many requests, slow down" })).toBe("quota");
    expect(classifyUploadError({ status: 400, message: "Daily quota reached" })).toBe("quota");
  });

  it("reads an auth verdict out of the message", () => {
    expect(classifyUploadError({ status: 400, message: "Invalid API key" })).toBe("auth");
    expect(classifyUploadError({ status: 400, message: "invalid token" })).toBe("auth");
  });

  it("falls back to a plain error for anything else", () => {
    expect(classifyUploadError({ status: 500, message: "Internal Server Error" })).toBe("error");
    expect(classifyUploadError({ status: 0, message: "network down" })).toBe("error");
    expect(classifyUploadError({ status: 400 })).toBe("error");
  });

  it("does not mistake a file-size error for a quota error", () => {
    // Google originals at =s0 routinely approach imgbb's 32 MB ceiling. Parking
    // a healthy key for an hour because one photo was too big would be far
    // worse than the retry this gets instead.
    expect(classifyUploadError({ status: 400, message: "maximum file size exceeded" })).toBe("error");
  });

  it("still catches the genuine quota phrasings after that narrowing", () => {
    expect(classifyUploadError({ status: 400, message: "quota exceeded" })).toBe("quota");
    expect(classifyUploadError({ status: 400, message: "API limit exceeded" })).toBe("quota");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/photoHostErrors.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

Create `lib/photo-capture/hosts/errors.ts`:

```ts
import type { UploadFailure } from "./types";

// NOTE the absence of a bare `exceeded` alternative. It would match imgbb's
// real "maximum file size exceeded" error and park a perfectly healthy key for
// an hour — and Google originals at =s0 routinely approach imgbb's 32 MB
// ceiling, so it would fire in normal use. A size error must stay `error` and
// take the retry. The genuine quota phrasings are all still covered:
// "rate limit exceeded" by `rate limit`, "quota exceeded" by `quota`,
// "API limit exceeded" by `limit exceeded`.
const QUOTA_RE = /rate limit|too many requests|quota|limit reached|limit exceeded/i;
// Deliberately credential-SPECIFIC. The bare words `forbidden` and
// `unauthorized` are absent because an `auth` verdict disables a host with no
// cooldown — a human has to re-enable it — and those words appear in plenty of
// non-credential failures (WAF block pages, proxy errors, policy rejections).
const AUTH_RE = /invalid api ?key|invalid key|invalid token|unauthenticated|api ?key (?:is )?(?:missing|required|invalid)/i;

/**
 * Decide what a failed upload means for the HOST, not the photo.
 *
 * - `quota` → park the host for a cooldown; it comes back by itself.
 * - `auth`  → disable the host; a wrong key does not fix itself and retrying
 *             it on every photo would burn the whole batch.
 * - `error` → transient; retry the same host briefly, then move on.
 *
 * imgbb publishes no quota at all (see the design, §8), so message matching is
 * the only signal available for it.
 */
export function classifyUploadError(input: {
  status: number;
  message?: string;
  /** imgchest's `X-RateLimit-Remaining` header, when present. */
  rateLimitRemaining?: string | null;
}): UploadFailure {
  // Structured signals (header, then status) are trusted before free-text
  // message matching, because message text is the fragile signal.
  if (input.rateLimitRemaining === "0") return "quota";
  if (input.status === 429) return "quota";
  // 401 only — NOT 403. None of the three providers reports a bad credential
  // with a 403 (imgbb uses 400 + "Invalid API key", imgchest uses 401,
  // postimages has no auth at all), whereas a WAF or geo-block does. Treating
  // 403 as auth would let one Cloudflare page permanently disable a good key.
  if (input.status === 401) return "auth";
  const msg = input.message ?? "";
  if (QUOTA_RE.test(msg)) return "quota";
  if (AUTH_RE.test(msg)) return "auth";
  return "error";
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/photoHostErrors.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/photo-capture/hosts/errors.ts tests/photoHostErrors.test.ts
git commit -m "feat(photo-capture): classify upload failures as quota, auth or error"
```

---

### Task 6: The three host adapters

**Files:**
- Create: `lib/photo-capture/hosts/imgbb.ts`
- Create: `lib/photo-capture/hosts/postimages.ts`
- Create: `lib/photo-capture/hosts/imgchest.ts`
- Create: `tests/photoHostAdapters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/photoHostAdapters.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { imgbbAdapter } from "@/lib/photo-capture/hosts/imgbb";
import { imgchestAdapter } from "@/lib/photo-capture/hosts/imgchest";
import { postimagesAdapter, parsePostimagesToken, parseOgImage } from "@/lib/photo-capture/hosts/postimages";
import type { UploadSource } from "@/lib/photo-capture/hosts/types";

const bytes = vi.fn(async () => Buffer.from("JPEGDATA"));
const source: UploadSource = { url: "https://lh3.googleusercontent.com/p/AF1=s0", filename: "acme_001.jpg", fetchBytes: bytes };

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  bytes.mockClear();
});

describe("imgbb adapter", () => {
  it("uploads by URL and never downloads the bytes", async () => {
    // Declare the mock's parameters: without them `mock.calls[0]` is typed `[]`
    // and destructuring it needs a cast that `tsc --noEmit` rejects (TS2352).
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ success: true, data: { url: "https://i.ibb.co/abc/acme_001.jpg" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await imgbbAdapter.upload(source, { credentials: { api_key: "KEY123" } });

    expect(res).toEqual({ ok: true, directUrl: "https://i.ibb.co/abc/acme_001.jpg" });
    expect(bytes).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.imgbb.com/1/upload?key=KEY123");
    expect((init.body as FormData).get("image")).toBe(source.url);
  });

  it("reports imgbb's error message and classifies it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ status: 400, error: { message: "Invalid API key" } }, { status: 400 })));
    const res = await imgbbAdapter.upload(source, { credentials: { api_key: "bad" } });
    expect(res).toEqual({ ok: false, reason: "auth", message: "Invalid API key" });
  });

  it("is unconfigured without an api key", () => {
    expect(imgbbAdapter.isConfigured(null)).toBe(false);
    expect(imgbbAdapter.isConfigured({ api_key: "  " })).toBe(false);
    expect(imgbbAdapter.isConfigured({ api_key: "k" })).toBe(true);
  });
});

describe("imgchest adapter", () => {
  it("posts multipart with a bearer token and returns the cdn link", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ data: { id: "post1", images: [{ id: "img1", link: "https://cdn.imgchest.com/files/img1.jpg" }] } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await imgchestAdapter.upload(source, { credentials: { token: "TOK" } });

    expect(res).toEqual({ ok: true, directUrl: "https://cdn.imgchest.com/files/img1.jpg" });
    expect(bytes).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.imgchest.com/v1/post");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOK");
    expect((init.body as FormData).getAll("images[]")).toHaveLength(1);
  });

  it("treats an exhausted rate-limit header as quota", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "Too Many Attempts." }, { status: 429, headers: { "x-ratelimit-remaining": "0" } })));
    const res = await imgchestAdapter.upload(source, { credentials: { token: "TOK" } });
    expect(res).toEqual({ ok: false, reason: "quota", message: "Too Many Attempts." });
  });
});

describe("postimages parsers", () => {
  it("reads the token from a hidden input", () => {
    expect(parsePostimagesToken('<input type="hidden" name="token" value="abc123def456">')).toBe("abc123def456");
  });

  it("reads the token from an inline script assignment", () => {
    expect(parsePostimagesToken('var x = 1; token: "9f8e7d6c5b4a", numfiles: 1')).toBe("9f8e7d6c5b4a");
  });

  it("returns null when no token is present", () => {
    expect(parsePostimagesToken("<html><body>nothing</body></html>")).toBeNull();
  });

  it("reads the direct url from the og:image meta tag", () => {
    const html = '<meta property="og:image" content="https://i.postimg.cc/abc/acme.jpg"/>';
    expect(parseOgImage(html)).toBe("https://i.postimg.cc/abc/acme.jpg");
  });

  it("returns null when there is no og:image", () => {
    expect(parseOgImage("<html></html>")).toBeNull();
  });
});

describe("postimages adapter", () => {
  it("scrapes a token, posts the bytes, then resolves the direct url", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('<input name="token" value="tok999aaa">', { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(jsonResponse({ status: "OK", url: "https://postimages.org/view/xyz" }))
      .mockResolvedValueOnce(new Response('<meta property="og:image" content="https://i.postimg.cc/xy/acme.jpg"/>', { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await postimagesAdapter.upload(source, { credentials: null });

    expect(res).toEqual({ ok: true, directUrl: "https://i.postimg.cc/xy/acme.jpg" });
    expect(fetchMock.mock.calls[1][0]).toBe("https://postimages.org/json/rr");
    const form = fetchMock.mock.calls[1][1].body as FormData;
    expect(form.get("token")).toBe("tok999aaa");
    expect(form.get("numfiles")).toBe("1");
    expect(String(form.get("upload_session"))).toHaveLength(32);
  });

  it("needs no credentials at all", () => {
    expect(postimagesAdapter.needsCredentials).toBe(false);
    expect(postimagesAdapter.isConfigured(null)).toBe(true);
  });

  it("fails cleanly when the token cannot be scraped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>redesigned</html>", { headers: { "content-type": "text/html" } })));
    const res = await postimagesAdapter.upload(source, { credentials: null });
    expect(res).toEqual({ ok: false, reason: "error", message: "Could not read an upload token from postimages.org" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/photoHostAdapters.test.ts`
Expected: FAIL — cannot resolve the adapter modules.

- [ ] **Step 3: Write the imgbb adapter**

Create `lib/photo-capture/hosts/imgbb.ts`:

```ts
import { classifyUploadError } from "./errors";
import type { UploadAdapter, UploadResult, UploadSource } from "./types";

/**
 * imgbb: POST https://api.imgbb.com/1/upload?key=KEY
 *
 * The `image` field accepts an image URL, so imgbb fetches the original from
 * Google itself — this path transfers no bytes through us. Max 32 MB.
 * imgbb publishes NO rate limit, so exhaustion is only ever detected from a
 * response (see errors.ts).
 */
const ENDPOINT = "https://api.imgbb.com/1/upload";

export const imgbbAdapter: UploadAdapter = {
  provider: "imgbb",
  needsCredentials: true,

  isConfigured(credentials) {
    return !!credentials?.api_key?.trim();
  },

  async upload(source: UploadSource, ctx): Promise<UploadResult> {
    const key = ctx.credentials?.api_key?.trim();
    if (!key) return { ok: false, reason: "auth", message: "No imgbb API key configured" };

    const form = new FormData();
    form.append("image", source.url);
    form.append("name", source.filename.replace(/\.[a-z0-9]+$/i, ""));

    let resp: Response;
    try {
      resp = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, { method: "POST", body: form });
    } catch (e) {
      return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Network error" };
    }

    const body = (await resp.json().catch(() => null)) as
      | { success?: boolean; data?: { url?: string }; error?: { message?: string }; status_txt?: string }
      | null;

    const directUrl = body?.data?.url;
    if (resp.ok && body?.success !== false && directUrl) return { ok: true, directUrl };

    const message = body?.error?.message ?? body?.status_txt ?? `HTTP ${resp.status}`;
    return { ok: false, reason: classifyUploadError({ status: resp.status, message }), message };
  },
};
```

- [ ] **Step 4: Write the imgchest adapter**

Create `lib/photo-capture/hosts/imgchest.ts`:

```ts
import { classifyUploadError } from "./errors";
import type { UploadAdapter, UploadResult, UploadSource } from "./types";

/**
 * imgchest: POST https://api.imgchest.com/v1/post
 * Bearer personal access token, multipart `images[]` (max 20 per post).
 * Documented limit: 60 requests/minute, reported via X-RateLimit-Remaining —
 * the only host that warns us before the wall.
 * Each image comes back as https://cdn.imgchest.com/files/{id}.{ext}
 */
const ENDPOINT = "https://api.imgchest.com/v1/post";

export const imgchestAdapter: UploadAdapter = {
  provider: "imgchest",
  needsCredentials: true,

  isConfigured(credentials) {
    return !!credentials?.token?.trim();
  },

  async upload(source: UploadSource, ctx): Promise<UploadResult> {
    const token = ctx.credentials?.token?.trim();
    if (!token) return { ok: false, reason: "auth", message: "No imgchest token configured" };

    let form: FormData;
    try {
      const buf = await source.fetchBytes();
      form = new FormData();
      form.append("images[]", new Blob([new Uint8Array(buf)], { type: "image/jpeg" }), source.filename);
      form.append("privacy", "hidden");
    } catch (e) {
      return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Could not read the source image" };
    }

    let resp: Response;
    try {
      resp = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    } catch (e) {
      return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Network error" };
    }

    const remaining = resp.headers.get("x-ratelimit-remaining");
    const body = (await resp.json().catch(() => null)) as
      | { data?: { images?: { link?: string }[] }; message?: string }
      | null;

    const directUrl = body?.data?.images?.[0]?.link;
    if (resp.ok && directUrl) return { ok: true, directUrl };

    const message = body?.message ?? `HTTP ${resp.status}`;
    return {
      ok: false,
      reason: classifyUploadError({ status: resp.status, message, rateLimitRemaining: remaining }),
      message,
    };
  },
};
```

- [ ] **Step 5: Write the postimages adapter**

Create `lib/photo-capture/hosts/postimages.ts`:

```ts
import { randomBytes } from "crypto";
import { classifyUploadError } from "./errors";
import type { UploadAdapter, UploadResult, UploadSource } from "./types";

/**
 * postimages has NO public API and NO API keys (see the design, §8). This is
 * the undocumented browser endpoint: scrape a token from the homepage, POST the
 * bytes to /json/rr, then read the direct URL out of the returned page's
 * og:image meta tag.
 *
 * RECORDED RISK: undocumented, and can change without notice. It sits in the
 * middle of the chain so its failure degrades to imgchest. Both parsers are
 * pure and tested, so a markup change is a one-function fix.
 */
const HOME = "https://postimages.org/";
const UPLOAD = "https://postimages.org/json/rr";

/** Reads the upload token from either a hidden input or an inline script. */
export function parsePostimagesToken(html: string): string | null {
  const input = html.match(/name=["']token["']\s+value=["']([A-Za-z0-9]+)["']/i);
  if (input) return input[1];
  const script = html.match(/token\s*[:=]\s*["']([A-Za-z0-9]{8,})["']/i);
  return script ? script[1] : null;
}

/** Reads the direct image URL from a postimages view page. */
export function parseOgImage(html: string): string | null {
  const m = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

export const postimagesAdapter: UploadAdapter = {
  provider: "postimages",
  needsCredentials: false,

  isConfigured() {
    return true;
  },

  async upload(source: UploadSource): Promise<UploadResult> {
    try {
      const homeResp = await fetch(HOME, { headers: { "user-agent": "Mozilla/5.0" } });
      const token = parsePostimagesToken(await homeResp.text());
      if (!token) {
        return { ok: false, reason: "error", message: "Could not read an upload token from postimages.org" };
      }

      const buf = await source.fetchBytes();
      const form = new FormData();
      form.append("token", token);
      form.append("upload_session", randomBytes(16).toString("hex"));
      form.append("numfiles", "1");
      form.append("optsize", "0");
      form.append("expire", "0");
      form.append("session_upload", String(Date.now()));
      form.append("file", new Blob([new Uint8Array(buf)], { type: "image/jpeg" }), source.filename);

      const upResp = await fetch(UPLOAD, {
        method: "POST",
        headers: { "x-requested-with": "XMLHttpRequest" },
        body: form,
      });
      const body = (await upResp.json().catch(() => null)) as { status?: string; url?: string; error?: string } | null;

      if (!upResp.ok || body?.status !== "OK" || !body?.url) {
        const message = body?.error ?? `HTTP ${upResp.status}`;
        return { ok: false, reason: classifyUploadError({ status: upResp.status, message }), message };
      }

      const viewResp = await fetch(body.url, { headers: { "user-agent": "Mozilla/5.0" } });
      const directUrl = parseOgImage(await viewResp.text());
      if (!directUrl) {
        return { ok: false, reason: "error", message: "Uploaded, but could not read the direct URL from postimages" };
      }
      return { ok: true, directUrl };
    } catch (e) {
      return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Network error" };
    }
  },
};
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run tests/photoHostAdapters.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 7: Commit**

```bash
git add lib/photo-capture/hosts/imgbb.ts lib/photo-capture/hosts/imgchest.ts lib/photo-capture/hosts/postimages.ts tests/photoHostAdapters.test.ts
git commit -m "feat(photo-capture): imgbb, postimages and imgchest upload adapters"
```

---

### Task 7: The fallback chain

**Files:**
- Create: `lib/photo-capture/hosts/chain.ts`
- Create: `tests/photoUploadChain.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/photoUploadChain.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { runUploadChain, COOLDOWN_MS } from "@/lib/photo-capture/hosts/chain";
import type { HostProvider, ImageHost, UploadAdapter, UploadResult, HostStateStore } from "@/lib/photo-capture/hosts/types";

const NOW = new Date("2026-07-28T12:00:00Z");

function host(id: string, provider: HostProvider, position = 0): ImageHost {
  return { id, provider, label: id, position, enabled: true, exhaustedUntil: null, credentials: { api_key: "k", token: "k" } };
}

function adapter(provider: HostProvider, results: UploadResult[]): UploadAdapter {
  const queue = [...results];
  return {
    provider,
    needsCredentials: true,
    isConfigured: () => true,
    // The explicit return type is required: `vi.fn` infers its generic from the
    // implementation bottom-up, so without it the fallback literal widens to
    // `{ ok: boolean; ... }` and no longer matches `UploadResult`.
    upload: vi.fn(async (): Promise<UploadResult> => queue.shift() ?? { ok: false, reason: "error", message: "exhausted fixture" }),
  };
}

function fakeStore() {
  const calls: string[] = [];
  const store: HostStateStore & { calls: string[] } = {
    calls,
    markExhausted: async (id, until) => { calls.push(`exhausted:${id}:${until.toISOString()}`); },
    markAuthFailed: async (id) => { calls.push(`auth:${id}`); },
    recordSuccess: async (id) => { calls.push(`ok:${id}`); },
  };
  return store;
}

const source = { url: "https://lh3.googleusercontent.com/p/AF1=s0", filename: "a.jpg", fetchBytes: async () => Buffer.from("x") };
const ok = (u: string): UploadResult => ({ ok: true, directUrl: u });

describe("runUploadChain", () => {
  it("uses the first host and stops there", async () => {
    const store = fakeStore();
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb"), host("c1", "imgchest")],
      adapters: { imgbb: adapter("imgbb", [ok("https://i.ibb.co/1.jpg")]), postimages: adapter("postimages", []), imgchest: adapter("imgchest", []) },
      state: store,
      now: () => NOW,
    });

    expect(res.directUrl).toBe("https://i.ibb.co/1.jpg");
    expect(res.hostId).toBe("b1");
    expect(res.attempts.map((a) => a.outcome)).toEqual(["ok"]);
    expect(store.calls).toEqual(["ok:b1"]);
  });

  it("falls through to the next KEY of the same provider on a quota error, and parks the exhausted one", async () => {
    const store = fakeStore();
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb", 0), host("b2", "imgbb", 1)],
      adapters: {
        imgbb: adapter("imgbb", [{ ok: false, reason: "quota", message: "limit" }, ok("https://i.ibb.co/2.jpg")]),
        postimages: adapter("postimages", []),
        imgchest: adapter("imgchest", []),
      },
      state: store,
      now: () => NOW,
    });

    expect(res.hostId).toBe("b2");
    expect(res.directUrl).toBe("https://i.ibb.co/2.jpg");
    expect(store.calls).toEqual([`exhausted:b1:${new Date(NOW.getTime() + COOLDOWN_MS).toISOString()}`, "ok:b2"]);
  });

  it("drops to the next PROVIDER when every key of the first is spent", async () => {
    const store = fakeStore();
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb"), host("p1", "postimages"), host("c1", "imgchest")],
      adapters: {
        imgbb: adapter("imgbb", [{ ok: false, reason: "quota", message: "limit" }]),
        postimages: adapter("postimages", [{ ok: false, reason: "error", message: "endpoint changed" }]),
        imgchest: adapter("imgchest", [ok("https://cdn.imgchest.com/files/z.jpg")]),
      },
      state: store,
      now: () => NOW,
    });

    expect(res.directUrl).toBe("https://cdn.imgchest.com/files/z.jpg");
    expect(res.attempts.map((a) => `${a.provider}:${a.outcome}`)).toEqual([
      "imgbb:quota",
      "postimages:error",
      "imgchest:ok",
    ]);
  });

  it("disables a host with a bad credential instead of parking it", async () => {
    const store = fakeStore();
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb"), host("c1", "imgchest")],
      adapters: {
        imgbb: adapter("imgbb", [{ ok: false, reason: "auth", message: "Invalid API key" }]),
        postimages: adapter("postimages", []),
        imgchest: adapter("imgchest", [ok("https://cdn.imgchest.com/files/y.jpg")]),
      },
      state: store,
      now: () => NOW,
    });

    expect(res.directUrl).toBe("https://cdn.imgchest.com/files/y.jpg");
    expect(store.calls).toEqual(["auth:b1", "ok:c1"]);
  });

  it("skips a host whose adapter says it is not configured", async () => {
    const store = fakeStore();
    const unconfigured: UploadAdapter = { provider: "imgbb", needsCredentials: true, isConfigured: () => false, upload: vi.fn() };
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb"), host("c1", "imgchest")],
      adapters: { imgbb: unconfigured, postimages: adapter("postimages", []), imgchest: adapter("imgchest", [ok("https://cdn.imgchest.com/files/w.jpg")]) },
      state: store,
      now: () => NOW,
    });

    expect(unconfigured.upload).not.toHaveBeenCalled();
    expect(res.attempts[0]).toEqual({ hostId: "b1", provider: "imgbb", outcome: "not_configured" });
    expect(res.directUrl).toBe("https://cdn.imgchest.com/files/w.jpg");
  });

  it("returns a null url and the last error when the whole chain is spent", async () => {
    const store = fakeStore();
    const res = await runUploadChain(source, {
      hosts: [host("b1", "imgbb")],
      adapters: {
        imgbb: adapter("imgbb", [{ ok: false, reason: "error", message: "boom" }]),
        postimages: adapter("postimages", []),
        imgchest: adapter("imgchest", []),
      },
      state: store,
      now: () => NOW,
    });

    expect(res.directUrl).toBeNull();
    expect(res.hostId).toBeNull();
    expect(res.lastError).toBe("boom");
  });

  it("returns a clear error when no hosts are configured at all", async () => {
    const res = await runUploadChain(source, {
      hosts: [],
      adapters: { imgbb: adapter("imgbb", []), postimages: adapter("postimages", []), imgchest: adapter("imgchest", []) },
      state: fakeStore(),
      now: () => NOW,
    });

    expect(res.directUrl).toBeNull();
    expect(res.lastError).toBe("No image host is configured");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/photoUploadChain.test.ts`
Expected: FAIL — cannot resolve `@/lib/photo-capture/hosts/chain`.

- [ ] **Step 3: Write the implementation**

Create `lib/photo-capture/hosts/chain.ts`:

```ts
import { orderHosts } from "./order";
import type { HostProvider, HostStateStore, ImageHost, UploadAdapter, UploadResult, UploadSource } from "./types";

/** How long a rate-limited host sits out before the chain tries it again. */
export const COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Bookkeeping must never sink an upload that already succeeded — but it must
 * not vanish either. A failed `markAuthFailed` leaves a dead key enabled, and
 * the chain would then burn a round-trip on it for every subsequent photo.
 */
async function quietly(label: string, op: () => Promise<void>): Promise<void> {
  try {
    await op();
  } catch (e) {
    console.error(`[photo-capture] ${label} failed: ${e instanceof Error ? e.message : e}`);
  }
}

export type ChainAttempt = {
  hostId: string;
  provider: HostProvider;
  outcome: "ok" | "quota" | "auth" | "error" | "not_configured";
  message?: string;
};

export type ChainResult = {
  directUrl: string | null;
  hostId: string | null;
  provider: HostProvider | null;
  attempts: ChainAttempt[];
  lastError: string | null;
};

/**
 * Try one photo against every usable host in order — imgbb keys, then
 * postimages, then imgchest tokens — until one accepts it.
 *
 * A quota failure parks the host for COOLDOWN_MS; a bad credential disables it
 * outright, because retrying a wrong key on every photo would burn the batch.
 * The caller decides what a total failure means for the photo: this returns it,
 * it never throws.
 */
export async function runUploadChain(
  source: UploadSource,
  deps: {
    hosts: ImageHost[];
    adapters: Record<HostProvider, UploadAdapter>;
    state: HostStateStore;
    now?: () => Date;
  }
): Promise<ChainResult> {
  const now = deps.now ?? (() => new Date());
  const attempts: ChainAttempt[] = [];
  let lastError: string | null = null;

  const usable = orderHosts(deps.hosts, now());
  if (usable.length === 0) {
    return { directUrl: null, hostId: null, provider: null, attempts, lastError: "No image host is configured" };
  }

  for (const host of usable) {
    const adapter = deps.adapters[host.provider];
    if (!adapter || !adapter.isConfigured(host.credentials)) {
      attempts.push({ hostId: host.id, provider: host.provider, outcome: "not_configured" });
      continue;
    }

    let result: UploadResult;
    try {
      result = await adapter.upload(source, { credentials: host.credentials });
    } catch (e) {
      // A well-behaved adapter returns failures rather than throwing, but the
      // contract is that this function NEVER throws — one misbehaving adapter
      // must not lose the rest of the batch.
      result = { ok: false, reason: "error", message: e instanceof Error ? e.message : "Adapter threw" };
    }

    if (result.ok) {
      await quietly(`recordSuccess(${host.id})`, () => deps.state.recordSuccess(host.id));
      attempts.push({ hostId: host.id, provider: host.provider, outcome: "ok" });
      return { directUrl: result.directUrl, hostId: host.id, provider: host.provider, attempts, lastError: null };
    }

    lastError = result.message;
    attempts.push({ hostId: host.id, provider: host.provider, outcome: result.reason, message: result.message });

    if (result.reason === "quota") {
      // `now()` is re-sampled deliberately: the cooldown should start when the
      // host actually failed, not when the chain began.
      await quietly(`markExhausted(${host.id})`, () => deps.state.markExhausted(host.id, new Date(now().getTime() + COOLDOWN_MS), result.message));
    } else if (result.reason === "auth") {
      await quietly(`markAuthFailed(${host.id})`, () => deps.state.markAuthFailed(host.id, result.message));
    }
  }

  return { directUrl: null, hostId: null, provider: null, attempts, lastError };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/photoUploadChain.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/photo-capture/hosts/chain.ts tests/photoUploadChain.test.ts
git commit -m "feat(photo-capture): image host fallback chain"
```

---

## Phase 3 — Persistence and APIs

### Task 8: The migration

**Files:**
- Create: `supabase/migrations/0061_lead_photo_capture.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0061_lead_photo_capture.sql`:

```sql
-- 0061_lead_photo_capture.sql — Google Business Profile photo capture.
--
-- FILE ONLY. Do NOT apply — the operator's DB is production; they apply this
-- after review (see AGENTS.md).
--
-- ADDITIVE ONLY. Shared prod DB: three new tables, no drops, no type changes,
-- no edits to any existing table. In particular `leads` is NOT touched:
-- capture state is a workflow concern and has no business in the lead row.
-- The captured URLs land in the EXISTING `leads.image_links`, so every
-- downstream consumer (Site Builder, Template Engine, copy-lead) needs no
-- change at all.
--
-- RLS: enabled, NO policies on all three — service-role routes only, the same
-- posture as every studio_/builder_ table (0051, 0053, 0057, 0060).
-- `image_hosts` additionally HOLDS CREDENTIALS: `encrypted_credentials` is a
-- JSON object AES-256-GCM encrypted with MAILBOX_ENC_KEY (lib/mail/crypto.ts),
-- stored as `iv:tag:ciphertext`, exactly like `ai_providers` (0046).

-- ------------------------------------------------------- per-lead capture run
create table if not exists public.lead_photo_captures (
  lead_id uuid primary key references public.leads (id) on delete cascade,
  -- pending: a browser is working on it right now.
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'none_found', 'failed')),
  -- WHICH link this capture was for. The Images group compares it against the
  -- lead's current business_profile_link: when they differ, the link has been
  -- edited since and a fresh capture runs automatically.
  profile_link text,
  found_count int not null default 0,
  error text,
  -- which build of the extension produced this, so a bad harvest is traceable
  extension_version text,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ------------------------------------------------------------ the candidates
-- One row per harvested photo. Thumbnails render straight from `thumb_url`
-- (googleusercontent hotlinks fine), so the picker costs no storage and no
-- bandwidth of ours — only PICKED photos are ever copied anywhere.
create table if not exists public.lead_photo_candidates (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  -- the Google photo id: the natural identity, so re-capture is idempotent
  photo_key text not null,
  thumb_url text not null,
  -- the =s0 original that actually gets uploaded
  source_url text not null,
  status text not null default 'pending'
    check (status in ('pending', 'uploaded', 'failed', 'skipped')),
  hosted_url text,
  host_provider text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lead_photo_candidates_key
  on public.lead_photo_candidates (lead_id, photo_key);
create index if not exists lead_photo_candidates_lead
  on public.lead_photo_candidates (lead_id);

-- --------------------------------------------------------------- host keys
-- `position` is insertion order within a provider: the key added first is
-- tried first. Provider order itself is NOT stored — it is a product decision
-- hardcoded in lib/photo-capture/hosts/order.ts (imgbb → postimages →
-- imgchest).
--
-- postimages rows carry NO credentials: postimages publishes no API and no API
-- keys at all, so its row is nothing but an on/off switch.
create table if not exists public.image_hosts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('imgbb', 'postimages', 'imgchest')),
  label text not null default '',
  encrypted_credentials text,
  position int not null default 0,
  enabled boolean not null default true,
  -- set when the host reported a limit; it rejoins the chain by itself
  exhausted_until timestamptz,
  last_error text,
  upload_count int not null default 0,
  last_used_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists image_hosts_order on public.image_hosts (provider, position);

alter table public.lead_photo_captures enable row level security;
alter table public.lead_photo_candidates enable row level security;
alter table public.image_hosts enable row level security;
```

- [ ] **Step 2: Check it against the repo's rules**

Re-read the file and confirm: no `drop`, no `alter ... type`, no changes to `leads` or any other existing table, every `create` guarded with `if not exists`, RLS enabled on all three.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0061_lead_photo_capture.sql
git commit -m "feat(photo-capture): migration for captures, candidates and image hosts"
```

- [ ] **Step 4: Tell the operator**

This migration is **not** applied by you. Note in the task hand-off that `0061` is ready for the operator to review and apply, and that nothing downstream works until they do.

---

### Task 9: Google link detection

**Files:**
- Create: `lib/photo-capture/googleLink.ts`
- Create: `tests/googleProfileLink.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/googleProfileLink.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isGoogleProfileLink } from "@/lib/photo-capture/googleLink";

describe("isGoogleProfileLink", () => {
  it("accepts a maps place url", () => {
    expect(isGoogleProfileLink("https://www.google.com/maps/place/Joe+Plumbing/@40.7,-73.9,17z")).toBe(true);
  });

  it("accepts a country-domain maps url", () => {
    expect(isGoogleProfileLink("https://www.google.co.uk/maps/place/Acme+Ltd")).toBe(true);
  });

  it("accepts a maps.google.com url", () => {
    expect(isGoogleProfileLink("https://maps.google.com/?cid=1234567890")).toBe(true);
  });

  it("accepts a shortened maps.app.goo.gl link", () => {
    expect(isGoogleProfileLink("https://maps.app.goo.gl/AbCdEf123")).toBe(true);
  });

  it("accepts a g.page short link", () => {
    expect(isGoogleProfileLink("https://g.page/acme-plumbing")).toBe(true);
  });

  it("rejects a Yelp link", () => {
    expect(isGoogleProfileLink("https://www.yelp.com/biz/acme-plumbing")).toBe(false);
  });

  it("rejects a plain website", () => {
    expect(isGoogleProfileLink("https://acmeplumbing.com")).toBe(false);
  });

  it("rejects google search and other google properties", () => {
    expect(isGoogleProfileLink("https://www.google.com/search?q=acme")).toBe(false);
  });

  it("rejects blank, null and junk", () => {
    expect(isGoogleProfileLink("")).toBe(false);
    expect(isGoogleProfileLink(null)).toBe(false);
    expect(isGoogleProfileLink("not a url")).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isGoogleProfileLink("  https://maps.app.goo.gl/xyz  ")).toBe(true);
  });

  it("rejects a path that merely starts with the letters 'maps'", () => {
    expect(isGoogleProfileLink("https://www.google.com/mapsfoo")).toBe(false);
    expect(isGoogleProfileLink("https://www.google.com/mapsomething/place/x")).toBe(false);
  });

  it("accepts the bare /maps path and /maps/ subpaths", () => {
    expect(isGoogleProfileLink("https://www.google.com/maps")).toBe(true);
    expect(isGoogleProfileLink("https://www.google.com/maps/place/Acme")).toBe(true);
  });

  it("ignores a google URL smuggled into another host's query string", () => {
    expect(isGoogleProfileLink("https://evil.com/?x=https://www.google.com/maps/place/x")).toBe(false);
  });

  it("rejects non-http protocols", () => {
    expect(isGoogleProfileLink("javascript:alert(1)")).toBe(false);
    expect(isGoogleProfileLink("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects lookalike domains that merely start with google.", () => {
    expect(isGoogleProfileLink("https://google.com.evil.com/maps/place/x")).toBe(false);
    expect(isGoogleProfileLink("https://google.evil.com/maps")).toBe(false);
    expect(isGoogleProfileLink("https://maps.google.evil.com/maps")).toBe(false);
    expect(isGoogleProfileLink("https://google.attacker.tld/maps")).toBe(false);
  });

  it("still accepts genuine Google country domains", () => {
    expect(isGoogleProfileLink("https://www.google.com/maps/place/Acme")).toBe(true);
    expect(isGoogleProfileLink("https://www.google.co.uk/maps/place/Acme")).toBe(true);
    expect(isGoogleProfileLink("https://www.google.de/maps/place/Acme")).toBe(true);
    expect(isGoogleProfileLink("https://www.google.com.au/maps/place/Acme")).toBe(true);
    expect(isGoogleProfileLink("https://maps.google.com/?cid=123")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/googleProfileLink.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

Create `lib/photo-capture/googleLink.ts`:

```ts
/**
 * Does `business_profile_link` point at a Google Business Profile?
 *
 * Only these trigger a capture. A Yelp link is deliberately NOT accepted: the
 * extension has a working Yelp adapter, but Yelp capture is out of scope
 * (see the design, §16) and silently half-supporting it would confuse.
 */
/**
 * Google's own hostnames, anchored at BOTH ends. Anchoring only the start —
 * /^(www\.)?google\./ — accepts google.com.evil.com, because that string does
 * begin with "google.". The TLD shape here allows google.com, google.de,
 * google.co.uk and google.com.au, while rejecting google.attacker.tld and
 * google.com.evil.com, whose extra labels are too long to be a TLD.
 */
const GOOGLE_HOST_RE = /^(?:www\.|maps\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/;

export function isGoogleProfileLink(link: string | null | undefined): boolean {
  const raw = (link ?? "").trim();
  if (!raw) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  // Short links resolve to a place; the extension follows the redirect.
  // Exact equality, so these need no anchoring.
  if (host === "maps.app.goo.gl" || host === "goo.gl" || host === "g.page") return true;

  if (!GOOGLE_HOST_RE.test(host)) return false;
  // maps.google.<tld> is a Maps host whatever the path.
  if (host.startsWith("maps.")) return true;
  // On www.google.<tld> only the /maps path is a profile link. SEGMENT match,
  // not a prefix match — startsWith("/maps") would also accept /mapsfoo. This
  // gates a URL we later open in the operator's browser, so err toward
  // rejecting: a real-but-unusual Google URL just means capturing manually.
  return path === "/maps" || path.startsWith("/maps/");
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/googleProfileLink.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/photo-capture/googleLink.ts tests/googleProfileLink.test.ts
git commit -m "feat(photo-capture): detect Google Business Profile links"
```

---

### Task 10: Host config store (encrypted)

**Files:**
- Create: `lib/photo-capture/hosts/config.ts`

There is no unit test for this task: it is thin DB glue over already-tested pure logic, and the codebase's own precedent (`lib/ai-tools/providers/config.ts`) is tested the same way — through the pure pieces it composes. It is exercised end-to-end in Task 12.

- [ ] **Step 1: Write the implementation**

Create `lib/photo-capture/hosts/config.ts`:

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/mail/crypto";
import type { HostProvider, HostStateStore, ImageHost } from "./types";
import { PROVIDER_RANK } from "./order";

/**
 * Operator-managed image host credentials. SERVER ONLY (service role).
 *
 * Credentials are AES-256-GCM encrypted with the same key and helpers as
 * mailboxes and AI providers. `listImageHosts()` DECRYPTS and is for server
 * callers only; `listImageHostStatuses()` is the ONLY shape that may reach a
 * client — it says whether a credential exists, never what it is.
 */

type Row = {
  id: string;
  provider: HostProvider;
  label: string;
  encrypted_credentials: string | null;
  position: number;
  enabled: boolean;
  exhausted_until: string | null;
  last_error: string | null;
  upload_count: number;
  last_used_at: string | null;
};

/** Client-safe projection. Never contains a secret. */
export type ImageHostStatus = {
  id: string;
  provider: HostProvider;
  label: string;
  position: number;
  enabled: boolean;
  configured: boolean;
  /** Last 4 characters of the key. Never the key. */
  hint: string | null;
  exhaustedUntil: string | null;
  lastError: string | null;
  uploadCount: number;
  lastUsedAt: string | null;
};

const CREDENTIAL_FIELD: Record<HostProvider, string | null> = {
  imgbb: "api_key",
  postimages: null, // no API, no keys — see the design, §8
  imgchest: "token",
};

function decrypt(row: Row): Record<string, string> | null {
  if (!row.encrypted_credentials) return null;
  try {
    return JSON.parse(decryptSecret(row.encrypted_credentials)) as Record<string, string>;
  } catch {
    return null;
  }
}

function toHost(row: Row): ImageHost {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    position: row.position,
    enabled: row.enabled,
    exhaustedUntil: row.exhausted_until ? new Date(row.exhausted_until) : null,
    credentials: decrypt(row),
  };
}

async function fetchRows(): Promise<Row[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("image_hosts")
    .select("id, provider, label, encrypted_credentials, position, enabled, exhausted_until, last_error, upload_count, last_used_at")
    .order("provider")
    .order("position");
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

/** Decrypted hosts for the upload chain. NEVER serialise these. */
export async function listImageHosts(): Promise<ImageHost[]> {
  return (await fetchRows()).map(toHost);
}

/** Client-safe list for the admin page. */
export async function listImageHostStatuses(): Promise<ImageHostStatus[]> {
  return (await fetchRows())
    .map((row) => {
      const field = CREDENTIAL_FIELD[row.provider];
      const secret = field ? decrypt(row)?.[field] ?? null : null;
      return {
        id: row.id,
        provider: row.provider,
        label: row.label,
        position: row.position,
        enabled: row.enabled,
        configured: field === null ? true : !!secret,
        // `.slice(-4)` on a secret of 4 chars or fewer returns the WHOLE thing,
        // so short credentials get a bare mask. Mirrors `maskCredentialHint`.
        hint: secret ? (secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`) : null,
        exhaustedUntil: row.exhausted_until,
        lastError: row.last_error,
        uploadCount: row.upload_count,
        lastUsedAt: row.last_used_at,
      };
    })
    .sort((a, b) => PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider] || a.position - b.position);
}

/** Add a credential slot. New rows go to the END of their provider's order. */
export async function addImageHost(input: {
  provider: HostProvider;
  label: string;
  secret: string | null;
  createdBy: string;
}): Promise<{ id: string }> {
  const admin = createAdminClient();
  const field = CREDENTIAL_FIELD[input.provider];

  const { data: last } = await admin
    .from("image_hosts")
    .select("position")
    .eq("provider", input.provider)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const encrypted =
    field && input.secret?.trim() ? encryptSecret(JSON.stringify({ [field]: input.secret.trim() })) : null;

  const { data, error } = await admin
    .from("image_hosts")
    .insert({
      provider: input.provider,
      label: input.label.trim() || input.provider,
      encrypted_credentials: encrypted,
      position: (last?.position ?? -1) + 1,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string };
}

export async function updateImageHost(
  id: string,
  patch: { label?: string; enabled?: boolean; position?: number; secret?: string | null; clearError?: boolean }
): Promise<void> {
  const admin = createAdminClient();
  const update: Record<string, unknown> = {};
  if (patch.label !== undefined) update.label = patch.label.trim();
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.position !== undefined) update.position = patch.position;
  if (patch.clearError) {
    update.last_error = null;
    update.exhausted_until = null;
  }
  if (patch.secret !== undefined) {
    const { data: row, error: lookupError } = await admin
      .from("image_hosts")
      .select("provider")
      .eq("id", id)
      .single();
    // Must NOT continue on failure: `field` would fall to null below and the
    // update would CLEAR the operator's working credential instead of setting
    // it — a transient read failure must never be able to wipe a secret.
    if (lookupError || !row) throw new Error(lookupError?.message ?? "Image host not found");
    const field = CREDENTIAL_FIELD[row.provider as HostProvider];
    update.encrypted_credentials =
      field && patch.secret?.trim() ? encryptSecret(JSON.stringify({ [field]: patch.secret.trim() })) : null;
  }
  if (Object.keys(update).length === 0) return;
  const { error } = await admin.from("image_hosts").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteImageHost(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("image_hosts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** The chain's persistence, backed by the table. */
export function imageHostStateStore(): HostStateStore {
  const admin = createAdminClient();
  return {
    async markExhausted(hostId, until, message) {
      await admin
        .from("image_hosts")
        .update({ exhausted_until: until.toISOString(), last_error: message })
        .eq("id", hostId);
    },
    async markAuthFailed(hostId, message) {
      await admin.from("image_hosts").update({ enabled: false, last_error: message }).eq("id", hostId);
    },
    async recordSuccess(hostId) {
      const { data } = await admin.from("image_hosts").select("upload_count").eq("id", hostId).single();
      await admin
        .from("image_hosts")
        .update({
          upload_count: (data?.upload_count ?? 0) + 1,
          last_used_at: new Date().toISOString(),
          last_error: null,
          exhausted_until: null,
        })
        .eq("id", hostId);
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `lib/photo-capture/`.

- [ ] **Step 3: Commit**

```bash
git add lib/photo-capture/hosts/config.ts
git commit -m "feat(photo-capture): encrypted image host configuration store"
```

---

### Task 11: Candidate store and the read/write routes

**Files:**
- Create: `lib/photo-capture/store.ts`
- Create: `app/api/leads/[id]/photos/route.ts`
- Create: `app/api/leads/[id]/photos/candidates/route.ts`

- [ ] **Step 1: Write the store**

Create `lib/photo-capture/store.ts`:

```ts
import { createAdminClient } from "@/lib/supabase/admin";

/** Capture state and candidate photos for a lead. SERVER ONLY (service role). */

export type CaptureStatus = "pending" | "ready" | "none_found" | "failed";
/** `uploading` is a CLAIM state — see `claimCandidate` below. */
export type CandidateStatus = "pending" | "uploading" | "uploaded" | "failed" | "skipped";

export type Candidate = {
  id: string;
  photoKey: string;
  thumbUrl: string;
  sourceUrl: string;
  status: CandidateStatus;
  hostedUrl: string | null;
  error: string | null;
};

export type CaptureState = {
  status: CaptureStatus;
  /** The profile link this capture was for; null on rows written before it was tracked. */
  profileLink: string | null;
  foundCount: number;
  error: string | null;
  requestedAt: string;
  completedAt: string | null;
} | null;

export type HarvestedPhoto = { key: string; thumbUrl: string; sourceUrl: string };

export async function getCapture(leadId: string): Promise<{ capture: CaptureState; candidates: Candidate[] }> {
  const admin = createAdminClient();

  const { data: cap } = await admin
    .from("lead_photo_captures")
    .select("status, profile_link, found_count, error, requested_at, completed_at")
    .eq("lead_id", leadId)
    .maybeSingle();

  const { data: rows } = await admin
    .from("lead_photo_candidates")
    .select("id, photo_key, thumb_url, source_url, status, hosted_url, error")
    .eq("lead_id", leadId)
    .order("created_at");

  return {
    capture: cap
      ? {
          status: cap.status as CaptureStatus,
          profileLink: (cap.profile_link as string | null) ?? null,
          foundCount: cap.found_count as number,
          error: (cap.error as string | null) ?? null,
          requestedAt: cap.requested_at as string,
          completedAt: (cap.completed_at as string | null) ?? null,
        }
      : null,
    candidates: (rows ?? []).map((r) => ({
      id: r.id as string,
      photoKey: r.photo_key as string,
      thumbUrl: r.thumb_url as string,
      sourceUrl: r.source_url as string,
      status: r.status as CandidateStatus,
      hostedUrl: (r.hosted_url as string | null) ?? null,
      error: (r.error as string | null) ?? null,
    })),
  };
}

/** Mark a capture as started. Called when the page dispatches to the extension. */
export async function startCapture(leadId: string, userId: string, profileLink: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("lead_photo_captures").upsert(
    {
      lead_id: leadId,
      status: "pending",
      profile_link: profileLink,
      error: null,
      requested_by: userId,
      requested_at: new Date().toISOString(),
      completed_at: null,
    },
    { onConflict: "lead_id" }
  );
}

/**
 * Record what the extension harvested. Idempotent per (lead_id, photo_key), so
 * a re-capture keeps an already-uploaded photo's hosted URL rather than
 * resetting it and paying for the upload twice.
 */
export async function saveHarvest(
  leadId: string,
  photos: HarvestedPhoto[],
  meta: { extensionVersion: string | null; profileLink: string }
): Promise<{ status: CaptureStatus; found: number }> {
  const admin = createAdminClient();
  const status: CaptureStatus = photos.length > 0 ? "ready" : "none_found";

  if (photos.length > 0) {
    const { error } = await admin.from("lead_photo_candidates").upsert(
      photos.map((p) => ({
        lead_id: leadId,
        photo_key: p.key,
        thumb_url: p.thumbUrl,
        source_url: p.sourceUrl,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "lead_id,photo_key", ignoreDuplicates: true }
    );
    if (error) throw new Error(error.message);
  }

  await admin.from("lead_photo_captures").upsert(
    {
      lead_id: leadId,
      status,
      profile_link: meta.profileLink,
      found_count: photos.length,
      error: null,
      extension_version: meta.extensionVersion,
      completed_at: new Date().toISOString(),
    },
    { onConflict: "lead_id" }
  );

  return { status, found: photos.length };
}

export async function failCapture(leadId: string, message: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("lead_photo_captures").upsert(
    { lead_id: leadId, status: "failed", error: message.slice(0, 500), completed_at: new Date().toISOString() },
    { onConflict: "lead_id" }
  );
}

/**
 * Atomically claim a candidate for upload. Returns false when someone else got
 * there first.
 *
 * WHY THIS EXISTS. Two operators can have the same lead open. Without a claim,
 * both upload requests read the same candidate as `pending`, both push it
 * through the host chain, and both spend quota on hosts we deliberately model
 * as scarce — then the second write silently overwrites the first. The
 * conditional update is the whole guard: exactly one caller can move a row out
 * of `pending`.
 */
const CLAIM_STALE_MS = 10 * 60 * 1000;

export async function claimCandidate(candidateId: string): Promise<boolean> {
  const admin = createAdminClient();
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  const { data, error } = await admin
    .from("lead_photo_candidates")
    .update({ status: "uploading", updated_at: new Date().toISOString() })
    .eq("id", candidateId)
    // A `finally` cannot run if the platform kills the function mid-upload, so
    // a claim that has sat in `uploading` past the stale window is reclaimable.
    // Without this, one timeout strands a photo permanently: invisible to the
    // picker and unclaimable, with nothing to tell the operator why.
    .or(`status.eq.pending,and(status.eq.uploading,updated_at.lt.${staleBefore})`)
    .select("id");
  // A genuine error is a failure; zero matched rows is just a lost race.
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) === 1;
}

/** Hand a claim back when the upload failed before it started. */
export async function releaseCandidate(candidateId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("lead_photo_candidates")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("id", candidateId)
    .eq("status", "uploading");
}

export async function markCandidateUploaded(
  candidateId: string,
  hostedUrl: string,
  provider: string
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("lead_photo_candidates")
    .update({ status: "uploaded", hosted_url: hostedUrl, host_provider: provider, error: null, updated_at: new Date().toISOString() })
    .eq("id", candidateId);
}

export async function markCandidateFailed(candidateId: string, message: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("lead_photo_candidates")
    .update({ status: "failed", error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("id", candidateId);
}
```

- [ ] **Step 2: Write the GET route**

Create `app/api/leads/[id]/photos/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getCapture } from "@/lib/photo-capture/store";

export const runtime = "nodejs";

/** Capture state + candidate thumbnails for the lead's Images group. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json(await getCapture(id));
}
```

- [ ] **Step 3: Write the candidates route**

Create `app/api/leads/[id]/photos/candidates/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { failCapture, saveHarvest, startCapture } from "@/lib/photo-capture/store";
import { isGoogleProfileLink } from "@/lib/photo-capture/googleLink";

export const runtime = "nodejs";

/**
 * The PAGE reports what the extension harvested — the extension never talks to
 * this API itself, so there is no extension credential to leak (design §4).
 */
const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), profileLink: z.string().url().max(2000) }),
  z.object({
    kind: z.literal("done"),
    profileLink: z.string().url().max(2000),
    extensionVersion: z.string().max(32).nullish(),
    photos: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(256),
          thumbUrl: z.string().url().max(2000),
          sourceUrl: z.string().url().max(2000),
        })
      )
      .max(30),
  }),
  z.object({ kind: z.literal("failed"), error: z.string().max(500) }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  if (parsed.data.kind === "failed") {
    await failCapture(id, parsed.data.error);
    return NextResponse.json({ status: "failed" });
  }

  // Only a Google profile link may be recorded — it is what the auto-capture
  // comparison in the Images group is keyed on.
  if (!isGoogleProfileLink(parsed.data.profileLink)) {
    return NextResponse.json({ error: "Not a Google Business Profile link" }, { status: 422 });
  }

  if (parsed.data.kind === "started") {
    await startCapture(id, user.id, parsed.data.profileLink);
    return NextResponse.json({ status: "pending" });
  }

  // Only Google photo URLs may be stored: the source URL is fetched by our
  // server (and by imgbb) later, so an arbitrary URL here would be an SSRF.
  const allowed = parsed.data.photos.filter(
    (p) => /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(p.sourceUrl) &&
           /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(p.thumbUrl)
  );

  const result = await saveHarvest(id, allowed, {
    extensionVersion: parsed.data.extensionVersion ?? null,
    profileLink: parsed.data.profileLink,
  });
  return NextResponse.json(result);
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/photo-capture/store.ts "app/api/leads/[id]/photos"
git commit -m "feat(photo-capture): candidate store and capture routes"
```

---

### Task 12: The upload route

**Files:**
- Create: `app/api/leads/[id]/photos/upload/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/leads/[id]/photos/upload/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { runUploadChain } from "@/lib/photo-capture/hosts/chain";
import { imageHostStateStore, listImageHosts } from "@/lib/photo-capture/hosts/config";
import { imgbbAdapter } from "@/lib/photo-capture/hosts/imgbb";
import { imgchestAdapter } from "@/lib/photo-capture/hosts/imgchest";
import { postimagesAdapter } from "@/lib/photo-capture/hosts/postimages";
import type { HostProvider, UploadAdapter } from "@/lib/photo-capture/hosts/types";
import { claimCandidate, getCapture, markCandidateFailed, markCandidateUploaded } from "@/lib/photo-capture/store";

export const runtime = "nodejs";
export const maxDuration = 300;

const ADAPTERS: Record<HostProvider, UploadAdapter> = {
  imgbb: imgbbAdapter,
  postimages: postimagesAdapter,
  imgchest: imgchestAdapter,
};

const bodySchema = z.object({
  photoKeys: z.array(z.string().trim().min(1).max(256)).min(1).max(30),
});

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "business";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await getUserPermissions(user.id);
  if (!perms.has("leads.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: lead } = await admin
    .from("leads")
    .select("business_name, image_links")
    .eq("id", id)
    .single();
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const { candidates } = await getCapture(id);
  const wanted = new Set(parsed.data.photoKeys);
  const chosen = candidates.filter((c) => wanted.has(c.photoKey));
  if (chosen.length === 0) return NextResponse.json({ error: "No matching candidates" }, { status: 422 });

  const hosts = await listImageHosts();
  const state = imageHostStateStore();
  const base = slug(lead.business_name as string);

  const uploaded: string[] = [];
  const failed: { photoKey: string; error: string }[] = [];

  // Sequential on purpose: the chain mutates shared host state (cooldowns,
  // disablement), and racing 30 uploads past an exhausted key would burn every
  // one of them before the first failure is recorded.
  for (const [i, candidate] of chosen.entries()) {
    // Already uploaded — idempotent, and never pay for the same photo twice.
    if (candidate.status === "uploaded" && candidate.hostedUrl) {
      uploaded.push(candidate.hostedUrl);
      continue;
    }

    // Claim it, or leave it to whoever already has it. Two operators with the
    // same lead open must not both spend host quota on the same photo.
    if (!(await claimCandidate(candidate.id))) continue;

    const filename = `${base}_${String(i + 1).padStart(3, "0")}.jpg`;
    const result = await runUploadChain(
      {
        url: candidate.sourceUrl,
        filename,
        fetchBytes: async () => {
          const r = await fetch(candidate.sourceUrl);
          if (!r.ok) throw new Error(`Could not fetch the source image (HTTP ${r.status})`);
          return Buffer.from(await r.arrayBuffer());
        },
      },
      { hosts, adapters: ADAPTERS, state }
    );

    if (result.directUrl) {
      await markCandidateUploaded(candidate.id, result.directUrl, result.provider ?? "");
      uploaded.push(result.directUrl);
    } else {
      const message = result.lastError ?? "Every image host refused this photo";
      await markCandidateFailed(candidate.id, message);
      failed.push({ photoKey: candidate.photoKey, error: message });
    }
  }

  // Append to the EXISTING field every downstream consumer already reads.
  //
  // DERIVED, not appended. Computing a delta against the snapshot read at the
  // top of this request means two concurrent uploads on the same lead clobber
  // each other — last write wins and one set of URLs silently vanishes despite
  // having cost real host quota. Rebuilding from the candidate rows, which hold
  // every `hosted_url` authoritatively, does not close the window but makes it
  // CONVERGE: each writer writes a superset of everything uploaded before its
  // own read. A perfect fix needs an atomic array append; this is the trade-off.
  if (uploaded.length > 0) {
    const [{ data: freshLead }, { candidates: freshCandidates }] = await Promise.all([
      admin.from("leads").select("image_links").eq("id", id).single(),
      getCapture(id),
    ]);
    const existing = Array.isArray(freshLead?.image_links) ? (freshLead.image_links as string[]) : [];
    const fromCandidates = freshCandidates
      .filter((c) => c.status === "uploaded" && c.hostedUrl)
      .map((c) => c.hostedUrl as string);
    const merged = Array.from(new Set([...existing, ...fromCandidates]));
    const { error } = await admin.from("leads").update({ image_links: merged }).eq("id", id);
    if (error) return NextResponse.json({ error: "Uploaded, but could not save the links" }, { status: 500 });
  }

  return NextResponse.json({ uploaded, failed });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/api/leads/[id]/photos/upload"
git commit -m "feat(photo-capture): upload selected photos through the host chain"
```

---

### Task 13: Admin routes and page

**Files:**
- Create: `app/api/admin/image-hosts/route.ts`
- Create: `app/api/admin/image-hosts/[id]/route.ts`
- Create: `app/(app)/admin/image-hosts/page.tsx`
- Create: `components/admin/ImageHostsPanel.tsx`

- [ ] **Step 1: Write the collection route**

Create `app/api/admin/image-hosts/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { addImageHost, listImageHostStatuses } from "@/lib/photo-capture/hosts/config";

export const runtime = "nodejs";

/**
 * NOTHING in this file may return a credential — not the plaintext, not the
 * ciphertext. The client gets `configured`, a masked hint, and state.
 */
async function guard(): Promise<{ userId: string } | { error: 401 | 403 }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  return NextResponse.json({ hosts: await listImageHostStatuses() });
}

const postSchema = z.object({
  provider: z.enum(["imgbb", "postimages", "imgchest"]),
  label: z.string().trim().max(80).default(""),
  /** null for postimages, which has no API keys at all. */
  secret: z.string().trim().max(500).nullish(),
});

export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }
  if (parsed.data.provider !== "postimages" && !parsed.data.secret?.trim()) {
    return NextResponse.json({ error: "This provider needs an API key" }, { status: 422 });
  }

  try {
    const { id } = await addImageHost({
      provider: parsed.data.provider,
      label: parsed.data.label,
      secret: parsed.data.secret ?? null,
      createdBy: auth.userId,
    });
    return NextResponse.json({ id });
  } catch {
    // Deliberately opaque — an upstream error could echo the payload.
    return NextResponse.json({ error: "Could not save the image host" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the item route**

Create `app/api/admin/image-hosts/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { deleteImageHost, updateImageHost } from "@/lib/photo-capture/hosts/config";

export const runtime = "nodejs";

async function guard(): Promise<true | { error: 401 | 403 }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return { error: 403 };
  return true;
}

function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

const patchSchema = z.object({
  label: z.string().trim().max(80).optional(),
  enabled: z.boolean().optional(),
  position: z.number().int().min(0).max(999).optional(),
  secret: z.string().trim().max(500).nullish(),
  /** Clears last_error and any cooldown — "try this key again now". */
  clearError: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard();
  if (auth !== true) return guardError(auth.error);
  const { id } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }

  try {
    await updateImageHost(id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update the image host" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard();
  if (auth !== true) return guardError(auth.error);
  const { id } = await params;
  try {
    await deleteImageHost(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not delete the image host" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Write the panel component**

Create `components/admin/ImageHostsPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, ArrowUp, ArrowDown, Plus } from "lucide-react";
import type { ImageHostStatus } from "@/lib/photo-capture/hosts/config";

const PROVIDERS = [
  { key: "imgbb", label: "imgbb", secretLabel: "API key", needsSecret: true },
  { key: "postimages", label: "postimages.org", secretLabel: null, needsSecret: false },
  { key: "imgchest", label: "imgchest.com", secretLabel: "Personal access token", needsSecret: true },
] as const;

export function ImageHostsPanel({ hosts }: { hosts: ImageHostStatus[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ provider: string; label: string; secret: string }>({
    provider: "imgbb",
    label: "",
    secret: "",
  });

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Request failed");
      return false;
    }
    router.refresh();
    return true;
  }

  async function add() {
    const spec = PROVIDERS.find((p) => p.key === draft.provider)!;
    if (spec.needsSecret && !draft.secret.trim()) {
      setError(`${spec.label} needs an ${spec.secretLabel}.`);
      return;
    }
    const ok = await call("/api/admin/image-hosts", {
      method: "POST",
      body: JSON.stringify({
        provider: draft.provider,
        label: draft.label,
        secret: spec.needsSecret ? draft.secret : null,
      }),
    });
    if (ok) setDraft({ provider: draft.provider, label: "", secret: "" });
  }

  async function move(host: ImageHostStatus, delta: number) {
    // SWAP with the neighbouring host of the same provider — do not just write
    // `position + delta`. An absolute write lets two rows share a position,
    // after which the list silently stops matching what the operator clicked.
    // (The upload order stays deterministic either way, because `orderHosts`
    // tie-breaks on id — it just stops being the order they chose.)
    const siblings = hosts
      .filter((h) => h.provider === host.provider)
      .sort((a, b) => a.position - b.position);
    const neighbour = siblings[siblings.findIndex((h) => h.id === host.id) + delta];
    if (!neighbour) return;

    const moved = await call(`/api/admin/image-hosts/${host.id}`, {
      method: "PATCH",
      body: JSON.stringify({ position: neighbour.position }),
    });
    if (!moved) return;
    await call(`/api/admin/image-hosts/${neighbour.id}`, {
      method: "PATCH",
      body: JSON.stringify({ position: host.position }),
    });
  }

  const spec = PROVIDERS.find((p) => p.key === draft.provider)!;

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-faint">
        Uploads try imgbb first, then postimages.org, then imgchest.com. Within a provider, keys are tried in
        the order below. A key that reports a limit sits out for an hour; a key that reports a bad credential
        is disabled until you fix it. postimages.org has no API keys — it is a single on/off row.
      </p>

      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

      <div className="space-y-2">
        {hosts.length === 0 && <p className="text-sm text-text-faint">No image hosts configured yet.</p>}
        {hosts.map((h) => (
          <div key={h.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{h.label || h.provider}</span>
                <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-text-faint">{h.provider}</span>
                {!h.enabled && <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">disabled</span>}
                {h.exhaustedUntil && new Date(h.exhaustedUntil) > new Date() && (
                  <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">cooling down</span>
                )}
              </div>
              <div className="mt-1 text-xs text-text-faint">
                {h.hint ? `key ${h.hint} · ` : ""}
                {h.uploadCount} uploads
                {h.lastError ? ` · last error: ${h.lastError}` : ""}
              </div>
            </div>
            <button type="button" disabled={busy} onClick={() => move(h, -1)} aria-label="Move up" className="p-2">
              <ArrowUp size={16} />
            </button>
            <button type="button" disabled={busy} onClick={() => move(h, 1)} aria-label="Move down" className="p-2">
              <ArrowDown size={16} />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => call(`/api/admin/image-hosts/${h.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !h.enabled, clearError: !h.enabled }) })}
              className="rounded border border-border px-2 py-1 text-xs"
            >
              {h.enabled ? "Disable" : "Enable"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => call(`/api/admin/image-hosts/${h.id}`, { method: "DELETE" })}
              aria-label="Delete"
              className="p-2 text-red-400"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="mb-3 font-medium">Add a host</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <select
            value={draft.provider}
            onChange={(e) => setDraft({ ...draft, provider: e.target.value, secret: "" })}
            className="rounded border border-border bg-surface-2 p-2"
          >
            {PROVIDERS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Label (e.g. Main account)"
            className="rounded border border-border bg-surface-2 p-2"
          />
          {spec.needsSecret ? (
            <input
              type="password"
              value={draft.secret}
              onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
              placeholder={spec.secretLabel ?? ""}
              className="rounded border border-border bg-surface-2 p-2"
            />
          ) : (
            <span className="self-center text-xs text-text-faint">No key needed</span>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={add}
          className="mt-3 inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm font-medium"
        >
          <Plus size={16} /> Add
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the page**

Create `app/(app)/admin/image-hosts/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { listImageHostStatuses } from "@/lib/photo-capture/hosts/config";
import { ImageHostsPanel } from "@/components/admin/ImageHostsPanel";

export const dynamic = "force-dynamic";

export default async function ImageHostsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) redirect("/dashboard");

  const hosts = await listImageHostStatuses();

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-1 text-2xl font-semibold">Image hosts</h1>
      <p className="mb-6 text-sm text-text-faint">
        Where captured Google Business Profile photos are re-hosted.
      </p>
      <ImageHostsPanel hosts={hosts} />
    </div>
  );
}
```

- [ ] **Step 5: Compare the page shell against a sibling admin page**

Open `app/(app)/admin/ai-models/page.tsx` and match its layout wrapper, heading markup and any shared shell component it uses. Adjust the new page so the two look like they belong to the same app — the classes above are a starting point, not a house style you should assume.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/image-hosts "app/(app)/admin/image-hosts" components/admin/ImageHostsPanel.tsx
git commit -m "feat(photo-capture): image host administration"
```

---

## Phase 4 — The extension bridge and capture

### Task 14: Capture normalisation (pure)

**Files:**
- Create: `photo-extractor/core/capture.js`
- Create: `photo-extractor/test/capture.test.js`

- [ ] **Step 1: Write the failing test**

Create `photo-extractor/test/capture.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toWirePhotos, MAX_PHOTOS } from '../core/capture.js';

const item = (id) => ({
  id,
  thumbUrl: `https://lh3.googleusercontent.com/p/${id}=w408-h306-k-no`,
  originalUrl: `https://lh3.googleusercontent.com/p/${id}=s0`,
  site: 'google-maps',
});

test('caps the harvest at 30', () => {
  assert.equal(MAX_PHOTOS, 30);
  const many = Array.from({ length: 45 }, (_, i) => item('ID' + i));
  assert.equal(toWirePhotos(many).length, 30);
});

test('maps to the wire shape', () => {
  assert.deepEqual(toWirePhotos([item('ABC')]), [{
    key: 'ABC',
    thumbUrl: 'https://lh3.googleusercontent.com/p/ABC=w408-h306-k-no',
    sourceUrl: 'https://lh3.googleusercontent.com/p/ABC=s0',
  }]);
});

test('drops anything that is not a google photo', () => {
  const bad = { id: 'x', thumbUrl: 'https://evil.example/a.jpg', originalUrl: 'https://evil.example/a.jpg', site: 'generic' };
  assert.deepEqual(toWirePhotos([bad]), []);
});

test('drops duplicates by id, keeping the first', () => {
  assert.equal(toWirePhotos([item('SAME'), item('SAME')]).length, 1);
});

test('handles an empty harvest', () => {
  assert.deepEqual(toWirePhotos([]), []);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd photo-extractor && node --test test/capture.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `photo-extractor/core/capture.js`:

```js
// Pure: turn harvested adapter items into the shape the LMS stores.
// No chrome/DOM dependencies — unit-testable under node --test.
import { isGooglePhotoUrl } from './url-tools.js';

export const MAX_PHOTOS = 30;

/**
 * Normalise, de-duplicate and cap a harvest.
 *
 * Only Google photo URLs survive: the LMS server (and imgbb) will fetch
 * `sourceUrl` later, so letting an arbitrary URL through here would hand a
 * server-side fetch to whatever was on the page.
 */
export function toWirePhotos(items, max = MAX_PHOTOS) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (out.length >= max) break;
    if (!it || seen.has(it.id)) continue;
    if (!isGooglePhotoUrl(it.thumbUrl) || !isGooglePhotoUrl(it.originalUrl)) continue;
    seen.add(it.id);
    out.push({ key: it.id, thumbUrl: it.thumbUrl, sourceUrl: it.originalUrl });
  }
  return out;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd photo-extractor && node --test test/capture.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add photo-extractor/core/capture.js photo-extractor/test/capture.test.js
git commit -m "feat(photo-extractor): pure capture normalisation"
```

---

### Task 15: The bridge and the capture window

**Files:**
- Create: `photo-extractor/content/lms-bridge.js`
- Modify: `photo-extractor/background/service-worker.js`
- Modify: `photo-extractor/manifest.json`

The LMS origin is `https://lms.sedsolutions.online/*` (confirmed by the operator). It must appear in **both** `host_permissions` and `content_scripts.matches` or the bridge silently never loads.

**Country-domain mismatch — handle this in the service worker, not the manifest.** `isGoogleProfileLink` accepts `google.co.uk`, `google.com.au` and every other Google ccTLD, but the extension's content script only matches `https://www.google.com/maps/*` and `https://maps.google.com/*`. Chrome match patterns cannot express `google.*` (the host wildcard is only valid as a leading `*.` label), so widening the manifest would mean enumerating ~190 domains. Instead, **normalise the URL before opening the capture window**: a Maps place URL is portable across ccTLDs, so rewrite the host to `www.google.com`, keeping the path and query:

```js
function toDotCom(rawUrl) {
  try {
    const u = new URL(rawUrl);
    // google.co.uk/maps/place/X → www.google.com/maps/place/X. The content
    // script only matches .com hosts; without this, a ccTLD link opens a window
    // where nothing is injected and the capture silently returns zero photos.
    if (/^(?:www\.)?google\./.test(u.hostname)) u.hostname = "www.google.com";
    else if (/^maps\.google\./.test(u.hostname)) u.hostname = "maps.google.com";
    return u.toString();
  } catch { return rawUrl; }
}
```

Apply it to `msg.url` in the CAPTURE handler. Short links (`maps.app.goo.gl`, `g.page`) are left alone — they redirect to a `.com` host themselves.

- [ ] **Step 1: Write the bridge content script**

Create `photo-extractor/content/lms-bridge.js`:

```js
// Runs on the LMS origin ONLY. The bridge between the web page and the
// extension.
//
// WHY THIS DIRECTION. An unpacked extension's ID is a hash of the folder it was
// loaded from, and every agent unzips somewhere different — so the page has no
// stable ID to call `chrome.runtime.sendMessage(id, …)` with. Instead the
// extension announces itself and the page answers. No ID anywhere.
(() => {
  const PAGE = 'sed-lms';
  const EXT = 'sed-photo-ext';
  const version = chrome.runtime.getManifest().version;

  const post = (msg) => window.postMessage({ source: EXT, ...msg }, window.location.origin);

  window.addEventListener('message', (event) => {
    // Only messages this page sent to itself. Anything else is not ours.
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== PAGE) return;

    if (data.type === 'PING') { post({ type: 'READY', version }); return; }

    if (data.type === 'CAPTURE') {
      chrome.runtime.sendMessage({ type: 'CAPTURE', url: data.url, max: data.max }, (res) => {
        if (chrome.runtime.lastError) {
          post({ type: 'ERROR', requestId: data.requestId, error: chrome.runtime.lastError.message });
          return;
        }
        if (res?.ok) post({ type: 'DONE', requestId: data.requestId, photos: res.photos, version });
        else post({ type: 'ERROR', requestId: data.requestId, error: res?.error || 'Capture failed' });
      });
    }
  });

  // Relay progress pushed by the service worker mid-capture.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'CAPTURE_PROGRESS') post({ type: 'PROGRESS', loaded: msg.loaded });
  });

  post({ type: 'READY', version });
})();
```

- [ ] **Step 2: Add capture orchestration to the service worker**

Append to `photo-extractor/background/service-worker.js`:

```js
import { toWirePhotos, MAX_PHOTOS } from '../core/capture.js';

// ---- automatic capture, driven by the LMS page ----
//
// The popup window must be VISIBLE: Chrome throttles timers and suspends
// rendering in hidden tabs, which starves the gallery scroll loop. Unfocused is
// fine, minimized is not — so we open a real window, unfocused, and close it.
const CAPTURE_TIMEOUT_MS = 90_000;
let capturing = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'CAPTURE') return;
  (async () => {
    if (capturing) { sendResponse({ ok: false, error: 'Another capture is already running' }); return; }
    capturing = true;
    let windowId = null;
    try {
      const win = await chrome.windows.create({ url: msg.url, type: 'popup', focused: false, width: 1100, height: 900 });
      windowId = win.id;
      const tabId = win.tabs?.[0]?.id;
      if (!tabId) throw new Error('Could not open the capture window');

      await waitForLoad(tabId);
      await withTimeout(chrome.tabs.sendMessage(tabId, { type: 'LOAD_ALL' }), CAPTURE_TIMEOUT_MS);
      const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_ITEMS' });
      const photos = toWirePhotos(res?.items ?? [], msg.max || MAX_PHOTOS);
      sendResponse({ ok: true, photos });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    } finally {
      capturing = false;
      if (windowId != null) { try { await chrome.windows.remove(windowId); } catch { /* already closed */ } }
    }
  })();
  return true; // async sendResponse
});

// Relay progress to the LMS tab. `content.js` broadcasts PROGRESS via runtime
// messaging, which reaches extension pages but NOT content scripts — and the
// bridge is a content script in a different tab. Without this the operator
// watches "Capturing… 0 found" for the whole run and assumes it hung.
// (Track the requesting tab as `activeCaptureTabId` in the CAPTURE handler from
// `sender.tab?.id`, and clear it in the same `finally` that clears `capturing`.)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'PROGRESS' && activeCaptureTabId != null) {
    chrome.tabs.sendMessage(activeCaptureTabId, { type: 'CAPTURE_PROGRESS', loaded: msg.loaded }).catch(() => {});
  }
});

function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('The profile page did not finish loading')); }, 30_000);
    const listener = (id, info) => {
      if (id !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      // The content script runs at document_idle; give it a beat to register.
      setTimeout(resolve, 1200);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Capture timed out')), ms)),
  ]);
}
```

- [ ] **Step 3: Update the manifest**

Edit `photo-extractor/manifest.json`: bump `version` to `0.2.0`, add the LMS host permission, and register the bridge content script.

```json
{
  "manifest_version": 3,
  "name": "Business Photo Extractor",
  "version": "0.2.0",
  "description": "Extract and download original-resolution photos from Google Maps and Yelp business galleries.",
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "icons": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" },
  "action": {
    "default_title": "Extract business photos",
    "default_icon": { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" }
  },
  "side_panel": { "default_path": "sidepanel/sidepanel.html" },
  "permissions": ["activeTab", "scripting", "downloads", "sidePanel", "storage", "tabs"],
  "host_permissions": [
    "https://www.google.com/maps/*",
    "https://maps.google.com/*",
    "https://maps.app.goo.gl/*",
    "https://*.googleusercontent.com/*",
    "https://www.yelp.com/*",
    "https://*.yelpcdn.com/*",
    "https://api.imgbb.com/*",
    "https://lms.sedsolutions.online/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://www.google.com/maps/*",
        "https://maps.google.com/*",
        "https://www.yelp.com/biz/*",
        "https://www.yelp.com/biz_photos/*"
      ],
      "js": ["content/content.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://lms.sedsolutions.online/*"],
      "js": ["content/lms-bridge.js"],
      "run_at": "document_idle"
    }
  ]
}
```

`"tabs"` is newly required: `waitForLoad` uses `chrome.tabs.onUpdated`, which only reports `status` with that permission.

- [ ] **Step 4: Pin the extension ID**

Generate a keypair and add its public key as `"key"` so every agent's install resolves to the same extension ID regardless of where they unzip:

```bash
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out photo-extractor-key.pem && openssl rsa -in photo-extractor-key.pem -pubout -outform DER | openssl base64 -A
```

Add the printed base64 string as a top-level `"key"` in `manifest.json`. **Keep `photo-extractor-key.pem` out of the repo** — add it to `.gitignore` and hand it to the operator to store safely. Losing it only means the ID changes on a future rebuild; leaking it lets someone else publish under that identity.

- [ ] **Step 5: Test the whole capture path by hand**

1. Reload the unpacked extension.
2. Open any LMS page and check the console for the `READY` handshake:

```js
window.addEventListener('message', e => e.data?.source === 'sed-photo-ext' && console.log(e.data));
window.postMessage({ source: 'sed-lms', type: 'PING' }, location.origin);
```

Expected: `{source:'sed-photo-ext', type:'READY', version:'0.2.0'}`.

3. Trigger a capture from the same console:

```js
window.postMessage({ source: 'sed-lms', type: 'CAPTURE', requestId: 't1', url: 'https://www.google.com/maps/place/<a real business>', max: 30 }, location.origin);
```

Expected: an unfocused popup window opens, scrolls, closes itself, and a `DONE` message arrives with up to 30 `{key, thumbUrl, sourceUrl}` objects.

- [ ] **Step 6: Run the extension suite**

Run: `cd photo-extractor && npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add photo-extractor/content/lms-bridge.js photo-extractor/background/service-worker.js photo-extractor/manifest.json .gitignore
git commit -m "feat(photo-extractor): LMS bridge and automatic capture window"
```

---

## Phase 5 — The LMS user interface

### Task 16: The bridge client hook and the install card

**Files:**
- Create: `hooks/usePhotoExtension.ts`
- Create: `components/leads/ExtensionInstallCard.tsx`
- Create: `app/api/extension/version/route.ts`
- Create: `scripts/build-extension.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the build script**

Create `scripts/build-extension.mjs`:

```js
// Zips photo-extractor/ into public/downloads/ so agents can install it.
// Uses fflate, already a dependency. Run via `npm run build:extension`.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { zipSync } from "fflate";

const SRC = "photo-extractor";
const OUT_DIR = "public/downloads";
const SKIP = new Set(["node_modules", "test", "docs", ".git"]);

function collect(dir, files = {}) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, files);
    else files[relative(SRC, full).split("\\").join("/")] = new Uint8Array(readFileSync(full));
  }
  return files;
}

const { version } = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
mkdirSync(OUT_DIR, { recursive: true });
const name = `business-photo-extractor-v${version}.zip`;
writeFileSync(join(OUT_DIR, name), zipSync(collect(SRC), { level: 6 }));
console.log(`Wrote ${OUT_DIR}/${name}`);
```

- [ ] **Step 2: Wire it into package.json**

Add to `scripts` in `package.json`, and make `build` produce the zip too so a deployment can never ship a stale download:

```json
    "build": "npm run build:extension && next build",
    "build:extension": "node scripts/build-extension.mjs",
```

- [ ] **Step 3: Run it**

Run: `npm run build:extension`
Expected: `Wrote public/downloads/business-photo-extractor-v0.2.0.zip`.

- [ ] **Step 4: Write the version route**

Create `app/api/extension/version/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

/**
 * The version agents should be running, and where to get it. Read from the
 * extension's own manifest so it can never disagree with the zip.
 */
export async function GET() {
  try {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "photo-extractor", "manifest.json"), "utf8")) as {
      version: string;
    };
    return NextResponse.json({
      version: manifest.version,
      downloadUrl: `/downloads/business-photo-extractor-v${manifest.version}.zip`,
    });
  } catch {
    return NextResponse.json({ error: "Extension build not available" }, { status: 503 });
  }
}
```

- [ ] **Step 5: Write the hook**

Create `hooks/usePhotoExtension.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client half of the extension bridge (see the design, §4).
 *
 * The extension announces itself with READY, so "installed" is never guessed
 * from a timeout — no handshake simply means not installed yet.
 */

export type WirePhoto = { key: string; thumbUrl: string; sourceUrl: string };

export type ExtensionState = {
  installed: boolean;
  version: string | null;
  capturing: boolean;
  progress: number;
};

const PAGE = "sed-lms";
const EXT = "sed-photo-ext";

export function usePhotoExtension() {
  const [state, setState] = useState<ExtensionState>({ installed: false, version: null, capturing: false, progress: 0 });
  const pending = useRef<Map<string, { resolve: (p: WirePhoto[]) => void; reject: (e: Error) => void }>>(new Map());

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; [k: string]: unknown };
      if (data?.source !== EXT) return;

      if (data.type === "READY") {
        setState((s) => ({ ...s, installed: true, version: (data.version as string) ?? null }));
      } else if (data.type === "PROGRESS") {
        setState((s) => ({ ...s, progress: (data.loaded as number) ?? 0 }));
      } else if (data.type === "DONE") {
        const entry = pending.current.get(data.requestId as string);
        pending.current.delete(data.requestId as string);
        setState((s) => ({ ...s, capturing: false }));
        entry?.resolve((data.photos as WirePhoto[]) ?? []);
      } else if (data.type === "ERROR") {
        const entry = pending.current.get(data.requestId as string);
        pending.current.delete(data.requestId as string);
        setState((s) => ({ ...s, capturing: false }));
        entry?.reject(new Error((data.error as string) ?? "Capture failed"));
      }
    }

    window.addEventListener("message", onMessage);
    // Ask, in case the extension loaded before this component mounted.
    window.postMessage({ source: PAGE, type: "PING" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const capture = useCallback((url: string): Promise<WirePhoto[]> => {
    return new Promise((resolve, reject) => {
      const requestId = `cap_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      pending.current.set(requestId, { resolve, reject });
      setState((s) => ({ ...s, capturing: true, progress: 0 }));
      window.postMessage({ source: PAGE, type: "CAPTURE", requestId, url, max: 30 }, window.location.origin);
    });
  }, []);

  return { ...state, capture };
}
```

- [ ] **Step 6: Write the install card**

Create `components/leads/ExtensionInstallCard.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Download, Copy, Check } from "lucide-react";

/**
 * Shown when no extension handshake has arrived, or when the installed build is
 * older than the current one.
 *
 * The button downloads a zip; it CANNOT install. Chrome removed inline
 * installation in Chrome 71 — a web page has no way to add an extension. Step 2
 * is a copy button rather than a link because Chrome blocks pages from
 * navigating to chrome:// URLs.
 */
export function ExtensionInstallCard({ installed, version }: { installed: boolean; version: string | null }) {
  const [latest, setLatest] = useState<{ version: string; downloadUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/extension/version")
      .then((r) => (r.ok ? r.json() : null))
      .then(setLatest)
      .catch(() => setLatest(null));
  }, []);

  const outdated = installed && !!latest && !!version && version !== latest.version;
  if ((installed && !outdated) || !latest) return null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <h3 className="font-medium">
        {outdated ? `Update available — v${latest.version}` : "Photo capture needs the browser extension"}
      </h3>
      <p className="mt-1 text-sm text-text-faint">
        {outdated
          ? `You are running v${version}. Download the new build and reload it in Chrome.`
          : "Install it once and photos are captured from Google profiles automatically."}
      </p>

      <a
        href={latest.downloadUrl}
        download
        className="mt-3 inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm font-medium"
      >
        <Download size={16} /> Download extension v{latest.version}
      </a>

      <ol className="mt-3 space-y-1 text-sm text-text-faint">
        <li>1. Unzip the download somewhere permanent (moving it later breaks the install).</li>
        <li className="flex items-center gap-2">
          2. Open
          <code className="rounded bg-surface-2 px-1.5 py-0.5">chrome://extensions</code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText("chrome://extensions").then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
          </button>
        </li>
        <li>3. Turn on <strong>Developer mode</strong> (top right).</li>
        <li>4. Click <strong>Load unpacked</strong> and pick the unzipped folder.</li>
      </ol>
      <p className="mt-2 text-xs text-text-faint">
        Chrome shows a &ldquo;Disable developer mode extensions&rdquo; warning on startup. It is expected — dismiss it.
      </p>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add hooks/usePhotoExtension.ts components/leads/ExtensionInstallCard.tsx app/api/extension/version scripts/build-extension.mjs package.json
git commit -m "feat(photo-capture): extension bridge client, install card and build script"
```

---

### Task 17: The picker, and wiring capture into the lead flow

This task implements all three capture triggers from the design (§5): (a) automatically after a lead is created, in `NewLeadForm`; (b) automatically when the profile link has been edited since the last capture, via the picker's auto-capture effect; (c) manually, via the **Capture photos** button.

**Files:**
- Create: `components/leads/LeadPhotoPicker.tsx`
- Modify: `components/leads/LeadDetail.tsx:351-353`
- Modify: `components/leads/NewLeadForm.tsx:246-248`

- [ ] **Step 1: Write the picker**

Create `components/leads/LeadPhotoPicker.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2 } from "lucide-react";
import { isGoogleProfileLink } from "@/lib/photo-capture/googleLink";
import { usePhotoExtension } from "@/hooks/usePhotoExtension";
import { ExtensionInstallCard } from "./ExtensionInstallCard";
import { useToast } from "@/components/common/Toast";

type Candidate = {
  id: string;
  photoKey: string;
  thumbUrl: string;
  status: "pending" | "uploading" | "uploaded" | "failed" | "skipped";
  hostedUrl: string | null;
  error: string | null;
};

type CaptureState = {
  status: "pending" | "ready" | "none_found" | "failed";
  profileLink: string | null;
  foundCount: number;
  error: string | null;
} | null;

export function LeadPhotoPicker({
  leadId,
  profileLink,
  canEdit,
}: {
  leadId: string;
  profileLink: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const ext = usePhotoExtension();
  const [capture, setCapture] = useState<CaptureState>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);

  const [loaded, setLoaded] = useState(false);
  const autoFired = useRef<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/leads/${leadId}/photos`);
    if (!res.ok) return;
    const data = (await res.json()) as { capture: CaptureState; candidates: Candidate[] };
    setCapture(data.capture);
    setCandidates(data.candidates);
    setLoaded(true);
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runCapture = useCallback(async () => {
    if (!profileLink) return;

    // EVERY call here must check `ok`. The server now returns a 500 when the
    // store fails (e.g. the migration is not applied) — ignoring that would
    // leave the operator watching a spinner, or worse, show "Captured 18
    // photos" for a harvest that was never saved.
    const started = await fetch(`/api/leads/${leadId}/photos/candidates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "started", profileLink }),
    });
    if (!started.ok) {
      toast.show((await started.json().catch(() => ({}))).error ?? "Could not start the capture");
      return;
    }
    setCapture({ status: "pending", profileLink, foundCount: 0, error: null });
    try {
      const photos = await ext.capture(profileLink);
      const saved = await fetch(`/api/leads/${leadId}/photos/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "done", profileLink, photos, extensionVersion: ext.version }),
      });
      if (!saved.ok) {
        toast.show((await saved.json().catch(() => ({}))).error ?? "Captured, but could not save the photos");
        await load();
        return;
      }
      toast.show(photos.length ? `Captured ${photos.length} photos` : "No photos found on that profile");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Capture failed";
      await fetch(`/api/leads/${leadId}/photos/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "failed", error: message }),
      });
      toast.show(message);
    }
    await load();
  }, [leadId, profileLink, ext, toast, load]);

  /**
   * Auto-capture. Two cases, one rule: run when this lead has never been
   * captured, or when the profile link has been EDITED since the last capture
   * (the design's trigger (b)). `autoFired` keeps it to once per link per
   * mount, so a failed capture does not spin.
   */
  useEffect(() => {
    if (!loaded || !profileLink || !ext.installed || ext.capturing || !canEdit) return;
    if (!isGoogleProfileLink(profileLink)) return;
    if (capture && capture.profileLink === profileLink) return;
    if (autoFired.current === profileLink) return;
    autoFired.current = profileLink;
    void runCapture();
  }, [loaded, profileLink, ext.installed, ext.capturing, canEdit, capture, runCapture]);

  async function upload() {
    const photoKeys = candidates.filter((c) => selected.has(c.id)).map((c) => c.photoKey);
    if (photoKeys.length === 0) return;
    setUploading(true);
    const res = await fetch(`/api/leads/${leadId}/photos/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoKeys }),
    });
    setUploading(false);
    if (!res.ok) {
      toast.show((await res.json().catch(() => ({}))).error ?? "Upload failed");
      return;
    }
    const { uploaded, failed } = (await res.json()) as { uploaded: string[]; failed: { error: string }[] };
    toast.show(`${uploaded.length} uploaded${failed.length ? ` · ${failed.length} failed` : ""}`);
    setSelected(new Set());
    await load();
    router.refresh();
  }

  if (!profileLink) return null;

  const pickable = candidates.filter((c) => c.status !== "uploaded");

  return (
    <div className="space-y-3">
      <ExtensionInstallCard installed={ext.installed} version={ext.version} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canEdit || ext.capturing || !ext.installed}
          onClick={runCapture}
          className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {ext.capturing ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
          {ext.capturing ? `Capturing… ${ext.progress} found` : candidates.length ? "Re-capture photos" : "Capture photos"}
        </button>
        {capture?.status === "failed" && <span className="text-sm text-red-400">{capture.error}</span>}
        {capture?.status === "none_found" && <span className="text-sm text-text-faint">No photos found on that profile.</span>}
      </div>

      {candidates.length > 0 && (
        <>
          <div className="flex items-center gap-3 text-sm">
            <button type="button" onClick={() => setSelected(new Set(pickable.map((c) => c.id)))} className="underline">
              Select all
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="underline">
              None
            </button>
            <span className="text-text-faint">
              <b>{selected.size}</b> selected
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {candidates.map((c) => {
              const done = c.status === "uploaded";
              const isSelected = selected.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={done || !canEdit}
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                  className={`relative aspect-square overflow-hidden rounded border-2 ${
                    done ? "border-green-500/60 opacity-60" : isSelected ? "border-accent" : "border-transparent"
                  }`}
                  title={c.error ?? undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.thumbUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                  {(done || isSelected) && (
                    <span className="absolute right-1 top-1 rounded-full bg-black/70 p-1">
                      <Check size={12} className={done ? "text-green-400" : "text-white"} />
                    </span>
                  )}
                  {c.status === "failed" && <span className="absolute inset-x-0 bottom-0 bg-red-500/80 text-[10px]">failed</span>}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            disabled={!canEdit || uploading || selected.size === 0}
            onClick={upload}
            className="inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {uploading && <Loader2 size={16} className="animate-spin" />}
            Use selected photos
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Check the toast API before you rely on it**

Open `components/common/Toast.tsx` and confirm the method name used above (`toast.show(...)`). If the context exposes a different name or signature, fix every call in `LeadPhotoPicker.tsx` to match. Do not change the Toast component.

- [ ] **Step 3: Mount the picker in the Images group**

In `components/leads/LeadDetail.tsx`, add the import next to the other lead-component imports:

```tsx
import { LeadPhotoPicker } from "@/components/leads/LeadPhotoPicker";
```

Then replace the Images `SectionCard` body (currently lines 351-353) with:

```tsx
          <SectionCard n={5} icon={ImageIcon} title="Images" subtitle="Reference imagery" done={false} delay={240}>
            <div className="space-y-4">
              <LeadPhotoPicker leadId={lead.id} profileLink={lead.business_profile_link} canEdit={canEdit} />
              <FieldRow label="Image links (one per line)" value={(lead.image_links ?? []).join("\n")} type="textarea" copy={(lead.image_links ?? []).join("\n")} canEdit={canEdit} onSave={(v) => patch({ image_links: lines(v) })} />
            </div>
          </SectionCard>
```

The textarea stays: manual entry must keep working, and uploaded URLs simply appear in it.

- [ ] **Step 4: Trigger capture automatically after a lead is created**

In `components/leads/NewLeadForm.tsx`, add the imports:

```tsx
import { usePhotoExtension } from "@/hooks/usePhotoExtension";
import { isGoogleProfileLink } from "@/lib/photo-capture/googleLink";
```

Add the hook next to the component's other hooks:

```tsx
  const photoExt = usePhotoExtension();
```

Then in `submit`, replace the final two lines (currently `router.push(...)` and `router.refresh()` at lines 246-248) with:

```tsx
    const { id } = await res.json();

    // Fire-and-forget: the lead is saved either way, and the agent must never
    // wait on a browser capture. A missing extension simply does nothing —
    // the lead's Images group offers a Capture photos button instead.
    if (photoExt.installed && isGoogleProfileLink(f.business_profile_link)) {
      void (async () => {
        try {
          await fetch(`/api/leads/${id}/photos/candidates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "started", profileLink: f.business_profile_link }),
          });
          const photos = await photoExt.capture(f.business_profile_link);
          await fetch(`/api/leads/${id}/photos/candidates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "done",
              profileLink: f.business_profile_link,
              photos,
              extensionVersion: photoExt.version,
            }),
          });
        } catch (e) {
          await fetch(`/api/leads/${id}/photos/candidates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "failed", error: e instanceof Error ? e.message : "Capture failed" }),
          });
        }
      })();
    }

    router.push(`/leads/${id}`);
    router.refresh();
```

Check the field name on the form state object first: open `lib/leads/newLeadForm.ts` and confirm it is `business_profile_link`. Use whatever that file actually declares.

- [ ] **Step 5: Show the install card above the New Lead form**

In `NewLeadForm.tsx`, render it just inside the `<form>` element (line 341), so an agent without the extension is told before they submit:

```tsx
      <div className="lg:col-span-2">
        <ExtensionInstallCard installed={photoExt.installed} version={photoExt.version} />
      </div>
```

with the import:

```tsx
import { ExtensionInstallCard } from "@/components/leads/ExtensionInstallCard";
```

- [ ] **Step 6: Typecheck, lint, and run the whole suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no type errors, no lint errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add components/leads/LeadPhotoPicker.tsx components/leads/LeadDetail.tsx components/leads/NewLeadForm.tsx
git commit -m "feat(photo-capture): photo picker in the lead Images group"
```

---

### Task 18: End-to-end verification

No code. This is the acceptance gate, and it needs the operator to have applied migration `0061` and added at least one imgbb key.

- [ ] **Step 1: Confirm the preconditions**

Migration `0061` applied; at least one imgbb key saved at `/admin/image-hosts`; the extension v0.2.0 loaded unpacked.

- [ ] **Step 2: Capture on create**

Create a lead with a real Google Maps business URL in the profile link field. Expected: the lead saves immediately, a popup window opens unfocused, works for ~10–25 s, and closes itself.

- [ ] **Step 3: Pick and upload**

Open the lead. Expected: the Images group shows a thumbnail grid. Select three, click **Use selected photos**. Expected: a toast reports `3 uploaded`, the three thumbnails gain a green check, and three `https://i.ibb.co/...` URLs appear in the Image links textarea.

- [ ] **Step 4: Verify the stored data**

Confirm `leads.image_links` contains the three URLs and that each one loads in a browser tab.

- [ ] **Step 5: Verify the fallback**

Disable the imgbb host at `/admin/image-hosts`, then upload two more photos. Expected: they succeed via postimages or imgchest, and the candidates' `host_provider` reflects it. Re-enable imgbb afterwards.

- [ ] **Step 6: Verify idempotency**

Click **Re-capture photos**. Expected: already-uploaded photos keep their green check and their hosted URL; no duplicates appear in `image_links`.

- [ ] **Step 7: Verify auto-capture on an edited link**

Take a lead that has never been captured (or edit an existing lead's profile link to a **different** Google business). Open it. Expected: a capture starts on its own, without pressing anything, because the stored `profile_link` no longer matches the lead's. Then reload the page: expected: it does **not** capture again, because they now match.

- [ ] **Step 8: Verify the no-extension path**

In a Chrome profile without the extension, open a lead with a Google link. Expected: the install card appears, the **Capture photos** button is disabled, no auto-capture fires, and nothing errors.

- [ ] **Step 9: Report**

Write up what passed, what did not, and anything the operator still needs to do.

---

## Notes for whoever executes this

- **`0061` is not yours to apply.** The DB is shared production. Hand it to the operator.
- **The LMS origin is `https://lms.sedsolutions.online/*`** (confirmed by the operator). It must appear in both `host_permissions` and `content_scripts` or the bridge silently never loads. For local development against `localhost`, add that origin too — the bridge only runs where the manifest says it may.
- **Do not skip Task 2.** It is the difference between fixing the stale-photo bug and changing code that looked suspicious.
- Phases 1–3 need no extension at all and can be verified on their own. Phase 4 onward needs Chrome.
