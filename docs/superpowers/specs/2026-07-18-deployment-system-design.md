# Deployment System — Design

**Decisions (user, 2026-07-18):** keep DirectAdmin + `*.dmviral.com` subdomains; one live site per lead (redeploy replaces in place); management view with redeploy + take-down; HTTPS required. Auto-slug subdomains (no manual naming).

## Verified server facts (probed live against da900.is.cc, 2026-07-18)

Every call below was executed successfully with the current `DA_LOGIN_KEY` (full user-level access, 170 commands) and cleaned up after itself:

| Operation | Call |
|---|---|
| Create subdomain | `CMD_API_SUBDOMAINS?action=create&domain={d}&subdomain={s}` — **`action=add` fails on this build** ("no action included") |
| Delete subdomain | `CMD_API_SUBDOMAINS?action=delete&domain={d}&select0={s}&contents=yes` |
| List subdomains | `CMD_API_SUBDOMAINS?domain={d}` |
| Upload file | `POST /api/filemanager-actions/upload?dir={docroot}&name={file}&overwrite=true`, multipart field `file` — the param is **`dir`** (`path` is silently ignored → home root); the legacy `CMD_FILE_MANAGER` upload 500s on this build |
| Extract zip | `POST /api/filemanager-actions/extract-archive` JSON `{source, destinationDir, members: [], mergeAndOverwrite: true}` |
| Remove files/dirs | `POST /api/filemanager-actions/remove` JSON `{paths: [...]}` |
| List directory | `GET /api/filemanager/list?path={dir}` → `{files: [{name, type, ...}]}` |
| **Docroot layout** | Each subdomain owns `/domains/{sub}.dmviral.com/public_html` (692 existing site dirs confirm) — **not** `/domains/dmviral.com/public_html/{sub}` as the current code assumes |
| HTTPS | **Automatic.** New subdomains serve http within seconds; a cert is issued in ~30–60s, after which http 301s to https. No SSL API work needed — just patient verification |

Auth = Basic `DA_USERNAME:DA_LOGIN_KEY` for both legacy and `/api/*` endpoints. The account password is never needed.

## Components

1. **`lib/template-engine/directadmin.ts` rewrite**
   - Keep: `daConfigured`, `parseDaResponse`, `daCall` (legacy commands), `subdomainExists`.
   - Fix: `createSubdomain` → `action=create`.
   - New: `docrootFor(sub)` (pure), `deleteSubdomain(sub)` (contents=yes), `daJson(path, init)` (modern API w/ basic auth + timeout), `listDir(path)`, `removePaths(paths)`, `clearDocroot(sub)` (remove every entry except `cgi-bin`), and `uploadZipAndExtract(sub, zipBytes, zipName)` rewritten on the modern API (upload → extract-archive → remove zip), same signature as today.
   - All network calls carry AbortController timeouts (30–120s).

2. **Deploy route** (`.../[id]/deploy`) — stable subdomain + in-place redeploy:
   - Subdomain choice: if `lead.website_link` matches `https?://{sub}.dmviral.com` → reuse `{sub}` (redeploy in place). Else `businessSlug(business_name)`; if that subdomain exists (owned by someone else) → `-{idPart}` suffix, as today.
   - If the subdomain exists → `clearDocroot` (stale pages from prior builds must not linger); else `createSubdomain`.
   - Verify step: poll `https://` then `http://` for up to ~90s (cert issuance window); "partial" if still unreachable, as today.
   - Everything else (CAS status flip before the lead-link write, notifications, steps) unchanged.

3. **Take-down route** — `POST /api/template-engine/generations/[id]/takedown` (perm `templates.deploy`): only for status `deployed`; derives the subdomain from `deployed_url`; `deleteSubdomain(contents=yes)`; clears `leads.website_link` (only when it still points at that URL); sets the generation back to `status='review'`, `deployed_url=null`; activity-logs.

4. **Deployments management view** — `/ai-tools/template-engine/deployments`: lists `status='deployed'` generations (business, URL, https badge, deployed date) with **Redeploy** (existing deploy route) and **Take down** (confirm dialog, house rule: closes only via buttons). Linked from the Template Engine launcher header + sidebar (visible with `templates.deploy`).

## Testing

- Pure helpers unit-tested (docrootFor, subdomain-from-website_link parser, upload URL builder); `parseDaResponse` tests stay green.
- Live leg verified by a standalone script against a throwaway subdomain (already done once by hand; repeated after the rewrite) — create → upload real site zip → extract → https poll → take down. No DB writes; production leads untouched.
- Route glue: tsc + existing suite; real lead deploys happen from the UI by the operator.

## Out of scope

Per-client custom domains; Hostinger; deploy queues/scheduling; multi-server. The prod app redeploy itself (hPanel) stays a manual user action; `DA_LOGIN_KEY` must also be updated in the production environment.
