# Service / Area Individual-Page Fan-Out — Design + Plan

**Goal:** Generate one individual page per service (from the template's `service_detail` sample) and one per service area (from the `area_detail` sample), linked from the hub pages.

**STATUS (2026-07-18): IMPLEMENTED on branch `service-area-fanout` (commits + planFanout foundation), static gates green (tsc, 631 tests, prod build). NOT merged — awaiting a live E2E when the shared prod DB is idle (the hub card multiplication is AI-driven and unproven at runtime).**

**Final design (revised from the user's 2026-07-18 clarification "no manual page selection; generate all required pages from the lead"):** fan-out is **fully automatic from lead details — NO operator toggles.** When the lead's resolved pages include the Services hub → one page per service; include the Areas hub AND the lead has areas → one page per area. Build ALL of them, no cap.

**Nav finding:** the template's nav/header/footer are **web components** (`<app-header>` rendered by components.js) — there are no literal page links in the HTML nav. So individual pages are linked from the **hub pages** (the standard local-SEO pattern), NOT injected into the shared JS nav. The hub's `<article data-card onclick="location.href='…'">` grid is the link surface.

**What shipped:**
- `lib/template-engine/fanout.ts::planFanout` (pure, TDD) — the fanned page list + slugs + which hubs expanded.
- runnerV2: expands the build set with fanned pages (sourced from the sample), regenerates each focused on its one service/area (leading its own service image), and passes each hub a `hubExpand` (one card per item → its page).
- regenerate: `pageFocus` + `hubExpand` prompt instructions.
- gates: `structureExempt` skips the hub tag-count check (variable cards) while still leak-scanning.

**Remaining before merge/deploy:**
1. **Live E2E when prod idle** — a lead with services + areas (e.g. DRL Construction, 18 svc + 14 areas) whose specify_pages include "Services" + "Service Areas". Confirm: N service pages + N area pages built; each hub shows one card per item linking to the right file; detail pages are focused + de-leaked (no Cherry Creek/Denver/kitchen); build completes; runtime acceptable.
2. If the AI hub multiplication is unreliable, fall back to **deterministic card duplication** (clone the `<article data-card>` node N times) — the markers are clean (`data-card`, `data-layer`). Kept as a fallback, not built yet.
3. Runtime: 18+14 ≈ 35 pages will be slow (~40-60 min) — the standing chunking/parallelism concern becomes urgent for big leads.

---

## (Original design notes below — superseded where they mention toggles/caps)

**Superseded user decision (2026-07-17):** build ALL, but "only when selected" — reinterpreted 2026-07-18 as "only when the lead's pages include that hub", i.e. automatic, no UI toggle.

---

## What we have

- Template "First template" (`c2d638ea-…`) manifest kinds include exactly one sample each:
  - `service_detail` → `service-kitchen.html`
  - `area_detail` → `area-cherry-creek.html`
  - plus hubs `services_hub` (services.html) and `areas_hub` (service-areas.html).
- `resolveLeadPages` (shipped) maps the lead's sales page-names → hub/standard files by kind; it deliberately excludes detail kinds.
- The build pipeline (`selectContentFiles` in pageSelect.ts + runnerV2) builds a fixed set of manifest pages 1:1 and drops area pages when the lead has no areas.
- Regeneration is a strict COPY-EDIT: "reproduce every tag, same count, same order." It cannot add or remove elements.

## The hard problem

Fan-out needs a **variable** number of pages AND a variable number of **links** to them:
1. **Hub pages** — services.html must list N service cards (one per service, linking to `service-<slug>.html`); service-areas.html must list N area cards. The sample hub has a fixed number of demo cards. Producing N cards is a *repeat-this-card-template-N-times* operation, which the "exact markup" regen contract forbids.
2. **Nav / footer** — typically service/area pages are linked from the hub, NOT the top nav (keeps nav stable). Confirm the template's hub markup has a repeatable card unit. If the nav DOES list services, it needs injection too.
3. **Per-page focus** — each `service-<slug>.html` must center on ONE service; the regen prompt needs a `pageFocus` telling it which service/area this page is about.
4. **Per-page image** — each service page wants that service's photo. Curating N service images is heavy; default to auto-pick the top vision candidate per service (gather per-service in the plan phase, no operator curation for the long tail), while the hero + representative services stay operator-curated.
5. **Slugging + cross-links** — `service-<slug>.html` from service name (reuse `businessSlug`, dedupe on collision). Every generated page's nav/footer/breadcrumb links must resolve.
6. **Leak gate** — each area page carries the sample's demo geography ("Cherry Creek", "Denver") to de-leak; the existing gate + demo tokens already cover this per-file, so fanned pages get the same protection. Verify tokens include the sample area's geography.

## Proposed approach (staged)

### Task A — Opt-in plumbing
- SetupPanel: two checkboxes, shown only when the template manifest has a `service_detail` / `area_detail` page. Default OFF.
- generate route + `generateInputSchema`: add `options.individual_service_pages: boolean`, `options.individual_area_pages: boolean` (default false). Persist on the generation.
- No migration (options is jsonb).

### Task B — Fan-out planning (pure, TDD)
- New `lib/template-engine/fanout.ts`: given the sample detail file, the list of services/areas, and the options, produce the list of `{ file, sampleFile, kind, focus }` to build — e.g. `{ file: "service-kitchen-remodeling.html", sampleFile: "service-kitchen.html", kind: "service_detail", focus: { service_key } }`. Dedupe slugs. Pure; unit-tested with the real service/area lists.
- Extend `selectContentFiles` (or wrap it) so the build set includes the fanned files. The sample detail file itself is built once too (or replaced by the first fanned page).

### Task C — Runner build loop
- runnerV2: for each fanned file, regenerate from its `sampleFile` source with a `pageFocus` passed into `regenPrompt` ("This is the detail page for the service '<name>' / area '<city>'. Center all copy on it; link siblings in nav/related."). Content model already carries all services/areas.
- Images: resolve the fanned page's hero from that service's image slot when curated, else auto-pick the top candidate gathered for it (extend the plan-phase image gather to cover every service/area when the toggle is on, OR gather lazily in build).

### Task D — Hub pages + nav (the crux)
- Detect the repeatable card unit in the hub's markup (the sample's first service/area card). Deterministically (NOT via the copy-edit AI) duplicate that unit N times, one per service/area, with the right link + name, THEN run the copy-edit regen on the result — OR give the regen an explicit "emit one card per item in services[]/areas[], using the existing card as the pattern" instruction and relax the tag-count structure gate for the hub files only.
- Decide: deterministic card duplication (safer, structure-preserving, but template-specific parsing) vs. AI card multiplication (general, but needs a relaxed gate for hubs). Recommend deterministic duplication of the identified card node via a small HTML transform, then regen for copy.
- Nav: if the template nav lists individual services, inject there too; otherwise leave nav to the hubs.

### Task E — Verification
- Structure gate: exempt the fanned/hub pages from strict tag-count equality (they intentionally differ), but keep leak + identifier checks.
- Live E2E (when prod idle): a lead with services + areas (e.g. DRL Construction, 18 svc + 14 areas) with both toggles on → confirm N service + N area pages, hub links resolve, no demo leaks, build completes.

## Risks / open questions
- Runtime: DRL (18+14) ≈ 35 pages × ~90-190s = 40-60 min per build — exceeds a serverless request. The pipeline already runs via the background processor (not a single request), but this makes chunking/parallelism (already a standing concern) urgent. Consider raising regen concurrency for fanned pages or a progress-resumable build.
- Nav bloat if services go in the top nav — prefer hub-only linking.
- Operator image curation for many services — default to auto-pick for the long tail.
