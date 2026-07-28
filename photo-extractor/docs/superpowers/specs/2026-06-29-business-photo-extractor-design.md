# Business Photo Extractor — Chrome Extension Design

**Date:** 2026-06-29
**Status:** Approved (design phase)
**Author:** Claude (Opus 4.8) with the user
**Distribution:** Personal, load-unpacked (Manifest V3)

---

## 1. Overview & Goals

A Chrome extension (Manifest V3) that, on a business page the user has **already opened** on **Google Maps** (primary) or **Yelp** (secondary), extracts every photo in the business's gallery, presents them in a selectable grid in a **Side Panel**, and downloads the user's selection at **original / maximum resolution** — either as individual files or a single ZIP.

Design priorities, in order:

1. **Correctness of "original size"** — never download a thumbnail when a larger source exists. Upgrade every URL to its maximum resolution.
2. **Reliability ("never fails")** — partial failures never abort the batch; the gallery is fully loaded before extraction; site-markup drift is isolated to a single small file and reported clearly.
3. **Control** — select/filter/name/resolution/zip, with live progress and a Stop button.

### Success criteria

- On a Google Maps business with N photos, the extension loads **all N** (not just the first viewport), and downloads them at native resolution (`=s0`), verified by the downloaded files being materially larger than the on-page thumbnails.
- On a Yelp business, it extracts every gallery photo at `o.jpg` (Yelp's maximum).
- A single failed image (404/timeout) is skipped and reported; the rest still download.
- When a site changes its markup and the primary selectors return 0 results, the user sees an actionable "adapter may be stale" message, not a silent empty result.

---

## 2. Scope

**In scope**

- Google Maps business photo galleries (the "Photos" surface on `google.com/maps/place/...`).
- Yelp business photo galleries (`yelp.com/biz/<slug>` and `yelp.com/biz_photos/<slug>`).
- Select + bulk download, full-resolution upgrade, single-ZIP option, auto-scroll/load-all, category filtering, filename templating.

**Out of scope (non-goals)**

- Google Street View / panorama imagery (different pipeline: `streetviewpixels-pa.googleapis.com`, tile stitching). Explicitly excluded; may be a future adapter.
- The official Google Places API path (caps at 4800px, billed, requires API key) — not used because it cannot return true originals.
- Sites other than Google Maps and Yelp (the adapter registry makes these additive later).
- Any background/headless crawling. The tool acts **only** on a tab the user has manually opened.

---

## 3. Verified technical facts (the contract the code relies on)

These were verified via live web research and empirical CDN checks on **2026-06-29**. Each is the durable contract a per-site adapter depends on.

### 3.1 Google Maps photo URLs

- Host: `lh3` / `lh4` / `lh5.googleusercontent.com` (interchangeable).
- Path prefixes: `/p/<TOKEN>` (older) and `/gps-cs-s/<TOKEN>` (newer). `<TOKEN>` is the **immutable photo ID**.
- Everything after the **final `=`** is a hyphen-joined size/transform suffix and is freely rewritable.
- **Original/native resolution:** replace the suffix with `=s0`.
  - Primary transform: `url.replace(/=[-\w]+$/, '=s0')`
  - Defensive variant (only rewrite after the last `=`, handle no-suffix URLs):
    ```js
    function toOriginalGoogle(u){
      const i = u.lastIndexOf('=');
      return (i > u.lastIndexOf('/')) ? u.slice(0, i + 1) + 's0' : u + '=s0';
    }
    ```
  - **Fallback** if `=s0` ever returns something odd: `=w16383` (Google clamps width/height to 16383px, so any real photo returns native). Never use `-c` (hard square crop) when the goal is the true original.
- Suffix grammar reference (for the optional resolution dropdown): `w<N>`=width, `h<N>`=height, `s<N>`=longest-edge box, `c`=square crop, `p`=smart crop, `k`=disable animation, `no`=strip overlay. `s0`/`w0`/`h0`=original.
- **DOM reality:** gallery thumbnails are CSS `background-image` on `<div>`/`<button>`/`[role=img]` elements, **not** `<img src>`. Result-card/review images may be real `<img>`. Both must be read.
- **De-duplicate by the immutable `<TOKEN>`** (the same photo appears at multiple sizes/hosts across the page).
- The gallery is **virtualized/lazy-loaded**: only near-viewport tiles have `background-image` set. Must scroll the gallery container and harvest incrementally.
- **Avoided:** the internal `/maps/rpc/photo/listentityphotos` (`pb` protobuf) endpoint — high-confidence research says it is the most brittle option and clearly against ToS. DOM scrape + suffix rewrite is the durable approach.
- **Note:** the `gps-cs-s` prefix should be treated as an opaque newer prefix (the "Geo Photo Service" expansion is unverified). The googleusercontent grammar is an undocumented implementation detail and may change — hence the adapter + canary design.

### 3.2 Yelp photo URLs

- Host: `s3-media{0-4}.fl.yelpcdn.com`. Path: `/bphoto/<PHOTO_ID>/<code>.jpg`. `<PHOTO_ID>` is a ~22-char `[A-Za-z0-9_-]` token.
- **Maximum resolution = `o.jpg`** — empirically the largest Yelp serves: **capped at ~1000px long edge, aspect preserved** (measured 1000×666 / 1000×750 / 750×1000 on 2026-06-29). There is nothing larger; this is a Yelp ceiling.
- Transform any code → original by replacing only the final segment:
  ```js
  function toOriginalYelp(u){
    return u.replace(/(\/bphoto\/[A-Za-z0-9_-]+\/)[^/]+\.jpg/, '$1o.jpg');
  }
  ```
  Keep the same `s3-media{N}` shard and `<PHOTO_ID>` byte-for-byte.
- Valid size codes (FYI): `o, l, ls, m, s, xs, ms, ss, xss` (letter codes, documented) and numeric square crops `258s/300s/348s` seen in `srcset`. A `WxH.jpg` form is **not** valid (returns 403).
- **Most resilient extraction:** regex over rendered HTML rather than CSS selectors:
  ```js
  // over document.documentElement.outerHTML
  /yelpcdn\.com\/bphoto\/([A-Za-z0-9_-]+)\//g
  ```
  This catches IDs in `<img src>`, `srcset`, **and** the React JSON state in `<script>` simultaneously. Capture the `s3-media{N}` host alongside each ID and reuse it.
- Full gallery lives at `/biz_photos/<slug>`; it lazy-loads and has category tabs (`?tab=all|food|menu|inside|outside`). Scroll + iterate tabs (and/or read the embedded JSON state which often lists more IDs than are painted).
- The `yelpcdn.com` CDN returns HTTP 200 to direct GETs (not behind Yelp's DataDome anti-bot wall, which guards `yelp.com` HTML). Fetch images from the extension context to inherit normal headers.

### 3.3 Manifest V3 constraints (designed around)

- **`URL.createObjectURL` does NOT exist in the MV3 service worker.** → Build the ZIP and create the object URL in the **Side Panel page** (an extension page where `createObjectURL` works). No offscreen document needed in the recommended design.
- **Cross-origin image `fetch()`** must run in an extension context covered by `host_permissions` (the Side Panel page qualifies; a content script does **not** — it's bound by the page's CORS). Primary fetch path = Side Panel page; **fallback** = service-worker relay for any host where page-context fetch fails.
- **Service worker lifecycle:** killed after 30s idle / 5min per event / 30s slow fetch. → Keep heavy work (fetch+zip) in the Side Panel page (alive while open); SW stays a thin coordinator; persist progress to `chrome.storage.local` so any interruption resumes.
- `chrome.downloads.download({url, filename, conflictAction, saveAs})`: `filename` is relative to Downloads and may contain subfolders (no `..`, no absolute). Use `conflictAction:'uniquify'`, `saveAs:false` for silent batch saves.
- **No remote code** in MV3 — the ZIP library is bundled in the package.

### 3.4 ZIP + bulk fetch

- **Library: `client-zip`** (bundled). Smallest (~2.6kB gz), WHATWG-Streams based, **STORE-only** — which is correct for JPEGs (DEFLATE on already-compressed images wastes CPU for ~0% gain). Stream entries via an async generator so peak memory stays near `concurrency × avg image`.
- **Bulk fetch:** bounded concurrency pool (default 6), per-request `AbortController` timeout, retry on network/429/5xx with exponential backoff + jitter (honor `Retry-After`), one master `AbortController` for user-cancel, fail-fast on 404/malformed.

---

## 4. Architecture

Three contexts, thin service worker:

```
Content script (per-site adapter)        Side Panel (extension page)         Service worker (thin)
─────────────────────────────────        ───────────────────────────         ─────────────────────
- match() site                           - photo grid + selection            - open side panel on action
- waitReady()                            - filters / resolution / naming     - persist + relay state
- loadAll(onProgress)  ◀── messages ──▶  - fetch() originals (host perms)     - fallback fetch relay
  (auto-scroll, harvest)                 - client-zip → blob → download         (CORS edge cases)
- extractItems(): Photo[]                - progress / Stop / failure report
- getOriginalUrl(thumb)
```

**Data flow (happy path):**

1. User opens a Google Maps / Yelp business, clicks the toolbar icon → SW opens the Side Panel.
2. Side Panel asks the active tab's content script to **load all** photos. The adapter auto-scrolls the gallery container, harvesting `Photo` records incrementally into a Map keyed by stable photo ID, emitting progress.
3. Adapter returns `Photo[]` (thumbnail URL for display, original URL, photo ID, category, dimensions if known).
4. Side Panel renders the grid. User filters/selects, picks resolution, naming, and "individual files" vs "ZIP".
5. On download: Side Panel `fetch()`es each selected **original** URL through a bounded concurrency pool with retry; for ZIP, streams blobs into `client-zip` → one blob → `createObjectURL` → `chrome.downloads.download`; for individual files, `chrome.downloads.download` per URL with templated subfolder filename.
6. Live progress; failures collected; completion summary lists succeeded/failed/skipped with copyable failed URLs.

**Module boundaries** (each independently understandable/testable):

- `core/engine` — generic orchestration: scroll loop, dedup, retry/backoff, concurrency pool, progress events. Site-agnostic.
- `core/url-tools` — `toOriginalGoogle`, `toOriginalYelp`, `parsePhotoId`, URL validation. Pure functions, unit-tested.
- `core/zip` — wraps `client-zip` streaming.
- `core/download` — `chrome.downloads` wrapper, filename templating + sanitization.
- `adapters/google-maps.js`, `adapters/yelp.js`, `adapters/generic.js` — implement the `SiteAdapter` interface.
- `adapters/registry.js` — pick first adapter whose `match()` is true; else generic.
- `sidepanel/` — UI (grid, controls, progress).
- `background/service-worker.js` — coordinator + fallback relay.
- `content/content.js` — hosts the active adapter in the page context.

---

## 5. SiteAdapter interface

```ts
interface Photo {
  id: string;           // stable, immutable (dedup key)
  thumbUrl: string;     // small, for grid display
  originalUrl: string;  // upgraded to max resolution
  category?: string;    // e.g. "By owner", "Food & drink", "Menu", or Yelp tab
  width?: number;       // if known
  height?: number;
}

interface SiteAdapter {
  name: string;
  match(url: string, document: Document): boolean;
  waitReady(timeoutMs: number): Promise<void>;        // gallery present
  getScrollContainer(): HTMLElement | null;            // virtualized container
  loadAll(onProgress: (n: number) => void, signal: AbortSignal): Promise<void>; // auto-scroll
  extractItems(): Photo[];                              // harvest current DOM/JSON
  getOriginalUrl(thumbUrl: string): string;            // URL upgrade
  healthCheck(): { ok: boolean; reachedTier: string; count: number }; // canary
}
```

- **Google adapter:** reads `background-image` from `[role=img]`/`button[jsaction*="pane"]`/`a[data-photo-index]` **and** `<img[src*=googleusercontent]>`; parses photo ID from the `/p/` or `/gps-cs-s/` token; upgrades via `toOriginalGoogle`; categories from the gallery tab labels.
- **Yelp adapter:** regex over `outerHTML` for `bphoto` IDs (+ embedded JSON), iterates tabs, upgrades via `toOriginalYelp`.
- **Generic adapter:** largest repeated `<img>`/`<a>`-to-image cluster; no URL upgrade (best effort). Universal fallback so an unknown/changed layout still mostly works.

Selectors are stored as **ordered fallback chains** (data-/aria-/role/attribute-presence → structural), each wrapped in try/catch, with a Scrapling-style element-fingerprint relocator as last resort. No hashed class names, no `nth-child` chains.

---

## 6. Features

| Feature | Behavior |
|---|---|
| **Load all** | Auto-scroll the gallery container; multi-signal stop (scrollHeight stalled N iters OR item count stable OR end sentinel OR hard cap OR user Stop). Incremental harvest into a Map keyed by photo ID (survives virtualized node recycling). |
| **Select** | Grid with checkboxes, select-all/none, shift-click range, live selected count. |
| **Filter** | By category (chips derived from gallery tabs / photo metadata). |
| **Resolution** | Dropdown: Original (`=s0` / `o.jpg`, default), 2048, 1024. Google honors arbitrary widths; Yelp only has the fixed codes (UI notes Yelp's ~1000px ceiling). |
| **Naming** | Template `{business}/{business}_{NN}` with optional `{date}`; sanitized; conflict-safe (`uniquify`). |
| **Download mode** | Individual files (subfolder via `chrome.downloads`) or single ZIP (`client-zip`). |
| **Progress / Stop** | Live "loaded X", "downloaded Y/Z"; cooperative Stop flag checked each loop iteration. |
| **Failure report** | Completion summary: succeeded / failed / skipped counts + copyable failed-URL list with reasons. |

---

## 7. Robustness strategy ("never fails")

1. **Adapter isolation** — site breakage touches one file; generic fallback keeps unknown sites working.
2. **Structured-data-first** — prefer `__NEXT_DATA__`/`__INITIAL_STATE__`/embedded JSON over DOM where available (Yelp); DOM scrape otherwise (Google).
3. **Resilient selection** — ordered fallback chains + fingerprint relocation; never a single brittle selector.
4. **`waitForElement`** — checks existing nodes first, MutationObserver with `{childList,subtree}`, disconnect on resolve **and** timeout; polling fallback for non-node conditions.
5. **Auto-scroll** — scroll the detected container; multi-signal stop; hard iteration/time cap as an absolute brake; harvest incrementally.
6. **Per-image resilience** — each image in its own try/catch; retry transient (network/429/5xx) with backoff+jitter, honor `Retry-After`; fail-fast on 404/malformed; skip-and-record; `Promise.allSettled` + concurrency limiter; always return `{succeeded, failed, skipped, total}`.
7. **Idempotency/resume** — dedup by stable photo ID; persist incremental progress to `chrome.storage.local`; downloads continue at browser level even if SW is recycled.
8. **Defensive coding** — feature-detect (not UA sniffing); optional chaining / nullish coalescing; try/catch boundaries around selector eval, `JSON.parse`, fetch, observer callbacks; validate every URL via `new URL()` + http(s) check before download.
9. **Canary checks** — if a known adapter's primary selectors return 0, surface "`<adapter>` may be stale (0 results at tier T)" instead of a silent empty result.

---

## 8. Permissions & manifest

```jsonc
{
  "manifest_version": 3,
  "name": "Business Photo Extractor",
  "version": "0.1.0",
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "action": { "default_title": "Extract business photos" },
  "side_panel": { "default_path": "sidepanel/sidepanel.html" },
  "permissions": ["activeTab", "scripting", "downloads", "sidePanel", "storage"],
  "host_permissions": [
    "https://www.google.com/*", "https://www.google.*/maps/*",
    "https://*.googleusercontent.com/*",
    "https://www.yelp.com/*", "https://*.fl.yelpcdn.com/*"
  ],
  "content_scripts": [{
    "matches": ["https://www.google.com/maps/*", "https://www.google.*/maps/*", "https://www.yelp.com/biz/*", "https://www.yelp.com/biz_photos/*"],
    "js": ["content/content.js"],
    "run_at": "document_idle"
  }]
}
```

- Scoped `host_permissions` (the specific CDNs/sites) instead of `<all_urls>` — least privilege; covers cross-origin fetch of `googleusercontent.com` and `yelpcdn.com` from the Side Panel page.
- `activeTab` + `scripting` for on-demand DOM access; `downloads` for saving; `sidePanel` for the UI; `storage` for resume state.

---

## 9. Project structure

```
photo-extractor/
├─ manifest.json
├─ background/service-worker.js
├─ content/content.js
├─ sidepanel/{sidepanel.html, sidepanel.css, sidepanel.js}
├─ core/{engine.js, url-tools.js, zip.js, download.js, concurrency.js, selectors.js}
├─ adapters/{registry.js, google-maps.js, yelp.js, generic.js}
├─ vendor/client-zip.js          # bundled, no remote code
├─ icons/{16,48,128}.png
├─ test/                          # unit tests for url-tools, naming, concurrency, stop conditions
└─ docs/superpowers/specs/2026-06-29-business-photo-extractor-design.md
```

---

## 10. Error / UX states

- **Not a supported page** → "Open a Google Maps or Yelp business, then click the icon."
- **Gallery not found / 0 photos** → canary message naming the adapter + which selector tier was reached.
- **Login/anti-bot wall** → "Page is blocked or requires sign-in" (distinct from "site changed").
- **Partial download failure** → batch completes; summary lists failures with reasons + copyable URLs + a Retry-failed button.
- **User Stop** → loops exit at next checkpoint; partial results remain usable.

---

## 11. Caveats (carried from research)

- **Yelp maxes at ~1000px**; Google Maps yields true originals.
- **ToS**: both sites restrict automated collection. This tool is user-initiated, acts only on an already-open tab, rate-limits with jitter, and is intended for personal use — not mass harvesting. Respect copyright of downloaded photos.
- **Markup drift**: Google rotates obfuscated classes frequently; the adapter + canary design localizes and surfaces breakage. The URL-rewrite contract (the durable part) is stable.

---

## 12. Testing strategy

- **Unit (pure functions):** `toOriginalGoogle`/`toOriginalYelp` against a corpus of real URL shapes (both prefixes, both hosts, all Yelp codes); filename sanitization/templating; concurrency pool ordering + cancel; auto-scroll stop-condition state machine (mock scrollHeight/count sequences).
- **Manual / integration:** load-unpacked on live Google Maps + Yelp businesses (small and large galleries); verify all photos load, originals exceed thumbnails in dimensions, ZIP integrity, individual-file foldering, Stop mid-run, and a forced-404 appears in the failure report.
- **Canary:** simulate a renamed-class layout and confirm a stale-adapter message (not a silent empty result).

---

## 13. Future (explicitly deferred)

- Street View / panorama adapter (tile stitching).
- Additional sites (TripAdvisor, Facebook) via new adapters.
- EXIF/metadata sidecar; CSV manifest of captions/contributors.
