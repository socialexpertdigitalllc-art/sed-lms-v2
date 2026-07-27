# Site Studio Phase 4b — SOPs, Acceptance & Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the rebuild. Write the three SOPs and render them in-app, carry v2's live deployment records into `studio_deployments` so the new board manages old and new sites through one surface, pass the acceptance gate on a real lead, then delete the old engine.

**Architecture:** Nothing new is invented here. This phase is documentation, one data migration, one link repoint, a human acceptance run, and a deletion. The only code that survives from `lib/template-engine/` is `directadmin.ts` — verified to have **zero sibling imports**, so removing the other 50 files is a clean cut.

**Tech Stack:** No new dependencies. Markdown SOPs rendered by a small in-app viewer; one SQL data migration; deletions.

**Spec authority:** `docs/superpowers/specs/2026-07-23-site-studio-design.md` §11 (cutover & deletion), §12 (SOPs), §13 (kept systems), §14 (acceptance criteria).

**Verified starting facts (measured 2026-07-27, don't re-derive):**
- The kept boundary is exactly one file: `lib/template-engine/directadmin.ts`, imported by `lib/site-studio/deploy/slug.ts`, `app/api/site-studio/runs/[id]/deploy/route.ts`, `app/api/site-studio/deployments/[id]/route.ts`. It imports nothing from its siblings.
- Old engine surface to remove: **28** route files under `app/api/template-engine/`, **3** pages under `app/(app)/ai-tools/template-engine/`, **50** of 51 files in `lib/template-engine/`, **3** files in `components/template-engine/`, **2** sidebar entries, and one link in `components/leads/LeadDetail.tsx`.
- Data to seed: `template_generations` has 48 rows, of which **9** are `status='deployed'` with a non-null `deployed_url`. Those 9 are the live v2 sites. (228 leads have a `website_link`, but most are clients' own domains — the generations table is the authority, not `leads`.)
- v2 permission keys `templates.manage` / `templates.generate` / `templates.deploy` exist in code and in `public.permissions` with real grants.

---

## The one thing this phase must not do

**Do not break a live client site.** Nine real businesses are being served from subdomains right now. This phase touches their *records*, never their files — deployed sites are static files on disk, and nothing here deletes or redeploys them. The seeding migration is additive. Stage 1 deletion removes only LMS code. If any task looks like it would touch a docroot, stop.

---

### Task 1: Migration 0056 — seed v2's live deployments

**Files:** Create `supabase/migrations/0056_seed_v2_deployments.sql`

Carries the 9 live v2 sites into `studio_deployments` so the Site Studio board manages old and new through one table, and takedown/redeploy of pre-v3 sites keeps working forever (spec §11.3).

- [ ] **Step 1: Write the migration** (file only — applied in Task 7, after the acceptance gate)

```sql
-- 0056_seed_v2_deployments.sql — Site Studio Phase 4b: deployments continuity.
--
-- Carries v2's live deployed sites into studio_deployments (spec §11.3) so the
-- Site Studio deployments board manages old and new sites through one surface,
-- and takedown/redeploy of a pre-v3 client site keeps working after the old
-- engine's code is deleted.
--
-- ADDITIVE AND IDEMPOTENT. It inserts records only. It never touches a
-- docroot: deployed client sites are static files and are not at risk here.
-- `on conflict (subdomain) do nothing` means a re-run is a no-op, and a
-- subdomain already claimed by a v3 run is left alone.
--
-- origin='v2_import' marks these rows, and run_id is null because they have no
-- studio run behind them — both are exactly what the board's origin badge and
-- the deploy service's guards already expect.
--
-- The subdomain is derived from deployed_url's leftmost label. Rows whose URL
-- doesn't parse to a single-label host under one domain are SKIPPED rather than
-- guessed at (a wrong subdomain here would let a future deploy overwrite an
-- unrelated live site), and are reported by the verification query in Task 7.

insert into public.studio_deployments
  (lead_id, run_id, subdomain, docroot, url, status, origin, deployed_at, created_at, updated_at)
select
  g.lead_id,
  null,
  -- leftmost label of the host: https://acme.example.com -> acme
  split_part(regexp_replace(g.deployed_url, '^https?://', ''), '.', 1) as subdomain,
  '/domains/' || regexp_replace(regexp_replace(g.deployed_url, '^https?://', ''), '/.*$', '') || '/public_html' as docroot,
  g.deployed_url,
  'live',
  'v2_import',
  coalesce(g.updated_at, g.created_at, now()),
  now(),
  now()
from public.template_generations g
where g.status = 'deployed'
  and g.deployed_url is not null
  -- host must have at least three labels (sub.domain.tld) for the leftmost to
  -- be a real subdomain; anything else is a client's own domain or malformed
  and array_length(
        string_to_array(regexp_replace(regexp_replace(g.deployed_url, '^https?://', ''), '/.*$', ''), '.'),
        1
      ) >= 3
  and split_part(regexp_replace(g.deployed_url, '^https?://', ''), '.', 1) <> ''
on conflict (subdomain) do nothing;
```

- [ ] **Step 2: Commit** — `git add supabase/migrations/0056_seed_v2_deployments.sql && git commit -m "feat(site-studio): migration 0056 - seed v2 live deployments"`

**Do NOT apply it.** Task 7 applies it, after the acceptance gate passes.

*Note the `one_live_per_lead` partial index: if two v2 generations for the SAME lead are both `status='deployed'` with different subdomains, the second insert violates it and the migration fails. Task 7's pre-flight checks for that case explicitly; if it exists, the fix is to seed only the most recent per lead (add a `distinct on (g.lead_id) … order by g.lead_id, g.updated_at desc` wrapper) — do not weaken the index.*

---

### Task 2: The three SOPs

**Files:** Create `docs/sops/site-studio/{01-adding-a-template.md,02-generating-a-website.md,03-troubleshooting.md}`

Spec §12: three checklist-style procedures, stored in-repo, versioned with the code, rendered inside Site Studio. **Write them from what the code actually does** — read the relevant modules rather than describing an idealised flow; a wrong SOP is worse than none.

- [ ] **Step 1: `01-adding-a-template.md`** — sourcing criteria (static-friendly, the page kinds the compiler recognises, licensing), zip upload, then **how to read each compiler diagnostic**: what each blocker means and what to do, which warnings are normal (`identity_name_heuristic`, `stranded_text` on a typical template) versus which mean reject. The certification standard: certify only when the side-by-side render matches and blockers are zero; reject when the template needs JS to render content. Cover re-compile (deterministic against the immutable zip, so it self-heals a torn package) and the fact that **certifying is what makes a template usable for generation**. Source of truth: `lib/site-studio/compiler/*`, `lib/site-studio/ui/status.ts`, `components/site-studio/ReviewDrawer.tsx`.
- [ ] **Step 2: `02-generating-a-website.md`** — launch from a lead (which lead fields matter and why a missing email or map link stops the run at `prepare` with a named reason), what to verify at **Gate 1** (client's trade not the template's, no invented claims, every page's copy read once), image-pick standards (library first; client photos are fenced to that lead; picks are rehosted so a stock URL can't rot), per-slot and per-page re-roll (operator edits survive by default), then **Gate 2** preview editing and deploy. Include the deploy rules an operator must know: one live site per lead, a redeploy goes onto the same subdomain in place, and takedown from the deployments board. Source of truth: `lib/site-studio/run/*`, `components/site-studio/{RunLaunch,RunCockpit,RunPageCard,ImagePicker,RunPreview}.tsx`.
- [ ] **Step 3: `03-troubleshooting.md`** — a failed page write (retry on the card; after 2 attempts the run fails naming the page); a run parked at `reviewing` (that's Gate 1, not a hang — the advancer cron deliberately cannot cross it); pause/resume/cancel; a render refusal listing missing slots; a deploy failure and what state it leaves; asset-library tagging upkeep; and **post-deploy client change requests** — reopen the run's preview, edit, redeploy. Also: what to do when a template needs re-compiling. Source of truth: `lib/site-studio/run/engine.ts`, `lib/site-studio/deploy/deployRun.ts`, the route error messages.
- [ ] **Step 4: Commit** — `docs(site-studio): the three operator SOPs`

Each SOP is a checklist a new operator can follow without reading code. Keep them short enough to actually be read.

---

### Task 3: Render the SOPs in Site Studio

**Files:** Create `lib/site-studio/sops.ts`, `components/site-studio/SopViewer.tsx`, `app/(app)/ai-tools/site-studio/sops/page.tsx`; Modify `components/site-studio/StudioTabs.tsx`; Test `tests/siteStudioSops.test.ts`

- [ ] **Step 1: Write the failing test** for `lib/site-studio/sops.ts`:
  - `SOPS` is an ordered array of `{ slug, title, path }` covering the three documents.
  - `loadSop(slug)` reads the file from disk at request time and returns `{ title, markdown }`; an unknown slug returns null (never throws, never reads outside `docs/sops/site-studio/`).
  - A slug containing `..`, `/`, or a backslash is rejected — this reads from the filesystem by a URL-supplied key, so the traversal guard gets a test even though the route doesn't (same reasoning as `isSafeAssetPath` in 4a).
  - Every declared SOP file **exists on disk** — this is what stops the viewer from shipping a dead link when a file is renamed.
- [ ] **Step 2: Implement** `sops.ts`, then `SopViewer.tsx` (renders the markdown; use the repo's existing markdown rendering if one exists — grep for a renderer before adding anything, and if none exists, a minimal safe renderer for headings/lists/code/links only, escaping everything else — **no `dangerouslySetInnerHTML` on unsanitised input**), the server page (gate on `studio.manage`, mount `StudioTabs`), and an `SOPs` tab.
- [ ] **Step 3: Contextual links** (spec §12 requires them): a small "SOP" link on the Templates board → `01`, on the Runs/cockpit screens → `02`, and on a failed run's error panel → `03`. Keep it to one unobtrusive link per surface.
- [ ] **Step 4:** PASS + `tsc`. Commit: `feat(site-studio): render the SOPs in-app with contextual links`

---

### Task 4: Repoint the leads UI at Site Studio

**Files:** Modify `components/leads/LeadDetail.tsx`

- [ ] **Step 1:** `LeadDetail.tsx:205` links to `/ai-tools/template-engine?lead=${lead.id}` — the old engine, which Stage 1 deletes. Repoint it to the Site Studio runs surface, passing the lead so `RunLaunch` can preselect it (check what `RunLaunch` actually reads from the query string; if it reads nothing yet, add the smallest possible support for `?lead=<id>` preselection rather than shipping a link that lands on an empty picker). Keep the button's existing permission gating, but note it currently gates on `templates.generate` — switch it to `studio.manage` so it matches where it now points.
- [ ] **Step 2:** `tsc` clean. Commit: `feat(site-studio): lead detail launches a studio run`

---

### Task 5: THE ACCEPTANCE GATE — requires the user

**This task is not code. It is a supervised run with the user present, and every task after it is blocked until the user signs off.** Do not proceed to Task 6 without an explicit "accepted" from them.

Spec §14's criteria, to be checked one by one:

- [ ] **Step 1: Gates green** — full test suite, `tsc --noEmit`, and production build all clean. Report the numbers.
- [ ] **Step 2: A real template certified** — the user uploads one of their existing templates through the Templates board; it compiles with **zero unresolved blockers** and they certify it. If it produces blockers, that is a finding to fix, not a gate to wave through. Record the template name and its diagnostics.
- [ ] **Step 3: A real lead, end to end, with the user driving.** Machine time (launch → Gate 1 ready with all pages written and image candidates present, operator review time excluded) must be **under 2 minutes** — measure it and report the actual figure. The user must exercise all five: an edit at Gate 1, an image pick, a per-slot re-roll, an inline preview edit, and a deploy to a real subdomain.
- [ ] **Step 4: Verify the deployed site** in a real browser — pages navigable, images loading, the client's identity correct, and **no demo content from the template anywhere**. Also confirm the Gate 2 preview's click-to-edit works in that browser (the CSP fix from 4a is only provable outside jsdom).
- [ ] **Step 5: Record the outcome.** Write the results into this plan file: template used, lead used, measured machine time, the five exercises, the deployed URL, and anything that went wrong. Then **ask the user explicitly**: accept and proceed to deletion, or fix findings first?

If findings emerge, they become their own tasks and this gate is re-run. That is the expected path, not a failure.

---

### Task 6: Stage 1 deletion — remove the old engine

**Blocked on Task 5's sign-off.** Spec §11.4: remove old routes, nav entries, and `lib/template-engine/*` **except the kept deploy modules**. Deployed client sites are static files and are never at risk.

**Files:** Delete `app/api/template-engine/` (28 routes), `app/(app)/ai-tools/template-engine/` (3 pages), `components/template-engine/` (3 files), and all of `lib/template-engine/` **except `directadmin.ts`** (50 of 51 files). Modify `components/layout/Sidebar.tsx` (remove 2 entries).

- [ ] **Step 1: Verify the boundary before deleting anything.** Re-run the import check: `grep -rn "template-engine" --include=*.ts --include=*.tsx app lib components tests | grep -v "lib/template-engine/directadmin"`. Every remaining hit must be either a comment or something you are about to delete. **If a live file outside the old engine imports a module you're about to remove, stop and report** — that's a dependency the 4a boundary check missed.
- [ ] **Step 2: Delete** the routes, pages, components, and the 50 lib files. Keep `lib/template-engine/directadmin.ts`. Consider moving it to `lib/site-studio/deploy/directadmin.ts` so no `template-engine` directory survives at all — **but only if** the three importers are updated in the same commit and its own tests (if any) come along; if that turns into a sprawl, leave it in place and say so.
- [ ] **Step 3: Remove the two sidebar entries** (`Template Engine`, `Deployed Sites`) — the Site Studio entry and its tabs already cover both. Check no other nav or dashboard surface links to the removed pages.
- [ ] **Step 4: Delete the now-orphaned tests** for removed modules. Do NOT delete `tests/deployLiveManual.test.ts` if it tests `directadmin.ts`; check first.
- [ ] **Step 5: Full gates** — suite, `tsc`, production build. The build is the real proof here: a dangling import fails it. Report the test-count delta (it will drop, and that is expected — say by how much and confirm no `siteStudio*` test was lost).
- [ ] **Step 6:** Commit: `refactor(site-studio): stage 1 deletion - remove the old template engine`

**Explicitly OUT of scope:** dropping the v2 tables (`template_generations` et al.) is **Stage 2**, a later migration after prod confidence (spec §11.4). The data stays. Likewise the `templates.*` permission keys stay for now — they gate nothing once the code is gone, and removing keys with live grants is its own small migration; note it as a follow-up rather than doing it here.

---

### Task 7: Apply the seeding migration, verify, and finish

- [ ] **Step 1: Pre-flight** (read-only, before applying 0056): confirm no lead has two `status='deployed'` generations with different subdomains — `select lead_id, count(*) from template_generations where status='deployed' and deployed_url is not null group by lead_id having count(*) > 1;` — because the `one_live_per_lead` partial index would reject the second. If any exist, apply the `distinct on` variant described in Task 1 rather than weakening the index. Also list the 9 URLs so the derived subdomains can be eyeballed.
- [ ] **Step 2: Apply migration 0056** via the Supabase MCP `apply_migration` (the user has pre-approved migration application for this project).
- [ ] **Step 3: Verify** read-only and report actual rows: the count inserted, every `origin='v2_import'` row's `subdomain`/`url`/`lead_id`, and that each derived subdomain is genuinely the leftmost label of its URL. Report any generation that was **skipped** by the host-shape filter and why.
- [ ] **Step 4: Confirm the board shows them** — the deployments board should list the imported sites with the `v2 import` badge alongside any studio-origin rows.
- [ ] **Step 5: Final gates** and a clean `git status --short`. Then push and open the PR.

**Phase 4b — and the rebuild — is complete when** the SOPs render in-app, v2's live deployments appear on the new board, the acceptance gate is signed off, the old engine is gone, and the app builds and runs clean.

---

## Self-review notes

- **Spec coverage.** §12's three SOPs → Tasks 2–3, including the required contextual links. §11.3 deployments continuity → Tasks 1 and 7. §11.2 acceptance gate → Task 5, with all five operator exercises and the under-2-minute machine-time measurement from §14 called out explicitly. §11.4 Stage 1 deletion → Task 6, with Stage 2 (dropping tables) deliberately deferred and labelled. §13's kept boundary → verified as one self-contained file, re-checked in Task 6 Step 1 before anything is removed.
- **Ordering is load-bearing.** The acceptance gate sits between the build and the deletion because that is the actual dependency: nothing gets deleted until a real client site has been generated and deployed by the new engine with the user watching. Task 6 states its block explicitly so an agent executing this plan cannot run ahead.
- **The seeding migration is the only risky piece**, and it is risky in one specific way: a wrongly-derived subdomain would let a future deploy overwrite an unrelated live site. Hence rows are skipped rather than guessed, `on conflict do nothing`, and Task 7 verifies every derived value against its URL by hand before the phase closes.
- **Names/paths used consistently:** `docs/sops/site-studio/{01,02,03}-*.md` referenced identically in Tasks 2, 3 and the viewer; `origin='v2_import'` matches the CHECK already applied in migration 0054; the kept file path `lib/template-engine/directadmin.ts` matches the three importers named in the starting facts.
