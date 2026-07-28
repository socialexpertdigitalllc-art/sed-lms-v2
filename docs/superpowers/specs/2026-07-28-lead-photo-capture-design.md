# Lead Photo Capture — Design

**Date:** 2026-07-28
**Status:** Approved concept-by-concept by the user
**Touches:** the lead form and lead detail (Images group), a new admin integrations page, the existing `photo-extractor` Chrome extension (which becomes a component of the LMS, not a standalone tool).

## 1. Goal

When a lead is saved with a Google Business Profile link, the system captures up to **30 photos** from that profile without anyone running anything by hand. The photos wait as *candidates*. When an agent opens the lead, the Images group shows them as thumbnails; the agent ticks the ones worth keeping; those are re-hosted on a third-party image host and their **direct URLs** land in `leads.image_links`, which every downstream consumer (Site Builder, Template Engine, copy-lead text) already reads.

Nothing about the lead's own save path changes. Capture is additive and failure-tolerant: a lead with no photos, a dead link, or an agent without the extension saves exactly as it does today.

## 2. Why the capture runs in the agent's browser

This was the one genuinely contested decision, and the alternatives are recorded because they will be proposed again by someone who hasn't hit the walls.

| Option | Verdict |
|---|---|
| Google Places API (official) | **Rejected — cannot meet the requirement.** Caps photos at 10 per place by design. |
| Headless Chromium on the server | **Rejected.** Needs a VPS: Chromium is a native binary linking `libnss3`/`libnspr4`/`libgbm`, which cannot be installed on Hostinger's managed shared/Business Node.js hosting (no root, no package manager). Also ~400–700 MB RAM per capture. |
| Third-party scraper API (SerpApi/Outscraper) | **Rejected.** Recurring per-lead cost for something the agents' own browsers do free. |
| A popup window opened by the LMS page | **Impossible, not merely rejected.** The same-origin policy makes a cross-origin `Window` opaque: `popup.document`, `popup.scrollBy()`, and DOM queries all throw `SecurityError`. An `<iframe>` fails twice over — Google Maps sends `X-Frame-Options`, and a cross-origin frame's DOM is unreadable anyway. |
| **The extension does it** | **Chosen.** `host_permissions` is exactly the privilege a web page can never have, and the extension already implements the hard part. |

The consequence, accepted deliberately: **capture is tied to a person's machine, not to the server.** A lead submitted by an agent without the extension gets no photos automatically — it gets a **Capture photos** button that any agent with the extension can press later. The button is the primary path; auto-on-submit is the convenience layer on top of it.

## 3. Data flow

```
Agent saves lead (Google link present)
        │
        ▼
LMS page  ──postMessage{CAPTURE}──►  extension content-script bridge
                                              │
                                              ▼
                                  service worker opens an unfocused
                                  popup window at the profile URL
                                              │
                                     existing googleAdapter:
                                     prepare() → scroll loop → items()
                                     → first 30, rewritten to =s0
                                              │
LMS page  ◄──postMessage{DONE, photos}────────┘   (window closes)
        │
        ▼
POST /api/leads/[id]/photos/candidates      → lead_photo_candidates (status 'pending')
        │
        ▼
Agent opens the lead → Images group renders thumbnails → ticks a subset
        │
        ▼
POST /api/leads/[id]/photos/upload
        │
        ├─ server downloads / hands off each original
        ├─ upload chain: imgbb keys → postimages → imgchest keys
        └─ direct URLs appended to leads.image_links
```

Note what the browser never sees: the image-host credentials. Uploading is server-side for exactly that reason.

## 4. Concept 1 — The bridge

**The extension introduces itself; the page never addresses it by ID.**

Unpacked extensions derive their ID from a hash of the folder they were loaded from. Agents install manually and will unzip to different paths, so IDs differ per machine and `chrome.runtime.sendMessage(EXTENSION_ID, …)` has nothing stable to aim at.

So the extension gains a content script on the LMS origin that announces itself, and both sides talk over `window.postMessage`:

| Direction | Message |
|---|---|
| ext → page | `{source:'sed-photo-ext', type:'READY', version}` — on script load, and on demand |
| page → ext | `{source:'sed-lms', type:'CAPTURE', requestId, url, max:30}` |
| ext → page | `{source:'sed-photo-ext', type:'PROGRESS', requestId, loaded}` |
| ext → page | `{source:'sed-photo-ext', type:'DONE', requestId, photos:[{key, thumbUrl, sourceUrl}]}` |
| ext → page | `{source:'sed-photo-ext', type:'ERROR', requestId, error}` |

Both sides validate `event.source === window` and check `event.origin` before trusting a message. The content script matches only the LMS origin, so the bridge exists nowhere else.

`READY` doubles as install *and* version detection — the page assumes "not installed" until a handshake arrives, so no probing and no timeout guessing.

A `"key"` field is added to `manifest.json` anyway, pinning the extension ID to one deterministic value across every machine. The bridge doesn't need it; having stable IDs in logs and support conversations is worth ten minutes.

**Auth stays trivial** because the extension never talks to the LMS API. It hands photos to the *page*, and the page — already carrying the agent's session cookie — posts them. No API tokens in the extension, nothing to leak in a zip that agents pass around.

## 5. Concept 2 — Capture

The service worker handles `CAPTURE` by opening the profile URL with `chrome.windows.create({ type:'popup', focused:false, width:1100, height:900 })`, waiting for the tab to finish loading, then driving the **existing, unchanged** `googleAdapter`: `prepare()` clicks into the gallery, the scroll loop lazy-loads it, `items()` harvests and rewrites each URL to `=s0`. It takes the first 30, closes the window, and replies.

Design constraints that are not negotiable:

- **The window must be visible.** Chrome throttles timers and suspends rendering in hidden tabs, which starves the scroll loop. Unfocused-but-visible is fine; minimized is not. The window therefore appears for ~10–25 s and closes itself.
- **Hard timeout of 90 s**, plus a stall detector: if the harvested count doesn't grow for 20 s, stop and return what's there. A capture that hangs must never leave an orphan window on the agent's screen.
- **One capture at a time** per browser. Concurrent requests queue; a second lead saved during a capture waits rather than opening a second window.
- On the page side, capture is fire-and-forget: a toast reports progress and outcome, and the agent is never blocked.

**Triggers:** (a) automatically after a successful save from the New Lead form when `business_profile_link` is a Google URL; (b) automatically when that field is edited to a Google URL on an existing lead — a link fixed after submit must not be stranded; (c) manually via the **Capture photos** button in the Images group, which also re-captures.

Re-capture is idempotent: candidates are upserted on `(lead_id, photo_key)`, so a photo already uploaded keeps its hosted URL and is not re-uploaded.

## 6. Concept 3 — Candidates

Two new tables. `leads` is not altered — the same posture as `0060_builder_images.sql`, and capture state has no business in the lead row.

**`lead_photo_captures`** — one row per lead, the state of its most recent capture: `status` (`pending` while the popup works, `ready`, `none_found`, `failed`), `found_count`, `error`, `extension_version`, `requested_by`, timestamps. This is what the Images group reads to decide between a spinner, a grid, "no photos found", or an error with a retry button.

**`lead_photo_candidates`** — one row per harvested photo: `lead_id`, `photo_key` (the Google photo ID, the natural dedupe key), `thumb_url`, `source_url` (the `=s0` original), `status` (`pending` → `uploaded` | `failed` | `skipped`), `hosted_url`, `host_provider`, `error`, timestamps. Unique on `(lead_id, photo_key)`.

Thumbnails render straight from `thumb_url` — googleusercontent URLs hotlink fine, so the picker costs no storage and no bandwidth of ours. Only *selected* photos ever get copied anywhere.

Candidates are the audit trail: after upload you can still see which of the 30 were rejected and why an upload failed.

## 7. Concept 4 — The picker

The Images group in `LeadDetail.tsx` (`SectionCard n={5}`) keeps its existing "Image links (one per line)" textarea — manual entry stays possible and nothing existing breaks — and gains a photo panel above it:

- Thumbnail grid with checkboxes, **Select all / none**, and a live "N selected" count, mirroring the extension's side panel so the interaction is already familiar.
- A **Use selected photos** button that uploads and, on success, appends the resulting direct URLs to the textarea's list.
- Already-uploaded candidates render with a checkmark badge and are excluded from re-upload.
- States: capturing (spinner + live count), ready (grid), none found, failed (message + **Capture photos** retry), and — when no Google link is on the lead — nothing at all.

## 8. Concept 5 — The upload chain

Selected photos are re-hosted server-side, one per request, through an ordered chain:

**imgbb** (all keys, in the order added) → **postimages** → **imgchest** (all tokens, in the order added).

Providers in that fixed order; within a provider, by `position` ascending, which is insertion order. A host that reports a limit is skipped and the next one in the same provider is tried; when a provider has nothing usable left, the chain drops to the next provider. A photo that exhausts the entire chain is marked `failed` with the last error — **and the batch continues**. One dead photo never aborts the rest, exactly as the extension's own report behaves.

### Per-provider mechanics (verified against the live docs)

**imgbb** — `POST https://api.imgbb.com/1/upload?key=KEY`, form fields `image` and `name`. The `image` field accepts an **image URL**, so imgbb fetches the original from Google itself and our server transfers no bytes at all. Direct URL is `data.url`. Max 32 MB. **The published docs state no rate limit or quota**, so exhaustion cannot be predicted — only detected from responses.

**postimages — no API and no API keys exist.** This contradicts the original request ("add as many postimages API keys as you want") and the design adapts rather than pretends: postimages publishes no developer API, and the working method is an undocumented endpoint. The flow is `GET https://postimages.org/` to scrape a `token`, then `POST https://postimages.org/json/rr` with `token`, a client-generated 32-char `upload_session`, `numfiles=1`, `optsize=0`, `expire=0`, `session_upload`, and the file bytes; the response gives a page URL whose `og:image` meta tag holds the direct link. It is therefore modelled as a **keyless provider**: a single enable/disable row with no credentials, its token fetched fresh per upload. Free/anonymous limit is 32 MB per file.

**Recorded risk:** this is an undocumented endpoint that can change without notice. It sits in the middle of the chain precisely so its failure degrades to imgchest rather than losing the upload. If it breaks, disabling that one row is the whole fix.

**imgchest** — `POST https://api.imgchest.com/v1/post`, `Authorization: Bearer TOKEN`, multipart `images[]` (up to 20 files per post), `privacy: hidden`. Each image's direct link comes back as `https://cdn.imgchest.com/files/{id}.{ext}`. Documented limit: **60 requests/minute**, with `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers — the one provider that tells us where we stand before we hit the wall. Tokens are per-account personal access tokens, so multiple keys are genuinely meaningful here.

postimages and imgchest need the actual bytes, so for those the server downloads the original from googleusercontent first (public, no auth) and forwards it.

### Exhaustion vs. breakage

Two different failures with two different responses, because retrying a dead key forever is as bad as abandoning a live one:

- **Rate-limited / quota** — HTTP 429, an imgchest `X-RateLimit-Remaining: 0`, or a provider error matching a limit pattern → set `exhausted_until = now() + 1 hour` and move to the next host. It rejoins the chain automatically.
- **Broken credential** — 401/403 or an invalid-key error → set `enabled = false` with `last_error` recorded and surface it on the admin page. No cooldown; a wrong key does not fix itself.

Everything else (5xx, network) gets a short bounded retry against the *same* host before moving on.

## 9. Concept 6 — Key administration

A new **Image hosts** page under `/admin`, gated by `integrations.manage` like `ai-models` and `email-providers`. Add / remove / reorder credentials per provider, unlimited count. Credentials are AES-256-GCM encrypted with `MAILBOX_ENC_KEY` via `lib/mail/crypto.ts` and stored as `iv:tag:ciphertext` — the exact pattern `ai_providers` established. The table gets RLS enabled with **no policies**: service-role routes only, so keys are unreadable from the browser by construction. The page shows a masked hint, enabled state, upload count, last error, and cooldown status — never the key.

## 10. Concept 7 — Distribution

The extension is **not** going to the Chrome Web Store and **not** being force-installed by policy. Agents install it manually, so:

- `npm run build:extension` zips `photo-extractor/` to `public/downloads/business-photo-extractor-<version>.zip`, version read from `manifest.json`. Build-time, static, and structurally incapable of drifting from source.
- A dismissible install card appears on the dashboard and above the New Lead form whenever no `READY` handshake has arrived. It has a **Download extension** button and the four steps. Step two is a **copy-to-clipboard** control, not a link, because Chrome blocks web pages from navigating to `chrome://extensions`.
- Because manual installs never auto-update, the handshake's `version` is compared against the current build and an **Update available** banner appears with the same download button. Without this you eventually get agents silently running an old build and no way to know which.

Two things agents will notice, documented so support isn't surprised: Chrome shows a dismissible *"Disable developer mode extensions"* bubble on startup for unpacked extensions, and a capture briefly flashes a popup window.

*(A web page cannot install an extension. Chrome's inline installation — `chrome.webstore.install()` — was deprecated in June 2018 and removed in Chrome 71; calling it now throws a `TypeError`. There is no replacement API.)*

## 11. Concept 8 — Extension fixes

**Stale photos from the previously viewed business.** `collect()` scans the entire `document` for googleusercontent images ([content.js:75-85](../../../photo-extractor/content/content.js)). Google Maps is a single-page app: navigating between businesses never reloads, and Maps retains the previous place card hidden in the DOM. That card's hero strip is about five or six thumbnails — matching the reported symptom exactly, and explaining why the first run of a session is always clean. (Reviewer avatars are already excluded: the token regex matches only `/p/` and `/gps-cs-s/`, while avatars are `/a/`, which is why the leak is a small fixed number rather than dozens.)

**Verify before fixing.** Confirm on a second business that the document-wide count exceeds the count scoped to the gallery container by 5–6 before touching anything. Fix only what the evidence supports.

The fix, assuming it confirms: scope collection to the container `getScrollContainer()` returns instead of `document`, skip nodes that aren't actually rendered (`getBoundingClientRect().width === 0` or no `offsetParent`) so retained hidden DOM is dropped, and reset harvested state when the place ID in `location.href` changes. `core/url-tools.js` stays the tested canonical copy; the content script mirrors it.

The new capture flow sidesteps this structurally — each capture opens a fresh window with no previous place in it — but the side panel stays in manual use and must be correct.

**Selection leak.** `state.selected` is never cleared between runs ([sidepanel.js:172](../../../photo-extractor/sidepanel/sidepanel.js)), so after a second business the "N selected" count includes IDs from the first. Downloads are unaffected (`chosen` filters against `state.items`), but the number lies. Clear the set at the start of each `onLoadAll`.

## 12. Schema

`supabase/migrations/0061_lead_photo_capture.sql` — **additive only**, three new tables, no drops, no type changes, no edits to any existing table. **File only: the operator applies it after review**, per the shared-prod-DB rule in AGENTS.md.

- `lead_photo_captures` — per-lead capture state (§6)
- `lead_photo_candidates` — per-photo rows, unique `(lead_id, photo_key)` (§6)
- `image_hosts` — `provider` (`imgbb` | `postimages` | `imgchest`), `label`, `encrypted_credentials` (null for postimages), `position`, `enabled`, `exhausted_until`, `last_error`, `upload_count`, `created_by` (§9)

All three: RLS enabled, no policies, service-role routes only.

## 13. API surface

| Route | Purpose |
|---|---|
| `GET /api/leads/[id]/photos` | capture state + candidates for the Images group |
| `POST /api/leads/[id]/photos/candidates` | the page reports what the extension harvested (or that it failed) |
| `POST /api/leads/[id]/photos/upload` | run the chain over selected `photo_key`s, append to `image_links` |
| `GET /api/extension/version` | current version + download path, for the update banner |
| `GET/POST /api/admin/image-hosts`, `PATCH/DELETE /api/admin/image-hosts/[id]` | key management, `integrations.manage` |

Lead permissions are enforced on every lead-scoped route exactly as the existing `/api/leads/[id]` routes do.

## 14. Failure behaviour

| Situation | Behaviour |
|---|---|
| Extension not installed | Lead saves normally. Install card shown. Images group offers **Capture photos**, which prompts to install. |
| Not a Google link (Yelp, website, blank) | No capture, no UI noise. (`yelpAdapter` exists and makes Yelp cheap to add later — out of scope now.) |
| Popup blocked / window closed by the agent | `ERROR` → capture marked `failed`, retry button shown. |
| Gallery yields 0 photos | `none_found`. If the adapter reports zero on a page that clearly has photos, the message says the adapter may be stale — the existing health signal. |
| Some uploads fail | Successes are saved and appended; failures are listed per photo with their reason. |
| Whole chain exhausted | Photo marked `failed`; the admin page shows which hosts are cooling down or disabled. |
| Two agents open the same lead | Uploads are idempotent per `(lead_id, photo_key)`; a candidate already `uploaded` returns its existing URL. |

## 15. Testing

- **Pure logic, vitest:** chain ordering (given hosts + cooldowns + failures, which host is next), error classification (429/401/5xx → exhausted/disabled/retry), response parsing per provider, and `image_links` append/dedupe.
- **Provider calls:** mocked `fetch` against captured real response shapes. No live uploads in CI.
- **Extension, `node --test`:** the scoped-collection fix in `core/`, following the existing pattern where `core/` is canonical and tested and `content.js` mirrors it.
- **Manual, and required before acceptance:** a real capture on a real profile, including the second-business run that proves the stale-photo bug is gone.

## 16. Out of scope

Yelp capture; per-agent capture quotas; automatic re-capture on a schedule; album/folder organisation on the image hosts (imgbb's API has no album endpoint at all); replacing the manual side-panel workflow, which stays as-is.

## 17. Risks

1. **postimages is undocumented** (§8) — mitigated by its position in the chain and a one-click disable.
2. **Google markup changes** break `googleAdapter` — already true of the extension today; the isolation is unchanged (one file, documented in the extension README) and the health signal already reports a stale adapter.
3. **Manual installs drift** — mitigated by the version handshake and update banner, but an agent can still ignore it. Accepted.
4. **Capture depends on an agent's machine being awake** with a visible window for ~20 s. Accepted as the cost of not running Chromium on a server.
