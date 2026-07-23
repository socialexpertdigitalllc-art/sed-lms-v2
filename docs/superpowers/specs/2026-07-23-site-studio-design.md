# Site Studio — Template Engine v3 Design

**Date:** 2026-07-23
**Status:** Approved concept-by-concept by the user (10 concepts, all approved)
**Replaces:** the entire Template Engine v2 (template library + health, generation pipeline, queue/processor, operator wizard). The DirectAdmin deployment layer is **kept**.

## 1. Why a rebuild

The user condemned Template Engine v2 on all four axes:

- **Output quality** — demo-identity leaks, structure damage, ill-fitting text/images despite an ever-growing gate/scrubber apparatus.
- **Speed** — ~8 min per healthy 5-page run; image gathering historically far worse.
- **Reliability & control** — orphaned runs, wedged queue rows, heartbeat/force-resolve machinery, a globally single-flight processor that made local testing fight production.
- **Complexity** — 52 modules of patch-on-patch; every fix risked the next regression.

Root cause, common to all four: **templates were arbitrary, unknown HTML zips, and the engine bent them into client sites at generation time** using AI + gates + scrubbers + repair loops. V3 removes that root.

## 2. Architecture decision: compile once, render forever

Chosen over (B) perfected runtime personalization (keeps demo identity in templates, keeps scrub/gate machinery, re-pays extraction each run, fan-out stays hard) and (C) templates-as-code (every purchased template would need developer porting — breaks the business model).

**The split:** all template intelligence happens **once, at upload** (the compiler, human-certified). Generation-time work is: AI writes structured *content* (plain strings), a pure renderer stamps it into the compiled package in milliseconds. No AI ever touches markup. Demo identity is physically absent from stored packages, so leaks are impossible by construction, not gated after the fact.

**Requirements locked during brainstorming:**

- Full template standard imposed at upload (the "SOP" in the technical sense).
- Operator control: review gates between stages, direct final-site editing, granular re-roll, full manual override.
- Speed: **under 2 minutes** from launch to review-ready.
- Fan-out (individual service/area pages) from day one.
- Build alongside the old engine; delete it after acceptance. Only templates carry over (re-imported through the new compiler). Old generation history is discarded; deployed sites are static files and unaffected.
- One-page template management board; written SOPs rendered in-app.

## 3. Concept 1 — The Template Package standard

A certified template is a **package**, not a zip of unknown HTML:

```
templates/{id}/
  source.zip          ← original upload, immutable (re-compile anytime)
  package/
    manifest.json     ← the contract: pages, slots, theme, nav, samples
    pages/*.html      ← compiled skeletons: markup + {{tokens}}, zero demo content
    fragments/*.html  ← repeatable blocks (service card, area link, nav item)
    assets/           ← css/js/fonts/images carried over
    previews/         ← per-page thumbnails for the board and pickers
```

Rules:

- **Compiled pages contain no demo identity and no demo copy** — only markup and `{{slot}}` tokens. All demo text lives in the manifest as *sample data* (used for previews and as tone/length guides for the Writer). Samples can never reach a client site: the renderer renders only from a client's Content Document.
- **Render refuses on missing content** and names the missing slots — completeness failures surface at the content stage, never on a live site.
- Manifest declares per page: **kind** (`home | services_hub | service | area | about | contact | gallery | reviews | generic`), **stampable** flag (service/area page kinds are stamped once per service/area — the fan-out mechanism), **slots** (text with max-length derived from the sample; image with aspect ratio + subject hint + paired alt-text slot; link), and **repeat regions** (fragment reference + min/max counts + inner slots).
- **Navigation is a declared repeat region** (header/footer/mobile navs) rendered from the list of actually-built pages — structurally eliminates nav-pruning and internal-404 bug classes.
- **Theme** = named color roles (`brand`, `brand_deep`, `accent`, …) mapped at compile time to the template's real CSS custom properties, or injected if it has none. Recoloring is a variable assignment.
- **Identity tokens** are a standard set: `{{business_name}}, {{phone}}, {{phone_href}}, {{email}}, {{address}}, {{city}}, {{logo}}, {{map_embed}}, {{profile_link}}, {{domain}}, {{year}}`, socials.
- **JS-rendered content is resolved once at compile time** — baked static or flagged for review. Never a per-run gamble.
- Packages are **versioned**: re-compile or edit bumps the version; every run records the version it used.

## 4. Concept 2 — Compiler & certification

Template lifecycle: `uploaded → compiling → needs_review → certified` (or `rejected`); plus `disabled` (certified but withheld from new runs). **Only certified templates can generate.**

Seven compiler passes — deterministic wherever possible, AI only for judgment:

1. **Inventory** — unzip, real HTML parsing (parser library, never regex), classify pages vs assets, map internal links.
2. **Identity hunt** — deterministic patterns (phones, emails, addresses, map URLs) + AI pass for names/places. Every finding becomes a token. The demo-leak problem lives here, once per template, human-reviewed.
3. **Slot extraction** — visible text nodes → text slots (demo text saved as sample; max-length derived); images → image slots (aspect from file/attrs); structurally repeated siblings → repeat regions. AI labels slots semantically (headline/body/CTA) and classifies page kinds.
4. **Nav & structure** — nav regions detected across pages, declared as nav repeats; internal links mapped to page ids.
5. **Theme mapping** — CSS custom properties ranked by `var()` usage → roles; templates without variables get a dominant-color remap plan (neutral colors excluded).
6. **JS resolution** — JS-rendered nav/content baked static (compile-time snapshot) or flagged.
7. **Verification render** — package rendered with its own sample data, diffed against the original demo site (DOM-structure equality plus text equality after sample substitution, whitespace-normalized; asset bytes unchanged). **Cannot reproduce the original → cannot certify.** This is the health system: self-proving, not heuristic.

**Review UI** (in the board's review drawer): side-by-side original vs compiled preview per page, checklist of flagged items (unresolved JS, ambiguous slots, suspected missed identity, low-confidence repeats), light inline tools (mark/unmark slot, fix token assignment, set image subject hints, adjust repeat bounds). **Certify** records who/when/version.

Severity model: **blockers** (render-back mismatch, unresolved identity, unparseable page) hard-block certification; everything else is review guidance. There is **no per-run health check** — certified means renderable, proven by pass 7.

Compile AI usage goes through the existing provider registry as a new task type (`template_compile`); it is a one-time cost per template.

## 5. Concept 3 — The Template Board

New module namespace: **Site Studio** (clean break; old routes untouched during coexistence; final deletion greppable). The **Templates board is one page** where a template's whole life happens:

- Dense searchable grid; filters on name/niche/status; sort by recent/usage/name.
- Card: home thumbnail, inline-rename name, niche tags, status chip (`compiling · needs review · certified vN · disabled`), page-kind icons (incl. stampable service/area), flagged-items count, usage stats (runs, last used).
- **Upload = drop zone on the board**; compile progress live on the new card.
- Clicking a card opens the **review drawer** over the board (Concept 2 UI).
- Card actions: certify, disable/enable, re-compile, rename, download source, delete — delete blocked while any live run uses the template; completed runs unlink (same rule as v2's proven behavior).

## 6. Concept 4 — Content Document & the Writer

One schema-validated JSON document per run; everything downstream operates on it.

- **Identity** — business name, phone, email, address, city, services, areas, logo, map, profile link, socials. **Copied verbatim from the lead, never AI-written.** The renderer pours identity into tokens directly.
- **Theme** — color roles → hex from the lead's validated color scheme; non-hex/absent → template's own colors kept.
- **Pages** — per built page (incl. each stamped service/area page): slot content (text strings, image references, repeat arrays), SEO title + description.
- **Provenance** — per field: `written_by: ai | operator`, model, edited-at. UI shows AI vs overridden; re-roll touches only AI-written fields by default; every edited field keeps its previous value for one-click "revert to AI".

**The Writer** is the only generation-time AI:

- Input: lead dossier + template manifest (slots, semantic labels, samples as tone/length guides, hard max-lengths).
- Output: the pages section, **one AI call per page, all pages in parallel**. Schema + constraint validation per page; bounded per-page retry on failure.
- Plain strings, no markup → small models qualify; plugs into the provider registry as task type `content_write`.
- Hard rules: write for the **client's trade** even when the sample's trade differs; **never invent facts** (years in business, certifications, prices appear only if present in lead data).

## 7. Concept 5 — Generation run & control cockpit

**Launch:** lead-driven (searchable picker + dossier, as proven in v2) or manual brief. Operator confirms: certified template, pages (auto-derived from the lead, editable), fan-out toggles with stamped-page counts. One active run per lead.

**Stages:** `prepare` (deterministic, instant) → `write` ∥ `images` (parallel; image sourcing doesn't wait for text) → **Gate 1: consolidated review** (content + image picks, per page) → `render` (instant) → **Gate 2: editable preview** → deploy handoff.

**Cockpit:** one live page. Page cards fill in as the Writer finishes them and are immediately editable — review begins while other pages still write. "Approve & render" closes Gate 1. **Auto mode** skips Gate 1 (everything remains editable at the preview). Two real gates, zero dead waiting — how "review between stages" and "<2 min" coexist.

**Execution model (the reliability cure):** a run is a chain of **short idempotent steps** (one page-write = one step, ≤ ~30s), each persisting results before the next. No long-lived process exists, so no orphan class exists. The operator's browser drives steps while open; a lightweight **advancer cron** (secret-protected route, same pattern as the mail poller) finishes abandoned runs. A step that dies is simply re-run. The advancer only advances machine steps — it never crosses a review gate; a run abandoned at a gate simply waits there. **Stop/Pause/Resume are flags** checked between steps. A failed page-write shows on its page card with the error and a retry button; a run can never wedge invisibly. No global single-flight lock — local testing and prod runs no longer compete.

**Granular re-roll:** one slot, one page, or the whole site; AI-written fields only unless explicitly confirmed.

## 8. Concept 6 — Images

Library-first, human-curated, **no vision AI in the critical path**:

- **Asset Library** (persistent, tagged: niche, subject, aspect, source, Pexels id): every operator-approved image feeds it. Sourcing checks the library first — instant, free, pre-approved.
- **Pexels top-up in parallel** for thin slots: one deterministic query per slot (subject hint × client trade), filtered by cheap checks only (dimensions, aspect, dedupe). Candidates reach Gate 1 in seconds; the operator picks.
- Every pick feeds the library — the flywheel makes the engine faster and better each run.
- **Client-supplied photos** drop directly onto a slot at the gate; stored marked client-owned, never offered to other clients. Stock is shared.
- Alt text = a paired text slot filled by the Writer.
- Library management surface in Site Studio: searchable grid, tags, manual upload, delete.
- Optional async "AI rank" assist may come later; never a blocker.

## 9. Concept 7 — Editable preview & deploy handoff

- Real site in an in-app preview; all pages navigable; mobile/desktop width toggle.
- **Edit mode:** renderer emits an annotated build (slot ids on elements). Click text → inline edit; click image → picker/upload; theme colors adjustable live. **Every edit writes to the Content Document and re-renders instantly** — markup corruption from the preview is impossible by construction. Per-field revert-to-AI. Re-roll available per slot/page.
- **Deploy is a handoff:** the renderer produces the same file map the kept DirectAdmin layer consumes — stable per-lead subdomain with in-place redeploy, custom-domain transfer, or zip download. Annotation attributes stripped from production builds. Deployed URL recorded on run + lead; the existing deployments board continues to work.

## 10. Concept 8 — Data model, storage, reliability, testing

All new schema under a **`studio_` prefix**; zero shared tables with v2.

- **`studio_templates`** — status, version, niche tags, manifest JSON, compiler diagnostics, certification (who/when), storage paths.
- **`studio_assets`** — kind (stock/client), niche + subject tags, aspect, dimensions, source, Pexels id (unique, nullable), client lead linkage for client-owned, storage path, use count.
- **`studio_runs`** — lead, template id + version, stage, options (auto mode, page selection, fan-out), **Content Document as a JSON column** (single source of truth; one update per step), per-page step states with errors, deployed URL.
- **`studio_run_events`** — append-only audit log (step lifecycle, gate decisions, deploys) powering the cockpit timeline and post-mortems.
- **`studio_deployments`** — one row per deployed site (lead, subdomain, docroot, URL, status), written by new runs and seeded from v2's live deployments at cutover (see §11).
- Buckets: `studio-templates` (source + package), `studio-assets`, `studio-runs` (rendered builds).
- Step claims via optimistic check on the run row; steps are idempotent so double-execution (browser + cron racing) is harmless. One active run per lead via partial unique index.
- Permissions: new `studio` keys in the existing LMS permission system; admin-only during coexistence.

**Testing posture (how "no bugs" is enforced):**

- Renderer is a **pure function** → golden-file tests against fixture templates.
- Each compiler pass unit-tested on fixture zips.
- **Property test in CI:** for every fixture, `render(compile(zip), samples) ≈ original demo site`. The core guarantee is proven, not hoped.
- Writer mocked in tests; schema/constraint validation tested directly.
- One full no-AI manual-mode run as the end-to-end integration test.
- Lesson carried from v2: fixtures must include templates that look nothing like each other (the "hardcoded to the original template" bug class).

## 11. Concept 9 — Cutover & deletion

1. **During build:** old engine fully operational and untouched; Site Studio behind admin-only permission.
2. **Acceptance gate:** existing templates re-imported + certified; one real lead end-to-end (write → review → render → edit → deploy to a real subdomain); <2 min confirmed on that run; explicit user sign-off.
3. **Deployments continuity:** migrate live deployment records (lead, subdomain, docroot, URL) into **`studio_deployments`**, written by new runs too — the kept deployments board manages old + new sites through one table; takedown/redeploy of old sites keeps working forever.
4. **Two-stage deletion:** Stage 1 (cutover commit): remove old routes, nav entries, and `lib/template-engine/*` except kept deploy modules. Stage 2 (later migration, after prod confidence): drop old tables. Deployed client sites are static files — never at risk.

## 12. Concept 10 — SOPs

Three checklist-style procedures, stored in-repo, **rendered inside Site Studio** with contextual links from each screen:

1. **Adding a template** — sourcing criteria (static-friendly, page kinds, licensing), upload, reviewing each compiler flag, certification standard (certify vs reject).
2. **Generating a website** — launch from lead, what to verify at Gate 1, image-pick standards, preview-edit standards, deploy + post-deploy checks.
3. **Troubleshooting & maintenance** — failed page-writes, when/how to re-compile, asset-library tagging upkeep, post-deploy client change requests (reopen the run's preview → edit → redeploy).

Living documents: SOP edits are normal commits, versioned with the code.

## 13. Kept systems & boundaries

- **Kept:** DirectAdmin deploy layer (`directadmin.ts`, deploy/takedown routes, deployments board), AI provider registry (`lib/ai-tools/providers/*` — gains `template_compile` and `content_write` task types), leads system (source of dossiers), LMS permission system.
- **Out of scope for v3.0:** AI vision ranking (optional later assist), multi-language output, template marketplace/import automation beyond zip upload.
- **Shared-prod caution during build:** v2 keeps running on the shared DB; v3 tables/buckets are new, so no contention — but live E2E tests still respect prod quiet hours for AI quota.

## 14. Acceptance criteria (summary)

- All fixture property tests green in CI; full test suite + typecheck + prod build green.
- Existing templates certified through the compiler with zero unresolved blockers.
- One real lead generated end-to-end and deployed to a real subdomain, with **machine time under 2 minutes** (launch → Gate-1-ready with all pages written and image candidates present; operator review time excluded), and the operator exercising: an edit at Gate 1, an image pick, a per-slot re-roll, an inline preview edit, and a deploy.
- Old code deleted (stage 1) with no references remaining outside kept modules; app builds and runs clean.
