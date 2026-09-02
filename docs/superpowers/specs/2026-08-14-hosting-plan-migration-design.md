# Hosting Plan Migration — Design

**Date:** 2026-08-14
**Goal:** Move the hosted website fleet off the full `cloud_economy_v2` plan onto the newly purchased `cloud_economy_v5` plan, same Hostinger account.

---

## 1. Current state (verified via Hostinger API, 2026-08-14)

| | Old plan | New plan |
|---|---|---|
| Order ID | `1008312340` | `1009861861` |
| Subscription | `AzyXesV3xZUgC2FuM` | `AzqepHVSHnevA1tyJ` |
| Product name | **Cloud Startup** | **Cloud Startup** |
| Internal SKU | `cloud_economy_v2` | `cloud_economy_v5` |
| Price | $311.88/yr | $311.88/yr |
| Renewal | **`non_renewing` — expires 2026-11-29** | active, next billing 2027-07-31 |
| Account user | `u461699018` | `u447231526` |
| Home dir | `/home/u461699018` | `/home/u447231526` |
| Websites | **100 (at cap)** | 1 (`auramasters.com`) |
| Databases | 28 | 0 |
| Created | 2025-11-29 | 2026-08-14 |

The two plans are **separate Linux accounts**. Nothing moves by changing a setting; every site is a real file (and, for WordPress, database) transfer.

### Site classification (all 100 inspected individually)

| Class | Count | What it needs |
|---|---|---|
| Static HTML | 71 | files only |
| WordPress | 24 | files + MySQL database + `wp-config.php` credential rewrite |
| Empty / dead root | 4 | recreate empty |
| Node.js / JS app | 4 | out of scope this phase (see §3) |

One WordPress install (`technotruckllc.com`) runs WooCommerce (`shop/`). The 24 WordPress sites map to the 28 databases on the old account; 4 databases appear orphaned.

---

## 2. Blocking pre-flight checks

These must be resolved **before any site is touched**.

### 2.1 Does the new plan actually hold more sites?

Both subscriptions are the **same product at the same price**. The new plan is not a larger tier. The reason it should still work: Hostinger changed cloud plan limits on **2026-06-17** so that cloud plans include unlimited websites. The old plan (`v2`, bought 2025-11-29) predates that change and is capped at 100; the new plan (`v5`, bought 2026-08-14) should fall under the new uncapped terms.

**This is inference, not a verified fact — the API does not expose the cap.**

**Action:** confirm in hPanel (Websites page shows a `X / Y` counter on the plan) or via Hostinger support before migrating. If `cloud_economy_v5` is also capped at 100, this migration achieves nothing and the correct move is a tier upgrade instead.

### 2.2 The old plan expires 2026-11-29

The old subscription is `non_renewing`. Everything left on it — including the LMS and the other Node apps — **goes offline on 2026-11-29** unless renewal is re-enabled or those apps are moved first. This sets a hard deadline for the follow-up phase.

---

## 3. Scope

### Migrating now — 95 sites

- 68 static sites
- 24 WordPress sites
- 3 empty roots (`socialexpertdigitalllc.com`, `nuone.sedsolutions.online`, `lalosautotint.com`) — recreated empty, migrated as-is per instruction

### Staying on the old plan — 5 (owner will handle later)

| Domain | Type | Note |
|---|---|---|
| `lms.sedsolutions.online` | Next.js (104 deploys) | production LMS |
| `bot.sedsolutions.online` | Next.js (39 deploys) | |
| `store.dinteriordesignsandfabric.com` | Vite (11 deploys) | |
| `spartans.sedsolutions.online` | Vite (1 deploy) | |
| `botcdn.sedsolutions.online` | static widget CDN | serves `widget.js` for `bot.` — recommend it stays with `bot.` |

The single cron job (`*/5` mail poll → `lms.sedsolutions.online/api/mail/poll`) targets the LMS and stays on the old plan with it.

### Migrating everything as-is

Per instruction: no deletions, no cleanup, no duplicate resolution. Noted but **not acted on**:

- `getitdoneland.com` — publicly downloadable 101 MB `public_html.zip`
- `granada-floors.com` — publicly downloadable 35 MB `public_html.zip`
- `americancontractingteam.com` — exposed `SEO_Growth_Strategy_Status_Report.pdf` / `.pptx`
- 6 more sites with leaked deployment zips in the doc root
- `acdreams.sedsolutions.online` is byte-identical to `acdreamsllc.com`
- `thedrywallpro.com` is byte-identical to `sandsrewall.com` — one may be serving the wrong brand's content

These get copied across unchanged. Recommend a cleanup pass afterwards.

---

## 4. Accepted consequence: LMS ↔ hosting decoupling breaks

The LMS deploys client sites by writing directly to the local filesystem ([`lib/template-engine/fsDeploy.ts:15`](../../../lib/template-engine/fsDeploy.ts)), which only works because the app and the sites share one account. The LMS stays on `u461699018` while 95 sites move to `u447231526`.

**After migration, for every migrated site these LMS features stop working:**

- deploy / redeploy of a generated site
- shuffle (versioned re-deploy)
- upload / override live files
- download live website files
- takedown

The deployments board will still *list* them (it reads the Hostinger API), but any filesystem action fails.

**Required follow-up work** (not part of this migration): make the deploy path account-aware — either push over the Hostinger API instead of `fs` writes, or move the LMS to the new account. Until then, treat migrated sites as manually managed.

> **RESOLVED 2026-09-03 (writes only):** deploys now go over the Hostinger API — `deployZipToWebsite` in [`lib/hostinger/client.ts`](../../../lib/hostinger/client.ts) (upload-urls → TUS upload → deploy-from-archive), wired into both transfer routes and the override-upload paths. Verified live end-to-end on a throwaway subdomain website on the new plan: content served, no archive leftover, no cross-account disk access. `HOSTINGER_ORDER_ID` pins which plan `ensureWebsite` creates new addon websites on. **Still fs-bound:** downloading a custom domain's live files (`zipDirFromDisk` in liveFiles.ts) — works only for sites on the LMS's own account.

**Mitigation during migration:** freeze site generation and deploys for the duration.

---

## 5. Architecture: stage first, then cut over

`hosting_deleteWebsiteV1` **destroys the files and databases**. A domain can only be attached to one hosting account at a time. So the naive "delete then recreate" sequence has a window where the only copy of a site is gone.

The design avoids that entirely:

```
Phase A — STAGE (zero downtime, sites stay live)
  new account: /home/u447231526/migration-staging/<domain>/
    ├── files/          rsync pull from old account, site still serving
    └── db.sql          mysqldump for WordPress sites
  → verify checksums + file counts against source

Phase B — CUT OVER (per site, minutes of downtime)
  1. delete website from OLD plan
  2. create website on NEW plan (order_id 1009861861)
  3. move staged files into the new doc root
  4. WordPress: create DB on new account, import db.sql, rewrite wp-config.php
  5. verify HTTP 200 + content + SSL
  6. mark done in the tracking sheet

Phase C — VERIFY SWEEP
  all 95 sites re-checked, DNS + SSL confirmed
```

Nothing is deleted from the old plan until a verified copy exists on the new one.

### Transport

SSH is available on both accounts. Files move **server-to-server** — never through the local machine:

```
rsync -az --delete -e 'ssh -p 65002' \
  u461699018@<OLD_IP>:/home/u461699018/domains/<domain>/public_html/ \
  /home/u447231526/migration-staging/<domain>/files/
```

Run from the **new** account, pulling from the old. Requires the new account's public key in the old account's `authorized_keys`.

A dedicated keypair has been generated locally for this:
`~/.ssh/hostinger_migrate` / `.pub` (ed25519, comment `claude-hostinger-migration`).

### WordPress specifics

Because **the domain does not change**, no URL search-replace is needed. Only database credentials change:

1. `mysqldump` each of the 24 databases on the old account
2. create a fresh database + user on the new account (Hostinger API returns the generated credentials)
3. import the dump
4. rewrite `DB_NAME`, `DB_USER`, `DB_PASSWORD` in `wp-config.php`
5. leave `DB_HOST` as `localhost`

### DNS and SSL

**CORRECTED 2026-08-14 after auditing 72 of 95 domains — the original assumption was wrong.**

DNS is **not** uniform. Three distinct patterns exist:

| Pattern | Count (of 72 audited) | Behaviour on move |
|---|---|---|
| `ALIAS_CDN` — `@` ALIAS → `<domain>.cdn.hstgr.net`, no AAAA | 41 | **auto-follows**, no action |
| `STATIC_A` — `@` A `72.62.85.20` + AAAA `2a02:4780:2b:1669:0:1b84:f7ca:10`, `www` CNAME → apex | 28 | **breaks** unless A *and* AAAA are rewritten |
| `OTHER` — no Hostinger DNS zone at all | 3 | external nameservers; must be checked at the registrar |

**Audit completed for all 95 domains 2026-08-14.** Root-record type turns out not to matter (see the pilot result below); the only thing that matters is whether a Hostinger zone exists at all.

**4 domains have NO Hostinger DNS zone** — external nameservers, so nothing auto-updates and the move must be coordinated at the registrar:

- `granada-floors.com`
- `hammernaildc.com`
- `hands2trust.com`
- `summitroofingnw.com` (WordPress, 374 MB)

**1 domain is pointed at a third party** — `wacheeworx.com` has a Hostinger zone, but its root `A` set is `15.197.212.204`, `3.33.229.73` (AWS Global Accelerator) *alongside* `72.62.85.20`, and `www` is a CNAME to `domains.jobbersites.com.` That is a split/duplicated setup with Jobber, not a plain Hostinger site. Migrating the Hostinger side may not move what visitors actually see. **Hold and clarify before touching.**

New server targets: **A `76.13.203.71`**, **AAAA `2a02:4780:1:1055:0:1aa8:3626:1`**.

**RESOLVED 2026-08-14 by pilot — no manual DNS work is needed after all.**

Creating the website on the new plan **automatically normalises the zone**. Verified on `lalosautotint.com`, a `STATIC_A` domain. Before cutover:

```
@   A     72.62.85.20
@   AAAA  2a02:4780:2b:1669:0:1b84:f7ca:10
www CNAME lalosautotint.com.          (self-referential)
```

Immediately after `createWebsite` on the new plan, with no manual edit:

```
@   ALIAS lalosautotint.com.cdn.hstgr.net.
www CNAME www.lalosautotint.com.cdn.hstgr.net.
ftp A     76.13.203.71
```

Hostinger deleted the static A/AAAA pair and replaced it with the CDN alias. An attempt to set `@ A` manually is in fact *rejected* — `[DNS:4005] RRset ... IN ALIAS must not be used with A on the same name`.

**Conclusion: do not pre-write DNS for `STATIC_A` domains.** Let `createWebsite` do it, then verify. The only domains needing manual attention are the 3 with no Hostinger zone.

Every domain also carries an `ftp` A record pinned to `72.62.85.20`. It does not affect web traffic but will dangle after the move.

The remaining 23 domains still need auditing (audit was interrupted).

SSL certificates do **not** transfer. Hostinger auto-issues Let's Encrypt after the domain attaches to the new account, but there is a short window where HTTPS may fail. SSL status is part of the per-site verification.

---

## 6. Batching

| Batch | Contents | Rationale |
|---|---|---|
| 0 | 1 static pilot site | prove the pipeline end to end before scaling |
| 1 | 3 empty roots | trivial, frees confidence |
| 2 | 67 remaining static sites | files only, fast, low risk |
| 3 | 23 WordPress sites | files + DB + config rewrite |
| 4 | `technotruckllc.com` (WooCommerce) | last — highest risk, live shop |

Staging (Phase A) runs for the whole fleet up front and is safe to run at any time.

---

## 7. Verification

Per site, before it is marked done:

- source vs staged file count and total byte size match
- `HTTP 200` on `https://<domain>/`
- homepage body contains a known string captured pre-migration
- valid SSL certificate for the domain
- WordPress only: site loads without a DB connection error; `/wp-admin/` reachable

A per-site tracking table records: staged ✓, cut over ✓, verified ✓, notes.

---

## 8. Rollback

Per site, before deletion from the old plan there is nothing to roll back — the site is untouched and live.

After cutover, if a site fails verification:

1. staged copy still exists at `/home/u447231526/migration-staging/<domain>/` — re-run the file move
2. if the new plan is unusable for that site, recreate the website on the old plan and restore from staging (old plan has free slots as sites leave)

The staging directory is retained until **all 95 sites are verified**, then archived rather than deleted.

---

## 8a. Data-quality warning: the file-listing API lies

`hosting_listWebsiteFilesAndDirectoriesV1` returned an **empty document root** for `lalosautotint.com`. rsync then pulled **21 real files (1.37 MB), including the 25,002-byte `index.html` that the live site actually serves**.

Any classification derived from that endpoint is unreliable. All site classification in this document has been re-derived from the **staged copies on disk** (ground truth), not from the API:

- 24 WordPress sites — identified by an actual `wp-config.php` in the staged tree
- only 2 sites genuinely lack an index page: `nuone.sedsolutions.online` and `socialexpertdigitalllc.com` (1 file each — just `.htaccess`)
- every other site has a real `index.html` or `index.php`

## 8b. OUTCOME (executed 2026-08-15, 00:00–01:00)

**89 sites migrated. 88 verified matching their pre-migration baseline. 1 destroyed.**

| Group | Result |
|---|---|
| Static | 64 OK |
| WordPress | 22 OK (incl. the pilot and `technotruckllc.com`) |
| Database errors across all 22 WP sites | **0** |
| Broken | 1 — `nuone.sedsolutions.online` |

Final counts: old plan **100 → 11**, new plan **1 → 91**. New account: 12 GB domains + 14 GB staging, 793,781 inodes — well inside the 100 GB / 2M limits.

### Incident: `nuone.sedsolutions.online` destroyed

A **Passenger Node.js app** misclassified as an empty static site. Its `public_html` held only a `.htaccess`, which was a Passenger config pointing at `.builds/current/nodejs` — *outside* `public_html`, and therefore never staged. `deleteWebsite` removed the whole domain directory on the old server, destroying the application source. Baseline was HTTP 200 / 23,343 bytes; it now returns 503.

**Root cause:** an htaccess-only docroot is the signature of a Passenger app, not of an empty site. Node apps were identified via the JS-deployments API for four *suspected* domains only; the two "empty" ones were never re-checked.

`socialexpertdigitalllc.com` had the identical shape and was caught before processing — moved to the held list with its `hbuilds/`+`nodejs/` intact.

**Detection rule for any future run:** treat `grep -l 'PassengerAppRoot' */public_html/.htaccess` as a hard exclusion, and never migrate a site whose docroot is htaccess-only without inspecting it.

### Other corrections found during execution

- `technotruckllc.com` is **not** WooCommerce. WooCommerce routes 404; the store is static HTML at `shop/store.html`. `/shop/` returning 403 is pre-existing (no index file in that directory).
- `royalimagelawn.com` came through byte-identical to its broken baseline (500 / 2894 / `c5327375a71a`) — pre-existing fault preserved, not caused by the migration.
- Verification must force `--resolve` at the new server. Public DNS keeps the old A/AAAA for up to its 1800s TTL, and the old box returns 403/TLS-error for a domain it no longer hosts — a propagation artifact that reads as a migration failure.
- Hostinger provisions database users **asynchronously**; importing immediately after create fails `ERROR 1045`. Wait for the grant.

## 9. Open items

1. **Confirm the new plan's website cap** (§2.1) — blocking
2. **Confirm the 2026-11-29 old-plan expiry is understood** (§2.2) — blocking for the Node/LMS phase
3. SSH host/IP and port for both accounts; install the migration public key on both
4. Confirm total disk footprint of the 95 sites fits the new plan's storage (measured during Phase A staging)
