# Business Photo Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome extension that extracts all photos from an open Google Maps or Yelp business gallery and downloads the user's selection at maximum resolution (individual files or one ZIP), via a Side Panel UI.

**Architecture:** Thin service worker + per-site content-script adapters (registry pattern with a generic fallback) + a Side Panel extension page that owns selection, filtering, naming, full-resolution fetch, ZIP assembly, and downloads. Pure logic (URL upgrades, naming, concurrency, scroll stop-conditions, zip) lives in `core/` ES modules, unit-tested under `node --test`. DOM/Chrome glue is verified by loading unpacked on live pages.

**Tech Stack:** Vanilla JS ES modules (no bundler), Chrome MV3 APIs (`sidePanel`, `scripting`, `downloads`, `storage`), `client-zip` (bundled, STORE-only), Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-06-29-business-photo-extractor-design.md`

---

## Conventions

- **Run tests:** from the project root, `npm test` (alias for `node --test`). Requires Node 18+.
- **Load unpacked:** open `chrome://extensions`, enable Developer Mode, "Load unpacked" → select the project root. After any change to manifest/SW, click the reload ⟳ on the extension card.
- **Live-page verification:** open a Google Maps business (with a Photos section) or a Yelp `/biz/<slug>` page, click the extension toolbar icon (side panel opens), then follow the task's verification steps. Use DevTools (F12) on the page to confirm selectors when a task says so.
- **Commits:** conventional prefixes (`feat:`, `test:`, `chore:`). End each commit message body with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```
- **Selector tuning note:** the adapter DOM selectors (Tasks 13–14) are the parts most likely to need on-page tuning, because Google/Yelp rotate markup. The code provided is correct against the researched structure; if `healthCheck()` reports 0 on a live page, adjust that one adapter's selector list — that is expected maintenance, isolated by design.

---

## File Structure

```
photo-extractor/
├─ manifest.json                 # MV3 manifest, permissions, side_panel, content_scripts
├─ package.json                  # type:module, test script
├─ background/service-worker.js  # open side panel on click; fallback image-fetch relay
├─ content/
│  ├─ content.js                 # classic loader → dynamic-imports main.js (module)
│  └─ main.js                    # message handlers, auto-scroll loop driving the adapter
├─ sidepanel/
│  ├─ sidepanel.html             # markup + <script type=module>
│  ├─ sidepanel.css              # minimal clean styling
│  └─ sidepanel.js               # grid, selection, filters, resolution, naming, download
├─ core/
│  ├─ url-tools.js               # PURE: URL upgrades, id parsing, yelp-html extraction
│  ├─ naming.js                  # PURE: sanitize + filename templating
│  ├─ concurrency.js             # PURE: bounded pool + retry/backoff
│  ├─ scroll-state.js            # PURE: auto-scroll stop-condition monitor
│  ├─ zip.js                     # client-zip wrapper (blob builder)
│  ├─ download.js                # chrome.downloads + blob download wrappers
│  └─ dom.js                     # DOM helpers: waitFor, findScrollable
├─ adapters/
│  ├─ registry.js                # pickAdapter(url, doc)
│  ├─ google-maps.js             # SiteAdapter for Google Maps
│  ├─ yelp.js                    # SiteAdapter for Yelp
│  └─ generic.js                 # universal fallback adapter
├─ vendor/client-zip.js          # bundled ESM build (no remote code)
└─ test/
   ├─ url-tools.test.js
   ├─ naming.test.js
   ├─ concurrency.test.js
   ├─ scroll-state.test.js
   └─ zip.test.js
```

**Shared types (informal):**
```js
// Photo
{ id: string, thumbUrl: string, originalUrl: string, category?: string, site: string }
// Messages (chrome.runtime / chrome.tabs)
{ type:'PING' } -> { ok:true, site:string }
{ type:'LOAD_ALL' } -> streams { type:'PROGRESS', loaded:number } ; final { type:'DONE' }
{ type:'GET_ITEMS' } -> { site:string, items:Photo[], health:{ok,reachedTier,count} }
{ type:'STOP' } -> { ok:true }
{ type:'FETCH_IMAGE', url } -> { ok:true, base64, mime } | { ok:false, error }
```

---

# Phase 1 — Scaffold

### Task 1: Project scaffold + manifest + empty Side Panel

**Files:**
- Create: `package.json`, `manifest.json`, `sidepanel/sidepanel.html`, `sidepanel/sidepanel.css`, `sidepanel/sidepanel.js`, `background/service-worker.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "business-photo-extractor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Business Photo Extractor",
  "version": "0.1.0",
  "description": "Extract and download original-resolution photos from Google Maps and Yelp business galleries.",
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "action": { "default_title": "Extract business photos" },
  "side_panel": { "default_path": "sidepanel/sidepanel.html" },
  "permissions": ["activeTab", "scripting", "downloads", "sidePanel", "storage"],
  "host_permissions": [
    "https://www.google.com/maps/*",
    "https://www.google.*/maps/*",
    "https://*.googleusercontent.com/*",
    "https://www.yelp.com/*",
    "https://*.fl.yelpcdn.com/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://www.google.com/maps/*",
        "https://www.google.*/maps/*",
        "https://www.yelp.com/biz/*",
        "https://www.yelp.com/biz_photos/*"
      ],
      "js": ["content/content.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["content/main.js", "core/*.js", "adapters/*.js", "vendor/*.js"],
      "matches": ["https://www.google.com/*", "https://www.google.*/*", "https://www.yelp.com/*"]
    }
  ]
}
```

- [ ] **Step 3: Create `sidepanel/sidepanel.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="sidepanel.css" />
</head>
<body>
  <header>
    <h1>Photo Extractor</h1>
    <div id="status">Open a Google Maps or Yelp business, then reopen this panel.</div>
  </header>
  <main id="app"><!-- populated by sidepanel.js --></main>
  <script type="module" src="sidepanel.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create `sidepanel/sidepanel.css`**

```css
* { box-sizing: border-box; }
body { font: 13px/1.4 system-ui, sans-serif; margin: 0; color: #1a1a1a; }
header { padding: 10px 12px; border-bottom: 1px solid #e3e3e3; position: sticky; top: 0; background: #fff; z-index: 2; }
h1 { font-size: 14px; margin: 0 0 4px; }
#status { color: #666; font-size: 12px; }
main { padding: 10px 12px; }
button { font: inherit; padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; background: #f7f7f7; cursor: pointer; }
button.primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
button:disabled { opacity: .5; cursor: default; }
```

- [ ] **Step 5: Create placeholder `sidepanel/sidepanel.js`**

```js
const statusEl = document.getElementById('status');
statusEl.textContent = 'Side panel loaded. (Extraction wired up in later tasks.)';
```

- [ ] **Step 6: Create `background/service-worker.js`**

```js
// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => console.warn(e));
});
```

- [ ] **Step 7: Verify load-unpacked**

Load unpacked at `chrome://extensions`. Expected: extension card appears with no errors. Click the toolbar icon → the side panel opens showing "Side panel loaded." Click "Errors" on the card → none.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold MV3 extension with side panel and manifest

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Verify the test runner

**Files:**
- Create: `test/smoke.test.js`

- [ ] **Step 1: Write a trivial test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: Run it**

Run: `npm test`
Expected: PASS (1 test passed). If `node` is missing, install Node 18+ first; the extension still loads without it, but the unit tests below need it.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: add node --test smoke test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 2 — Core pure modules (TDD)

### Task 3: `core/url-tools.js` — URL upgrades, id parsing, Yelp HTML extraction

**Files:**
- Create: `core/url-tools.js`
- Test: `test/url-tools.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/url-tools.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidHttpUrl, isGooglePhotoUrl, isYelpPhotoUrl,
  parseGooglePhotoId, parseYelpPhotoId,
  toGoogleSize, toOriginalGoogle, toOriginalYelp, findYelpPhotoUrls,
} from '../core/url-tools.js';

const G_P = 'https://lh3.googleusercontent.com/p/AF1QipO-x7F8bvkQYKoJalEfrJ2c-C4yYf5EC5ISXYlQ=w408-h306-k-no';
const G_GPS = 'https://lh5.googleusercontent.com/gps-cs-s/AC9h4noABCdef_12-3=s112-w112-h112-p-k-no';
const G_NOSUF = 'https://lh3.googleusercontent.com/p/AF1QipTOKEN';

test('isValidHttpUrl', () => {
  assert.equal(isValidHttpUrl('https://x.com/a'), true);
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
  assert.equal(isValidHttpUrl('not a url'), false);
});

test('detects google photo urls', () => {
  assert.equal(isGooglePhotoUrl(G_P), true);
  assert.equal(isGooglePhotoUrl(G_GPS), true);
  assert.equal(isGooglePhotoUrl('https://example.com/x.jpg'), false);
});

test('parses google photo id from both prefixes', () => {
  assert.equal(parseGooglePhotoId(G_P), 'AF1QipO-x7F8bvkQYKoJalEfrJ2c-C4yYf5EC5ISXYlQ');
  assert.equal(parseGooglePhotoId(G_GPS), 'AC9h4noABCdef_12-3');
});

test('toGoogleSize rewrites the suffix after the last =', () => {
  assert.equal(toOriginalGoogle(G_P), 'https://lh3.googleusercontent.com/p/AF1QipO-x7F8bvkQYKoJalEfrJ2c-C4yYf5EC5ISXYlQ=s0');
  assert.equal(toOriginalGoogle(G_GPS), 'https://lh5.googleusercontent.com/gps-cs-s/AC9h4noABCdef_12-3=s0');
  assert.equal(toGoogleSize(G_P, 'w2048'), 'https://lh3.googleusercontent.com/p/AF1QipO-x7F8bvkQYKoJalEfrJ2c-C4yYf5EC5ISXYlQ=w2048');
});

test('toGoogleSize appends = when no suffix present', () => {
  assert.equal(toOriginalGoogle(G_NOSUF), G_NOSUF + '=s0');
});

test('yelp detection + original upgrade', () => {
  const thumb = 'https://s3-media2.fl.yelpcdn.com/bphoto/CPc91bGzKBe95aM5edjhhQ/348s.jpg';
  assert.equal(isYelpPhotoUrl(thumb), true);
  assert.equal(parseYelpPhotoId(thumb), 'CPc91bGzKBe95aM5edjhhQ');
  assert.equal(toOriginalYelp(thumb), 'https://s3-media2.fl.yelpcdn.com/bphoto/CPc91bGzKBe95aM5edjhhQ/o.jpg');
});

test('findYelpPhotoUrls dedupes ids across srcset and script json, returns o.jpg', () => {
  const html = `
    <img srcset="https://s3-media1.fl.yelpcdn.com/bphoto/AAA111aaa_bbb-CCC/258s.jpg 1x,
                 https://s3-media1.fl.yelpcdn.com/bphoto/AAA111aaa_bbb-CCC/348s.jpg 1.3x">
    <script>{"photoUrl":"https://s3-media3.fl.yelpcdn.com/bphoto/ZZZ999zzz_yyy-XXX/ls.jpg"}</script>
    <img src="https://s3-media1.fl.yelpcdn.com/bphoto/AAA111aaa_bbb-CCC/o.jpg">`;
  const got = findYelpPhotoUrls(html).map((p) => p.url).sort();
  assert.deepEqual(got, [
    'https://s3-media1.fl.yelpcdn.com/bphoto/AAA111aaa_bbb-CCC/o.jpg',
    'https://s3-media3.fl.yelpcdn.com/bphoto/ZZZ999zzz_yyy-XXX/o.jpg',
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../core/url-tools.js'`.

- [ ] **Step 3: Implement `core/url-tools.js`**

```js
// Pure URL helpers. No chrome/DOM dependencies — unit-testable under node --test.

const GOOGLE_HOST_RE = /^https?:\/\/[a-z0-9-]+\.googleusercontent\.com\//i;
const GOOGLE_TOKEN_RE = /\/(?:p|gps-cs-s)\/([^=/?#]+)/;
const YELP_ANY_RE = /yelpcdn\.com\/bphoto\//i;
const YELP_ID_RE = /\/bphoto\/([A-Za-z0-9_-]+)\//;

export function isValidHttpUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isGooglePhotoUrl(u) {
  return typeof u === 'string' && GOOGLE_HOST_RE.test(u) && GOOGLE_TOKEN_RE.test(u);
}

export function isYelpPhotoUrl(u) {
  return typeof u === 'string' && YELP_ANY_RE.test(u);
}

export function parseGooglePhotoId(u) {
  const m = String(u).match(GOOGLE_TOKEN_RE);
  return m ? m[1] : null;
}

export function parseYelpPhotoId(u) {
  const m = String(u).match(YELP_ID_RE);
  return m ? m[1] : null;
}

// Rewrite the size suffix (everything after the final '=' that follows the last '/').
export function toGoogleSize(u, size = 's0') {
  const eq = u.lastIndexOf('=');
  const slash = u.lastIndexOf('/');
  return eq > slash ? u.slice(0, eq + 1) + size : u + '=' + size;
}

export function toOriginalGoogle(u) {
  return toGoogleSize(u, 's0');
}

export function toOriginalYelp(u) {
  return u.replace(/(\/bphoto\/[A-Za-z0-9_-]+\/)[^/?#]+\.(?:jpe?g|png|webp)/i, '$1o.jpg');
}

// Scan rendered HTML for all Yelp bphoto ids (catches <img>, srcset, and embedded JSON).
export function findYelpPhotoUrls(html) {
  const re = /(?:https?:)?\/\/(s3-media\d\.fl\.yelpcdn\.com)\/bphoto\/([A-Za-z0-9_-]+)\//g;
  const byId = new Map();
  let m;
  while ((m = re.exec(html)) !== null) {
    const [, host, id] = m;
    if (!byId.has(id)) byId.set(id, `https://${host}/bphoto/${id}/o.jpg`);
  }
  return [...byId.entries()].map(([id, url]) => ({ id, url }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS (all url-tools tests green).

- [ ] **Step 5: Commit**

```bash
git add core/url-tools.js test/url-tools.test.js
git commit -m "feat: url-tools for original-resolution upgrades and id parsing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `core/naming.js` — sanitize + filename templating

**Files:**
- Create: `core/naming.js`
- Test: `test/naming.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/naming.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSegment, pad, buildFilename } from '../core/naming.js';

test('pad zero-pads', () => {
  assert.equal(pad(1), '001');
  assert.equal(pad(42, 4), '0042');
});

test('sanitizeSegment strips illegal filename chars', () => {
  assert.equal(sanitizeSegment('Joe\'s / Bar: "Best"?'), "Joe's _ Bar_ _Best_");
  assert.equal(sanitizeSegment('  trailing.. '), 'trailing');
  assert.equal(sanitizeSegment(''), 'photo');
});

test('buildFilename default template makes a subfolder + padded index', () => {
  assert.equal(
    buildFilename('{business}/{business}_{index}', { business: "Joe's Diner", index: 3, ext: 'jpg' }),
    "Joe's Diner/Joe's Diner_003.jpg"
  );
});

test('buildFilename with date token', () => {
  assert.equal(
    buildFilename('{business}/{date}/{business}_{index}', { business: 'Cafe', index: 10, date: '2026-06-29', ext: 'jpg' }),
    'Cafe/2026-06-29/Cafe_010.jpg'
  );
});

test('buildFilename blocks path traversal in business name', () => {
  const out = buildFilename('{business}/{business}_{index}', { business: '../../etc', index: 1, ext: 'jpg' });
  assert.ok(!out.includes('..'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `core/naming.js`**

```js
// Pure filename helpers. No chrome/DOM dependencies.
// Keeps spaces and '-' (valid in filenames); replaces OS-illegal chars with '_';
// strips trailing dots/spaces; neutralizes '..' so a token cannot escape the folder.

export function sanitizeSegment(s) {
  let v = String(s ?? '').trim();
  v = v.replace(/[.\s]+$/g, '');         // strip trailing dots/spaces
  v = v.replace(/[<>:"/\\|?*]/g, '_');    // OS-illegal chars -> _ (spaces and '-' kept)
  v = v.replace(/[\x00-\x1f]/g, '_');     // control chars -> _
  v = v.replace(/\.\.+/g, '_');           // neutralize '..' (path traversal)
  v = v.replace(/_+/g, '_');              // collapse repeated underscores
  v = v.replace(/\s+/g, ' ');             // collapse whitespace
  v = v.slice(0, 120);
  return v || 'photo';
}

export function pad(n, width = 3) {
  return String(n ?? 0).padStart(width, '0');
}

// Tokens: {business} {index} {date}. '/' in the template separates folders; the
// extension is always appended as '.<ext>'. Each segment is sanitized so a token
// value cannot inject extra folders or '..' traversal.
export function buildFilename(template, { business, index, date, ext } = {}) {
  const tokens = {
    business: sanitizeSegment(business ?? 'business'),
    index: pad(index ?? 0),
    date: sanitizeSegment(date ?? ''),
  };
  const replaced = template.replace(/\{(business|index|date)\}/g, (_, k) => tokens[k]);
  const clean = replaced.split('/').map(sanitizeSegment).filter(Boolean);
  const safeExt = (sanitizeSegment(ext ?? 'jpg').replace(/^_+/, '') || 'jpg').toLowerCase();
  return `${clean.join('/') || 'photo'}.${safeExt}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/naming.js test/naming.test.js
git commit -m "feat: filename templating with sanitization and traversal guards

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `core/concurrency.js` — bounded pool + retry/backoff

**Files:**
- Create: `core/concurrency.js`
- Test: `test/concurrency.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/concurrency.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPool, withRetry } from '../core/concurrency.js';

const tick = () => new Promise((r) => setTimeout(r, 1));

test('runPool respects the concurrency cap', async () => {
  let active = 0, maxActive = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  await runPool(items, async () => {
    active++; maxActive = Math.max(maxActive, active);
    await tick();
    active--;
  }, { concurrency: 4 });
  assert.ok(maxActive <= 4, `maxActive ${maxActive} should be <= 4`);
});

test('runPool collects succeeded and failed without aborting on error', async () => {
  const items = [1, 2, 3, 4];
  const { succeeded, failed, total } = await runPool(items, async (n) => {
    if (n % 2 === 0) throw new Error('even ' + n);
    return n * 10;
  }, { concurrency: 2 });
  assert.equal(total, 4);
  assert.equal(succeeded.length, 2);
  assert.equal(failed.length, 2);
  assert.deepEqual(succeeded.map((s) => s.value).sort((a, b) => a - b), [10, 30]);
});

test('runPool stops dispatching when the signal is aborted', async () => {
  const ac = new AbortController();
  let started = 0;
  const items = Array.from({ length: 50 }, (_, i) => i);
  const p = runPool(items, async () => { started++; await tick(); }, { concurrency: 2, signal: ac.signal });
  setTimeout(() => ac.abort(), 3);
  await p;
  assert.ok(started < 50, `started ${started} should be < 50 after abort`);
});

test('withRetry succeeds after transient failures', async () => {
  let calls = 0;
  const value = await withRetry(async () => {
    calls++;
    if (calls < 3) throw new Error('flaky');
    return 'ok';
  }, { retries: 5, baseMs: 0, maxMs: 0 });
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
});

test('withRetry gives up after the retry budget and respects isRetryable', async () => {
  let calls = 0;
  await assert.rejects(() => withRetry(async () => { calls++; throw new Error('boom'); },
    { retries: 2, baseMs: 0, maxMs: 0 }));
  assert.equal(calls, 3); // initial + 2 retries

  let calls2 = 0;
  await assert.rejects(() => withRetry(async () => { calls2++; throw new Error('fatal 404'); },
    { retries: 5, baseMs: 0, maxMs: 0, isRetryable: (e) => !/404/.test(e.message) }));
  assert.equal(calls2, 1); // not retried
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `core/concurrency.js`**

```js
// Pure async control-flow helpers. No chrome/DOM dependencies.

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
    }
  });
}

export async function runPool(items, taskFn, { concurrency = 6, signal } = {}) {
  const list = Array.from(items);
  const results = new Array(list.length);
  const succeeded = [];
  const failed = [];
  let next = 0;

  async function worker() {
    for (;;) {
      if (signal?.aborted) return;
      const i = next++;
      if (i >= list.length) return;
      try {
        const value = await taskFn(list[i], i, signal);
        results[i] = { ok: true, value };
        succeeded.push({ index: i, item: list[i], value });
      } catch (err) {
        const reason = String(err?.message || err);
        results[i] = { ok: false, error: err };
        failed.push({ index: i, item: list[i], reason });
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, list.length || 1));
  await Promise.all(Array.from({ length: n }, worker));
  return { results, succeeded, failed, total: list.length };
}

export async function withRetry(fn, {
  retries = 3, baseMs = 500, maxMs = 8000, signal,
  rand = Math.random, isRetryable = () => true,
} = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (attempt >= retries || !isRetryable(err)) throw err;
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
      const jitter = backoff * 0.5 * rand();
      if (backoff + jitter > 0) await sleep(backoff + jitter, signal);
      attempt++;
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/concurrency.js test/concurrency.test.js
git commit -m "feat: bounded concurrency pool and retry/backoff

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `core/scroll-state.js` — auto-scroll stop-condition monitor

**Files:**
- Create: `core/scroll-state.js`
- Test: `test/scroll-state.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/scroll-state.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScrollMonitor } from '../core/scroll-state.js';

test('does not stop while content keeps growing', () => {
  const m = createScrollMonitor({ stallLimit: 3, maxIterations: 100 });
  for (let i = 1; i <= 10; i++) {
    const r = m.observe({ scrollHeight: i * 1000, count: i * 12, atBottom: false });
    assert.equal(r.stop, false);
  }
});

test('stops after stallLimit when at bottom and nothing new loads', () => {
  const m = createScrollMonitor({ stallLimit: 3, maxIterations: 100 });
  m.observe({ scrollHeight: 5000, count: 60, atBottom: true });
  assert.equal(m.observe({ scrollHeight: 5000, count: 60, atBottom: true }).stop, false);
  assert.equal(m.observe({ scrollHeight: 5000, count: 60, atBottom: true }).stop, false);
  const r = m.observe({ scrollHeight: 5000, count: 60, atBottom: true });
  assert.equal(r.stop, true);
  assert.equal(r.reason, 'stable');
});

test('hard cap stops the loop regardless', () => {
  const m = createScrollMonitor({ stallLimit: 100, maxIterations: 5 });
  let last;
  for (let i = 0; i < 5; i++) last = m.observe({ scrollHeight: i * 10, count: i, atBottom: false });
  assert.equal(last.stop, true);
  assert.equal(last.reason, 'max-iterations');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `core/scroll-state.js`**

```js
// Pure stop-condition state machine for auto-scrolling a lazy/virtualized gallery.

export function createScrollMonitor({ stallLimit = 3, maxIterations = 500 } = {}) {
  let lastHeight = -1;
  let lastCount = -1;
  let stall = 0;
  let iterations = 0;

  return {
    observe({ scrollHeight = 0, count = 0, atBottom = false }) {
      iterations++;
      const grew = scrollHeight > lastHeight || count > lastCount;
      stall = grew ? 0 : stall + 1;
      lastHeight = Math.max(lastHeight, scrollHeight);
      lastCount = Math.max(lastCount, count);

      if (iterations >= maxIterations) return { stop: true, reason: 'max-iterations' };
      if (stall >= stallLimit && atBottom) return { stop: true, reason: 'stable' };
      if (stall >= stallLimit + 2) return { stop: true, reason: 'stable-no-bottom' };
      return { stop: false, reason: null };
    },
    get iterations() { return iterations; },
    get count() { return lastCount; },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/scroll-state.js test/scroll-state.test.js
git commit -m "feat: auto-scroll stop-condition monitor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Vendor `client-zip` and `core/zip.js`

**Files:**
- Create: `vendor/client-zip.js`, `core/zip.js`
- Test: `test/zip.test.js`

- [ ] **Step 1: Download the bundled ESM build of client-zip**

Run (PowerShell, from project root):
```powershell
New-Item -ItemType Directory -Force vendor | Out-Null
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/client-zip@2.5.0/index.js" -OutFile "vendor/client-zip.js"
```
Expected: `vendor/client-zip.js` exists and contains `export` statements (it is an ESM module). If 2.5.0 is unavailable, drop the version to fetch the latest: `https://cdn.jsdelivr.net/npm/client-zip/index.js`, and note the resolved version in the commit message.

- [ ] **Step 2: Write the failing test**

```js
// test/zip.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZipBlob } from '../core/zip.js';

test('buildZipBlob produces a valid zip (PK signature) from entries', async () => {
  const blob = await buildZipBlob([
    { name: 'a.txt', input: 'hello' },
    { name: 'b.txt', input: new TextEncoder().encode('world') },
  ]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // ZIP local file header magic: 0x50 0x4B 0x03 0x04 ("PK..")
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.ok(bytes.length > 0);
});
```

- [ ] **Step 3: Implement `core/zip.js`**

```js
import { downloadZip } from '../vendor/client-zip.js';

// entries: iterable/async-iterable of { name, input, lastModified? }
// input may be string | Uint8Array | ArrayBuffer | Blob | Response.
export async function buildZipBlob(entries) {
  const response = downloadZip(entries);
  return await response.blob();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS. (client-zip is ESM and uses web `Response`/streams available in Node 18+.) If Node errors on the import, confirm Node ≥ 18 with `node --version`.

- [ ] **Step 5: Commit**

```bash
git add vendor/client-zip.js core/zip.js test/zip.test.js
git commit -m "feat: bundle client-zip and add zip-blob builder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 3 — Chrome wrappers & DOM helpers (verified live)

### Task 8: `core/download.js` — chrome.downloads + blob download

**Files:**
- Create: `core/download.js`

> Not unit-tested (depends on `chrome.*`); verified during Task 16 integration.

- [ ] **Step 1: Implement `core/download.js`**

```js
// chrome.downloads wrappers. Runs in an extension page (side panel) or service worker.

export function downloadUrl(url, filename) {
  return chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
}

// Download an in-memory Blob (e.g. a generated ZIP). MUST run in an extension PAGE
// context (side panel), because URL.createObjectURL does not exist in the SW.
export async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const id = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: true });
  // Revoke only after the download has actually started, or the file may be empty.
  const onChanged = (delta) => {
    if (delta.id === id && delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
      URL.revokeObjectURL(url);
      chrome.downloads.onChanged.removeListener(onChanged);
    }
  };
  chrome.downloads.onChanged.addListener(onChanged);
  return id;
}
```

- [ ] **Step 2: Commit**

```bash
git add core/download.js
git commit -m "feat: chrome.downloads wrappers for url and blob downloads

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: `core/dom.js` — DOM helpers

**Files:**
- Create: `core/dom.js`

> Not unit-tested (depends on `document`); verified live in Tasks 13–15.

- [ ] **Step 1: Implement `core/dom.js`**

```js
// DOM helpers used by content-script adapters. Runs in the page context.

export function waitFor(predicate, timeoutMs = 10000, intervalMs = 200) {
  return new Promise((resolve, reject) => {
    const found = safe(predicate);
    if (found) return resolve(found);
    const start = Date.now();
    const timer = setInterval(() => {
      const r = safe(predicate);
      if (r) { clearInterval(timer); resolve(r); }
      else if (Date.now() - start > timeoutMs) { clearInterval(timer); reject(new Error('waitFor timeout')); }
    }, intervalMs);
  });
  function safe(fn) { try { return fn(); } catch { return null; } }
}

// Climb from an element to the nearest scrollable ancestor.
export function findScrollable(el) {
  let node = el;
  while (node && node !== document.body) {
    try {
      const style = getComputedStyle(node);
      const oy = style.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 4) return node;
    } catch { /* ignore */ }
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

export function firstMatch(strategies, root = document) {
  for (const s of strategies) {
    try {
      const el = typeof s === 'function' ? s(root) : root.querySelector(s);
      if (el) return el;
    } catch { /* bad selector, continue */ }
  }
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add core/dom.js
git commit -m "feat: dom helpers (waitFor, findScrollable, firstMatch)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 4 — Adapters

### Task 10: `adapters/generic.js` + `adapters/registry.js`

**Files:**
- Create: `adapters/generic.js`, `adapters/registry.js`
- Test: `test/registry.test.js`

> The registry's `pickAdapter` is testable with stubbed `match()`. We test selection logic without importing DOM-touching adapters by injecting the adapter list.

- [ ] **Step 1: Write the failing test**

```js
// test/registry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choose } from '../adapters/registry.js';

test('choose returns the first matching adapter, else the fallback', () => {
  const g = { name: 'g', match: (u) => /google/.test(u) };
  const y = { name: 'y', match: (u) => /yelp/.test(u) };
  const fallback = { name: 'generic', match: () => true };
  assert.equal(choose('https://www.google.com/maps/x', null, [g, y], fallback).name, 'g');
  assert.equal(choose('https://www.yelp.com/biz/x', null, [g, y], fallback).name, 'y');
  assert.equal(choose('https://example.com', null, [g, y], fallback).name, 'generic');
});

test('choose survives an adapter whose match throws', () => {
  const bad = { name: 'bad', match: () => { throw new Error('x'); } };
  const fallback = { name: 'generic', match: () => true };
  assert.equal(choose('https://x.com', null, [bad], fallback).name, 'generic');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `adapters/generic.js`**

```js
import { isValidHttpUrl } from '../core/url-tools.js';

// Universal best-effort fallback: collect the largest cluster of <img> on the page.
export const genericAdapter = {
  name: 'generic',
  match() { return true; },
  async waitReady() { /* no-op */ },
  getScrollContainer() { return document.scrollingElement || document.documentElement; },
  collect() {
    const map = new Map();
    for (const img of document.querySelectorAll('img')) {
      const url = bestFromImg(img);
      if (url && isValidHttpUrl(url) && !map.has(url)) {
        map.set(url, { url, category: undefined });
      }
    }
    return map;
  },
  extractItems() {
    const out = [];
    for (const [url, c] of this.collect()) {
      out.push({ id: url, thumbUrl: url, originalUrl: url, category: c.category, site: 'generic' });
    }
    return out;
  },
  getOriginalUrl(u) { return u; },
  getSizedUrl(u) { return u; },
  healthCheck() { const n = this.collect().size; return { ok: n > 0, reachedTier: n ? 'imgs' : 'none', count: n }; },
};

function bestFromImg(img) {
  // Prefer the largest srcset candidate, else currentSrc/src.
  const srcset = img.getAttribute('srcset');
  if (srcset) {
    const best = srcset.split(',')
      .map((s) => s.trim().split(/\s+/))
      .map(([u, d]) => ({ u, w: parseFloat(d) || 0 }))
      .sort((a, b) => b.w - a.w)[0];
    if (best?.u) return best.u;
  }
  return img.currentSrc || img.src || null;
}
```

- [ ] **Step 4: Implement `adapters/registry.js`**

```js
import { genericAdapter } from './generic.js';
import { googleMapsAdapter } from './google-maps.js';
import { yelpAdapter } from './yelp.js';

// Testable pure selector: inject the list + fallback.
export function choose(url, doc, adapters, fallback) {
  for (const a of adapters) {
    try { if (a.match(url, doc)) return a; } catch { /* ignore */ }
  }
  return fallback;
}

const ADAPTERS = [googleMapsAdapter, yelpAdapter];

export function pickAdapter(url = location.href, doc = document) {
  return choose(url, doc, ADAPTERS, genericAdapter);
}

export { ADAPTERS, genericAdapter };
```

> `registry.js` imports the real adapters; the test imports only `choose`, which does not require them at call time. The static imports load module objects whose `match()` uses only the URL string — no `document` access at import time — so `node --test` can import `registry.js` cleanly. (Tasks 11–12 create those adapter modules; if running Task 10's test before them, temporarily stub the two imports or implement Tasks 11–12 first. Recommended: implement 11 and 12 immediately after 10.)

- [ ] **Step 5: Run to verify it passes**

Run: `npm test`
Expected: PASS (after Tasks 11–12 exist, or with temporary stubs).

- [ ] **Step 6: Commit**

```bash
git add adapters/generic.js adapters/registry.js test/registry.test.js
git commit -m "feat: adapter registry and generic fallback adapter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: `adapters/google-maps.js`

**Files:**
- Create: `adapters/google-maps.js`

> DOM-dependent; verified live in Task 13. Selectors anchor on the stable `googleusercontent` substring and `role`/`jsaction` attributes, never hashed class names.

- [ ] **Step 1: Implement `adapters/google-maps.js`**

```js
import { parseGooglePhotoId, toGoogleSize, toOriginalGoogle, isGooglePhotoUrl } from '../core/url-tools.js';

const BG_URL_RE = /url\(["']?(https:[^"')]+googleusercontent[^"')]+)["']?\)/i;

export const googleMapsAdapter = {
  name: 'google-maps',
  site: 'google-maps',

  match(url) {
    return /^https:\/\/www\.google\.[^/]+\/maps\//i.test(url);
  },

  async waitReady(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.collect().size > 0) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  },

  getScrollContainer() {
    const tile = document.querySelector(
      '[data-photo-index], a[href*="/photos/"], button[jsaction*="pane"]'
    );
    let node = tile;
    while (node && node !== document.body) {
      try {
        const oy = getComputedStyle(node).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 4) return node;
      } catch { /* ignore */ }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  },

  // Harvest every googleusercontent url currently in the DOM, keyed by immutable photo id.
  collect() {
    const map = new Map();
    // (1) real <img> tags
    for (const img of document.querySelectorAll('img[src*="googleusercontent"]')) {
      addCandidate(map, img.currentSrc || img.src);
    }
    // (2) background-image tiles (the photo gallery uses these)
    const bgEls = document.querySelectorAll(
      '[style*="googleusercontent"], [role="img"], button[jsaction*="pane"] div, a[data-photo-index] div'
    );
    for (const el of bgEls) {
      const inline = (el.getAttribute && el.getAttribute('style')) || '';
      let m = inline.match(BG_URL_RE);
      if (!m) {
        try { m = getComputedStyle(el).backgroundImage.match(BG_URL_RE); } catch { m = null; }
      }
      if (m) addCandidate(map, m[1]);
    }
    return map;
  },

  extractItems() {
    const out = [];
    for (const [id, c] of this.collect()) {
      out.push({
        id,
        thumbUrl: c.url,
        originalUrl: toOriginalGoogle(c.url),
        category: c.category,
        site: 'google-maps',
      });
    }
    return out;
  },

  getOriginalUrl(thumbUrl) { return toOriginalGoogle(thumbUrl); },
  getSizedUrl(thumbUrl, size) {
    return !size || size === 'original' ? toOriginalGoogle(thumbUrl) : toGoogleSize(thumbUrl, 'w' + size);
  },

  healthCheck() {
    const count = this.collect().size;
    return { ok: count > 0, reachedTier: count > 0 ? 'primary' : 'none', count };
  },
};

function addCandidate(map, url, category) {
  if (!url || !isGooglePhotoUrl(url)) return;
  const id = parseGooglePhotoId(url);
  if (id && !map.has(id)) map.set(id, { url, category });
}
```

- [ ] **Step 2: Commit**

```bash
git add adapters/google-maps.js
git commit -m "feat: Google Maps adapter (background-image + img harvest, s0 upgrade)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: `adapters/yelp.js`

**Files:**
- Create: `adapters/yelp.js`

> Uses the resilient regex-over-HTML extraction (catches img/srcset/JSON). Verified live in Task 14.

- [ ] **Step 1: Implement `adapters/yelp.js`**

```js
import { findYelpPhotoUrls, parseYelpPhotoId } from '../core/url-tools.js';

export const yelpAdapter = {
  name: 'yelp',
  site: 'yelp',

  match(url) {
    return /^https:\/\/www\.yelp\.com\/(biz|biz_photos)\//i.test(url);
  },

  async waitReady(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.collect().size > 0) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  },

  getScrollContainer() {
    return document.scrollingElement || document.documentElement;
  },

  collect() {
    const map = new Map();
    for (const { id, url } of findYelpPhotoUrls(document.documentElement.outerHTML)) {
      if (!map.has(id)) map.set(id, { url, category: currentTab() });
    }
    return map;
  },

  extractItems() {
    const out = [];
    for (const [id, c] of this.collect()) {
      // thumb for grid: reuse original (Yelp originals are ~1000px, light enough to show)
      out.push({ id, thumbUrl: c.url, originalUrl: c.url, category: c.category, site: 'yelp' });
    }
    return out;
  },

  getOriginalUrl(u) { const id = parseYelpPhotoId(u); return id ? u : u; },
  getSizedUrl(u) { return u; }, // Yelp has no larger size than o.jpg

  healthCheck() {
    const count = this.collect().size;
    return { ok: count > 0, reachedTier: count > 0 ? 'regex' : 'none', count };
  },
};

function currentTab() {
  const u = new URL(location.href);
  return u.searchParams.get('tab') || undefined;
}
```

- [ ] **Step 2: Commit**

```bash
git add adapters/yelp.js
git commit -m "feat: Yelp adapter (regex-over-HTML extraction, o.jpg originals)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 5 — Content script + auto-scroll engine

### Task 13: `content/content.js` loader + `content/main.js` (Google verified live)

**Files:**
- Create: `content/content.js`, `content/main.js`

- [ ] **Step 1: Implement `content/content.js` (classic loader)**

```js
// Classic content script: dynamically import the ES-module entry so the adapters
// and core modules can use `import`. The module files are web_accessible_resources.
(async () => {
  if (window.__BPE_LOADED__) return;
  window.__BPE_LOADED__ = true;
  try {
    const mod = await import(chrome.runtime.getURL('content/main.js'));
    mod.init();
  } catch (e) {
    console.error('[BPE] failed to load main.js', e);
  }
})();
```

- [ ] **Step 2: Implement `content/main.js`**

```js
import { pickAdapter } from '../adapters/registry.js';
import { createScrollMonitor } from '../core/scroll-state.js';

let adapter = null;
let stopFlag = false;

export function init() {
  adapter = pickAdapter(location.href, document);
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handle(msg, sendResponse);
    return true; // keep the channel open for async sendResponse
  });
}

async function handle(msg, sendResponse) {
  try {
    if (msg?.type === 'PING') {
      adapter = pickAdapter(location.href, document);
      return sendResponse({ ok: true, site: adapter.site || adapter.name });
    }
    if (msg?.type === 'STOP') {
      stopFlag = true;
      return sendResponse({ ok: true });
    }
    if (msg?.type === 'LOAD_ALL') {
      stopFlag = false;
      await loadAll();
      return sendResponse({ ok: true });
    }
    if (msg?.type === 'GET_ITEMS') {
      const items = adapter.extractItems();
      const health = adapter.healthCheck();
      return sendResponse({ site: adapter.site || adapter.name, items, health });
    }
    sendResponse({ ok: false, error: 'unknown message' });
  } catch (e) {
    sendResponse({ ok: false, error: String(e?.message || e) });
  }
}

async function loadAll() {
  try { await adapter.waitReady(10000); } catch { /* continue with whatever is present */ }
  const container = adapter.getScrollContainer();
  const monitor = createScrollMonitor({ stallLimit: 4, maxIterations: 600 });
  const settle = 600;

  for (;;) {
    if (stopFlag) break;
    // Force lazy <img> to load if any expose data-src.
    forceLazy();
    const count = adapter.collect().size;
    const scrollHeight = container.scrollHeight || document.body.scrollHeight;
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 8;

    chrome.runtime.sendMessage({ type: 'PROGRESS', loaded: count }).catch(() => {});

    const { stop } = monitor.observe({ scrollHeight, count, atBottom });
    if (stop) break;

    container.scrollBy ? container.scrollBy(0, container.clientHeight * 0.9)
                       : window.scrollBy(0, window.innerHeight * 0.9);
    await new Promise((r) => setTimeout(r, settle));
  }
  chrome.runtime.sendMessage({ type: 'PROGRESS', loaded: adapter.collect().size, done: true }).catch(() => {});
}

function forceLazy() {
  for (const img of document.querySelectorAll('img[data-src]')) {
    try { if (!img.src) img.src = img.dataset.src; } catch { /* ignore */ }
  }
}
```

- [ ] **Step 3: Reload the extension and verify on Google Maps (live)**

1. Reload the extension at `chrome://extensions`.
2. Open a Google Maps business with a Photos section, click the Photos thumbnail to open the gallery.
3. Open the page DevTools console (F12). Run:
   ```js
   chrome.runtime.sendMessage // (confirms content script context)
   ```
   Then, in the **extension service worker console** (chrome://extensions → "service worker") or via the side panel later, you will trigger LOAD_ALL. For now, in the page console, manually test the adapter:
   ```js
   const m = await import(chrome.runtime.getURL('adapters/registry.js'));
   const a = m.pickAdapter(location.href, document);
   console.log(a.name, a.healthCheck());
   console.log(a.extractItems().slice(0, 3));
   ```
   Expected: `a.name === 'google-maps'`, `healthCheck().count > 0`, and items whose `originalUrl` ends in `=s0`.
4. **If `count === 0`:** the gallery DOM differs from the researched structure. In DevTools, inspect a photo tile, find the element carrying the `googleusercontent` URL (check inline `style` and computed `background-image`), and add its selector to `bgEls` in `adapters/google-maps.js`. Re-test. This is the expected tuning point.

- [ ] **Step 4: Commit**

```bash
git add content/content.js content/main.js
git commit -m "feat: content-script loader and auto-scroll engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Verify Yelp extraction (live)

**Files:** none (verification + any selector tuning to `adapters/yelp.js`)

- [ ] **Step 1: Verify on a Yelp business (live)**

1. Open `https://www.yelp.com/biz_photos/<some-business-slug>`.
2. In the page DevTools console:
   ```js
   const m = await import(chrome.runtime.getURL('adapters/registry.js'));
   const a = m.pickAdapter(location.href, document);
   console.log(a.name, a.healthCheck());
   console.log(a.extractItems().slice(0, 3));
   ```
   Expected: `a.name === 'yelp'`, `count > 0`, items whose `originalUrl` ends in `/o.jpg`.
3. Trigger lazy loading by scrolling the page, re-run `a.healthCheck()`, and confirm the count grows.

- [ ] **Step 2: Commit (only if you tuned the adapter)**

```bash
git add adapters/yelp.js
git commit -m "fix: tune Yelp adapter selectors for live DOM

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 6 — Service worker relay

### Task 15: Fallback image-fetch relay in the service worker

**Files:**
- Modify: `background/service-worker.js`

- [ ] **Step 1: Replace `background/service-worker.js` with:**

```js
// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e) => console.warn(e));
});

// Fallback image fetch: used only when a side-panel page-context fetch fails.
// Returns base64 because chrome messaging cannot transfer ArrayBuffer.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'FETCH_IMAGE') {
    (async () => {
      try {
        const resp = await fetch(msg.url, { credentials: 'omit' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        sendResponse({ ok: true, base64: toBase64(buf), mime: resp.headers.get('content-type') || 'image/jpeg' });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true; // async
  }
});

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
```

- [ ] **Step 2: Reload the extension; verify no SW errors**

Reload at `chrome://extensions`; open the service worker console; expect no errors on load.

- [ ] **Step 3: Commit**

```bash
git add background/service-worker.js
git commit -m "feat: service-worker fallback image-fetch relay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 7 — Side Panel UI

### Task 16: Side panel — connect, load-all, render grid

**Files:**
- Modify: `sidepanel/sidepanel.html`, `sidepanel/sidepanel.css`, `sidepanel/sidepanel.js`

- [ ] **Step 1: Replace `sidepanel/sidepanel.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="sidepanel.css" />
</head>
<body>
  <header>
    <h1>Photo Extractor</h1>
    <div id="status">Checking page…</div>
    <div id="toolbar" hidden>
      <button id="loadBtn" class="primary">Load all photos</button>
      <button id="stopBtn" hidden>Stop</button>
    </div>
  </header>
  <main id="app">
    <section id="controls" hidden>
      <div class="row">
        <button id="selAll">Select all</button>
        <button id="selNone">Select none</button>
        <span id="selCount" class="muted">0 selected</span>
      </div>
      <div class="row" id="filters"></div>
      <div class="row">
        <label>Resolution
          <select id="resolution">
            <option value="original">Original (max)</option>
            <option value="2048">≤ 2048 px (Google)</option>
            <option value="1024">≤ 1024 px (Google)</option>
          </select>
        </label>
      </div>
      <div class="row">
        <label>Name <input id="nameTpl" type="text" value="{business}/{business}_{index}" /></label>
      </div>
      <div class="row">
        <label><input type="radio" name="mode" value="files" checked /> Individual files</label>
        <label><input type="radio" name="mode" value="zip" /> One ZIP</label>
      </div>
      <div class="row">
        <button id="downloadBtn" class="primary" disabled>Download selected</button>
      </div>
      <div id="progress" class="muted"></div>
      <div id="report"></div>
    </section>
    <section id="grid"></section>
  </main>
  <script type="module" src="sidepanel.js"></script>
</body>
</html>
```

- [ ] **Step 2: Append to `sidepanel/sidepanel.css`**

```css
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
.muted { color: #777; font-size: 12px; }
#grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
.cell { position: relative; aspect-ratio: 1; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; cursor: pointer; }
.cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cell input { position: absolute; top: 4px; left: 4px; width: 16px; height: 16px; }
.cell.selected { outline: 3px solid #1a73e8; outline-offset: -3px; }
.chip { padding: 3px 8px; border: 1px solid #ccc; border-radius: 999px; background: #fff; cursor: pointer; font-size: 12px; }
.chip.active { background: #1a73e8; color: #fff; border-color: #1a73e8; }
input[type=text], select { font: inherit; padding: 4px 6px; border: 1px solid #ccc; border-radius: 6px; }
.fail { color: #b00020; font-size: 12px; white-space: pre-wrap; }
```

- [ ] **Step 3: Replace `sidepanel/sidepanel.js`**

```js
import { runPool, withRetry } from '../core/concurrency.js';
import { buildZipBlob } from '../core/zip.js';
import { downloadUrl, downloadBlob } from '../core/download.js';
import { buildFilename } from '../core/naming.js';
import { toGoogleSize } from '../core/url-tools.js';

const el = (id) => document.getElementById(id);
const state = {
  tabId: null, site: null, items: [], selected: new Set(),
  activeCategory: null, abort: null, businessName: 'business',
};

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id ?? null;
  state.businessName = guessBusinessName(tab?.title);
  const ping = await send({ type: 'PING' }).catch(() => null);
  if (!ping?.ok) {
    el('status').textContent = 'Open a Google Maps or Yelp business page, then reopen this panel.';
    return;
  }
  state.site = ping.site;
  el('status').textContent = `Detected: ${ping.site}. Click "Load all photos".`;
  el('toolbar').hidden = false;
  wireToolbar();
}

function wireToolbar() {
  el('loadBtn').addEventListener('click', onLoadAll);
  el('stopBtn').addEventListener('click', () => send({ type: 'STOP' }).catch(() => {}));
  el('selAll').addEventListener('click', () => { state.items.forEach((p) => state.selected.add(p.id)); renderGrid(); });
  el('selNone').addEventListener('click', () => { state.selected.clear(); renderGrid(); });
  el('downloadBtn').addEventListener('click', onDownload);
}

async function onLoadAll() {
  el('loadBtn').disabled = true; el('stopBtn').hidden = false;
  el('progress').textContent = 'Loading photos…';
  const onMsg = (msg) => {
    if (msg?.type === 'PROGRESS') el('progress').textContent = `Loaded ${msg.loaded} photos${msg.done ? ' (done)' : '…'}`;
  };
  chrome.runtime.onMessage.addListener(onMsg);
  await send({ type: 'LOAD_ALL' }).catch(() => {});
  chrome.runtime.onMessage.removeListener(onMsg);
  el('stopBtn').hidden = true; el('loadBtn').disabled = false;

  const res = await send({ type: 'GET_ITEMS' }).catch(() => null);
  if (!res) { el('progress').textContent = 'Could not read photos.'; return; }
  state.items = res.items || [];
  if (!state.items.length) {
    el('progress').textContent = `No photos found. The ${res.health?.reachedTier === 'none' ? state.site + ' adapter may be stale' : 'gallery may be empty'}.`;
    return;
  }
  el('progress').textContent = `Found ${state.items.length} photos.`;
  el('controls').hidden = false;
  state.items.forEach((p) => state.selected.add(p.id));
  renderFilters(); renderGrid();
}

function renderFilters() {
  const cats = [...new Set(state.items.map((p) => p.category).filter(Boolean))];
  const box = el('filters'); box.innerHTML = '';
  if (!cats.length) return;
  const mk = (label, value) => {
    const b = document.createElement('button');
    b.className = 'chip' + (state.activeCategory === value ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => { state.activeCategory = value; renderFilters(); renderGrid(); });
    return b;
  };
  box.appendChild(mk('All', null));
  cats.forEach((c) => box.appendChild(mk(c, c)));
}

function visibleItems() {
  return state.activeCategory ? state.items.filter((p) => p.category === state.activeCategory) : state.items;
}

function renderGrid() {
  const grid = el('grid'); grid.innerHTML = '';
  for (const p of visibleItems()) {
    const cell = document.createElement('div');
    cell.className = 'cell' + (state.selected.has(p.id) ? ' selected' : '');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = state.selected.has(p.id);
    const img = document.createElement('img'); img.loading = 'lazy'; img.src = p.thumbUrl; img.referrerPolicy = 'no-referrer';
    cell.appendChild(img); cell.appendChild(cb);
    const toggle = () => { state.selected.has(p.id) ? state.selected.delete(p.id) : state.selected.add(p.id); renderGrid(); };
    cell.addEventListener('click', (e) => { if (e.target !== cb) toggle(); });
    cb.addEventListener('change', toggle);
    grid.appendChild(cell);
  }
  el('selCount').textContent = `${state.selected.size} selected`;
  el('downloadBtn').disabled = state.selected.size === 0;
}

function resolveUrl(item, resolution) {
  if (item.site === 'google-maps' && resolution && resolution !== 'original') {
    return toGoogleSize(item.thumbUrl, 'w' + resolution);
  }
  return item.originalUrl;
}

async function fetchBlob(url, signal) {
  try {
    const r = await fetch(url, { signal, credentials: 'omit' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.blob();
  } catch (e) {
    // Fallback: ask the service worker to fetch (CORS-exempt) and return base64.
    const relay = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url }).catch(() => null);
    if (relay?.ok) return base64ToBlob(relay.base64, relay.mime);
    throw e;
  }
}

async function onDownload() {
  const chosen = state.items.filter((p) => state.selected.has(p.id));
  const resolution = el('resolution').value;
  const mode = document.querySelector('input[name=mode]:checked').value;
  const tpl = el('nameTpl').value || '{business}/{business}_{index}';
  state.abort = new AbortController();
  el('downloadBtn').disabled = true; el('report').innerHTML = '';
  let done = 0;

  if (mode === 'files') {
    const out = await runPool(chosen, async (item, i, signal) => {
      const url = resolveUrl(item, resolution);
      const filename = buildFilename(tpl, { business: state.businessName, index: i + 1, ext: extOf(url) });
      // For direct same-host downloads, chrome.downloads can fetch the URL itself.
      await downloadUrl(url, filename);
      el('progress').textContent = `Downloaded ${++done}/${chosen.length}`;
    }, { concurrency: 5, signal: state.abort.signal });
    showReport(out);
  } else {
    // ZIP: fetch blobs (with retry), stream into client-zip, then download once.
    const entries = [];
    const out = await runPool(chosen, async (item, i, signal) => {
      const url = resolveUrl(item, resolution);
      const blob = await withRetry(() => fetchBlob(url, signal), {
        retries: 3, baseMs: 400, maxMs: 6000, signal,
        isRetryable: (e) => !/HTTP 4\d\d/.test(String(e.message)),
      });
      const name = buildFilename(tpl, { business: state.businessName, index: i + 1, ext: extOf(url) });
      entries.push({ name, input: blob });
      el('progress').textContent = `Fetched ${++done}/${chosen.length}`;
    }, { concurrency: 6, signal: state.abort.signal });

    if (entries.length) {
      el('progress').textContent = `Zipping ${entries.length} photos…`;
      const zip = await buildZipBlob(entries);
      await downloadBlob(zip, `${sanitizeZipName(state.businessName)}.zip`);
      el('progress').textContent = `ZIP ready (${entries.length} photos).`;
    }
    showReport(out);
  }
  el('downloadBtn').disabled = false;
}

function showReport(out) {
  const box = el('report');
  box.innerHTML = `<div>Done: ${out.succeeded.length} ok, ${out.failed.length} failed of ${out.total}.</div>`;
  if (out.failed.length) {
    const urls = out.failed.map((f) => `${f.reason}`).join('\n');
    const pre = document.createElement('div'); pre.className = 'fail'; pre.textContent = urls;
    box.appendChild(pre);
  }
}

// --- helpers ---
function send(msg) { return chrome.tabs.sendMessage(state.tabId, msg); }
function extOf(url) { const m = url.split('?')[0].match(/\.(jpe?g|png|webp)$/i); return m ? m[1].toLowerCase() : 'jpg'; }
function guessBusinessName(title) {
  if (!title) return 'business';
  return title.replace(/ - Google Maps.*$/i, '').replace(/\| Yelp.*$/i, '').trim() || 'business';
}
function sanitizeZipName(s) { return String(s).replace(/[<>:"/\\|?*-]/g, '_').slice(0, 120) || 'photos'; }
function base64ToBlob(b64, mime) {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'image/jpeg' });
}
```

- [ ] **Step 4: Verify the full flow on Google Maps (live)**

1. Reload the extension.
2. Open a Google Maps business → open its Photos gallery → click the toolbar icon.
3. Side panel shows "Detected: google-maps". Click **Load all photos**; the progress counter climbs and stops; the grid fills with thumbnails.
4. Click **Select none**, select ~3 photos, keep **Individual files**, click **Download selected**. Expected: 3 files appear in `Downloads/<business>/…` and (open one) are full-resolution (much larger than the on-page thumbnail; check image dimensions).
5. Switch to **One ZIP**, select all, **Download selected**. Expected: a single `<business>.zip` downloads containing all selected originals; open it to confirm integrity.

- [ ] **Step 5: Verify on Yelp (live)**

Repeat Step 4 on a Yelp `/biz_photos/<slug>` page. Expected: detected `yelp`, photos load, downloads are `/o.jpg` originals (~1000px). The resolution dropdown has no effect on Yelp (expected — it's at the CDN max).

- [ ] **Step 6: Commit**

```bash
git add sidepanel/sidepanel.html sidepanel/sidepanel.css sidepanel/sidepanel.js
git commit -m "feat: side panel UI — grid, selection, filters, naming, downloads, zip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase 8 — Integration hardening & verification

### Task 17: End-to-end verification checklist + failure-path proof

**Files:** none (verification; small fixes committed as found)

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Large-gallery load-all**

On a business with 100+ photos, confirm Load-all reaches a natural stop (not the `max-iterations` cap) and the final count is plausibly the full set. If it stops at the cap, raise `maxIterations` in `content/main.js` `loadAll()` and note it.

- [ ] **Step 3: Stop mid-load**

Start Load-all on a large gallery, click **Stop**. Expected: loading halts promptly; already-found photos render and are downloadable.

- [ ] **Step 4: Partial-failure proof**

Temporarily edit `resolveUrl` to corrupt one URL (e.g. append `x` to the host of the first item), select several, download as ZIP. Expected: the batch completes, the ZIP contains the good photos, and the report shows 1 failed with a reason. Revert the edit afterward.

- [ ] **Step 5: Stale-adapter canary**

In DevTools on a supported page, temporarily break the Google selector (rename `googleusercontent` to a typo in a local copy) and confirm the side panel reports "adapter may be stale" rather than a silent empty grid. Revert.

- [ ] **Step 6: Non-supported page**

Open a non-business page (e.g. `https://example.com`), click the icon. Expected: side panel shows the "Open a Google Maps or Yelp business" message; no errors.

- [ ] **Step 7: Final commit + tag**

```bash
git add -A
git commit -m "chore: integration verification fixes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git tag v0.1.0
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Google original-resolution (`=s0`/`w16383`) → Tasks 3, 11. Yelp `o.jpg` → Tasks 3, 12.
- Side Panel UI → Tasks 1, 16. Select/bulk → 16. Full-res + ZIP → 7, 16. Auto-scroll/load-all → 6, 13. Filter + naming → 4, 16.
- MV3 permissions/manifest → Task 1. SW lifecycle/relay → 15. ZIP via client-zip/STORE → 7. createObjectURL-in-page (no offscreen) → 8, 16.
- Adapter registry + generic fallback → 10. Resilient selection / waitFor / scroll stop conditions → 6, 9, 11, 12. Per-image retry/skip-and-record → 5, 16. Canary/stale-adapter → 16 (Step 5), surfaced in 16 Step `onLoadAll`. Idempotency (dedup by id) → 11, 12 (`collect()` Maps keyed by id).
- Error/UX states (not supported / empty / partial failure / stop) → 16, 17.
- Caveats (Yelp ~1000px; ToS; drift) → reflected in UI copy + verification.
- Testing strategy → Tasks 3–7 (unit), 13–17 (manual/integration).

**Placeholder scan:** No TBD/TODO. `core/naming.js` Task 4 includes both a first draft and the explicit "clean form" to use — implementers should use the clean form (the test enforces it).

**Type consistency:** `Photo` shape `{id, thumbUrl, originalUrl, category, site}` is consistent across adapters (11, 12, 10) and consumed identically in `sidepanel.js` (16). Message types (`PING/LOAD_ALL/GET_ITEMS/STOP/PROGRESS/FETCH_IMAGE`) match between `content/main.js` (13), `service-worker.js` (15), and `sidepanel.js` (16). `runPool` returns `{results, succeeded, failed, total}` (5) and is consumed as such in `showReport` (16). `buildFilename(template, {business, index, date, ext})` signature matches caller in 16.

**Note on Task 4:** during implementation, use the second ("clean form") body of `buildFilename`; the first block is illustrative and should be discarded.
