# Custom-ZIP upload + Subdomain → Custom-Domain Transfer — Design

## Verified infrastructure (probed live 2026-07-18)

- **Staging** = DirectAdmin `da900.is.cc`, `*.dmviral.com` subdomains (~700). Docroot `/domains/{sub}.dmviral.com/public_html`. This is where sites are generated, previewed, and **manually edited**.
- **Production** = ONE Hostinger hosting plan (user `u461699018`, order `1008312340`) with **96 addon-domain websites**, each at `/home/u461699018/domains/{domain}/public_html`. The finalized client sites live here.
- **The LMS itself** (`lms.sedsolutions.online`) runs on that SAME Hostinger hosting account — so the LMS process shares a filesystem + user with every client addon domain.
- Hostinger account holds **~95 registered client domains** (`domains_getDomainListV1`).
- DirectAdmin can hand back a live subdomain's files as a zip: `GET /api/filemanager/download-archive?path={docroot}&type=zip` → **verified, returns a real zip** (`archiveDocroot()` in directadmin.ts, shipped).

## Feature A — Custom-ZIP → subdomain (SHIPPED)

Upload a hand-built/edited site zip → deploy to a **new** dmviral subdomain or **overwrite an existing** one, independent of the generator. `POST /api/template-engine/deployments/upload` (multipart file/mode/subdomain, `templates.deploy`, 60MB, quick non-blocking verify) + an "Upload a site (ZIP)" panel on the Deployments page. Reuses createSubdomain/clearDocroot/uploadZipAndExtract.

## Feature B — Transfer subdomain → custom domain (DESIGN; needs 2 confirmations)

**Flow the operator triggers** (from the lead / Deployments board, once a client approves the staging site):
1. Pick the client's Hostinger domain (from `domains_getDomainListV1`, surfaced in the dashboard).
2. **Source the site FRESH from the live DA subdomain** via `archiveDocroot(sub)` — captures manual edits made directly to the subdomain, NOT the stale generator zip.
3. Ensure the domain is an **addon domain** on the Hostinger plan (`hosting_createWebsiteV1(domain, order_id=1008312340)` if not already present — 96 already are).
4. **Deploy the files** into `/home/u461699018/domains/{domain}/public_html` (mechanism = OPEN QUESTION below).
5. Verify `https://{domain}` serves; repoint `leads.website_link` to it.
6. **Delete the dmviral subdomain** (`deleteSubdomain`) — staging is done.

### The two things needed before building B

1. **App Hostinger API token** — `HOSTINGER_API_TOKEN` in the LMS env (and prod). The public REST API is `https://developers.hostinger.com` (Bearer token). Needed for: list domains, create addon domain, DNS. Not present yet.

2. **The file-deploy mechanism** (the crux — Hostinger's public REST API has NO "upload files to shared hosting" endpoint; the MCP `hosting_deployStaticWebsite` tool is not callable from the app). Options:
   - **(A) Local filesystem write (RECOMMENDED)** — the LMS runs on the SAME Hostinger account as the addon domains, so the Node process can create the addon domain via API, then unzip the DA archive straight into `/home/u461699018/domains/{domain}/public_html` with `fs`. No FTP/SSH, no upload API. Only works in prod (where the LMS is on that box) — which is fine, deploy is a prod action. **Needs confirmation that the LMS process can write that path** (same user → very likely yes).
   - **(B) FTP/SFTP** — the LMS opens an FTP connection to the Hostinger account and uploads the files. Works from anywhere but needs FTP creds + is slower for many files.
   - **(C) SSH + unzip** — if SSH is enabled on the plan.

   Recommendation: **A**, with **B** as the portable fallback.

### Data model
Add to the generation/lead: `custom_domain`, `production_url`, `transferred_at`. The Deployments board gains a "Production" column and a "Transfer to custom domain" action.

## Out of scope (for now)
In-app domain PURCHASE (money — explicit-confirm + permission if added later), DNS automation (Hostinger domains already resolve to the hosting), email/MX, WordPress.
