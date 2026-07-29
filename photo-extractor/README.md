# Business Photo Extractor

A Manifest V3 Chrome extension that extracts every photo from an open **Google Maps** or **Yelp** business gallery and downloads your selection at **maximum resolution** — as individual files or a single ZIP — from a Side Panel UI.

- **Google Maps** → true native originals (rewrites the photo URL suffix to `=s0`, often 3000–6000 px+).
- **Yelp** → the largest size Yelp serves (`o.jpg`, ~1000 px long edge — a Yelp CDN ceiling, not a limitation of this tool).

## Features

- Select / bulk download (grid with checkboxes, select-all / none, live count)
- Full-resolution upgrade + optional single-ZIP bundle
- Auto-scroll to load **all** lazy-loaded gallery photos before extraction
- Filter by photo category (where the site exposes it) and customizable filename template
- Live progress, a Stop button, and a per-photo failure report (one bad image never aborts the batch)
- **Upload selected photos to imgbb** and copy all direct URLs at once

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder (`photo-extractor`).
4. (Optional) Pin the extension from the puzzle-piece menu so the toolbar icon is visible.

Requires Chrome 114+ (Side Panel API).

## Use

1. Open a business on Google Maps (and open its **Photos** gallery) or a Yelp `/biz/<slug>` or `/biz_photos/<slug>` page.
2. Click the extension's toolbar icon → the Side Panel opens and shows the detected site.
3. Click **Load all photos** — it auto-scrolls the gallery and harvests every photo (watch the counter).
4. Select the photos you want (or **Select all**), pick a resolution and a name template, choose **Individual files** or **One ZIP**, and click **Download selected**.

Downloads land in your Downloads folder under the subfolder from the name template (default `{business}/{business}_{index}`).

## Upload to imgbb

1. Get your API key from imgbb.com → account → **About → API**.
2. In the side panel's **Upload to imgbb** section, the **Account** dropdown → **+ Add account…**, give it a **name** (e.g. "Main") and paste the key, then **Save**. Keys are stored locally and **auto-load every time** — you never re-enter them. Add as many named accounts as you like and switch between them in the dropdown; the trash icon removes the selected one.
3. Select photos, then click **Upload selected to imgbb**. Each image is uploaded (imgbb fetches the original by URL, falling back to a direct byte upload), titled `{business}_NNN`.
4. When done, a box shows every **direct URL** with a **Copy all URLs** button (and per-row copy).

**Album limitation (honest):** imgbb's public API has no album endpoint — there is no way to create or assign an album with an API key. Uploads land in the account tied to your key, titled `{business}_NNN` so they're easy to find; group them into an album manually on imgbb.com if you need one.

## Development

```bash
npm test        # runs the pure-logic unit suite (node --test, Node 18+)
```

- Pure logic lives in `core/` (URL upgrades, naming, concurrency, scroll stop-conditions, zip, imgbb) and is unit-tested. `core/url-tools.js` and `core/scroll-state.js` are the canonical, tested versions of helpers that the content script mirrors.
- Per-site extraction (Google / Yelp / generic adapters + scroll loop) lives **inlined** in `content/content.js`. It is a single self-contained classic script — no ES-module imports and no dynamic `import()` — so it runs even on sites with strict CSP / Trusted Types (e.g. Yelp) that block content-script dynamic imports.
- The side panel (`sidepanel/`) is an extension page and imports `core/*` directly.
- `vendor/client-zip.js` is bundled (MV3 forbids loading remote code at runtime).

### If a site changes its markup

If **Load all photos** finds 0 photos, the panel reports that the adapter "may be stale." Fix is isolated to `content/content.js`:

1. Open the business page, press F12, and in the console check what's present (no extension internals needed):
   ```js
   // Google: how many photo tiles are on the page right now?
   document.querySelectorAll('img[src*="googleusercontent"], [style*="googleusercontent"]').length
   // Yelp: how many bphoto ids are in the HTML?
   (document.documentElement.outerHTML.match(/yelpcdn\.com\/bphoto\//g) || []).length
   ```
2. Inspect a photo tile, find the element carrying the image URL (inline `style` / computed `background-image` for Google; the `bphoto` URL for Yelp), and update the matching selector/regex inside the `googleAdapter` or `yelpAdapter` block in `content/content.js`.
3. Reload the extension and re-test. No other file needs to change.

## Notes & limits

- **Yelp tops out at ~1000 px.** Google Maps yields true originals. The resolution dropdown only affects Google.
- This is a **user-initiated** tool that acts only on a page you've already opened, with throttling/retry built in. Both sites' Terms of Service restrict automated collection — use it for personal purposes and respect the copyright of any photos you download.

See [`docs/superpowers/specs`](docs/superpowers/specs) and [`docs/superpowers/plans`](docs/superpowers/plans) for the full design and implementation plan.
