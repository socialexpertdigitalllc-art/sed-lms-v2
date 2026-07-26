# Site Studio Phase 4c — Lead-Data Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a generated site actually reflect everything the lead record holds — the client's photos in the gallery, their colours visibly applied, their logo in the header, their Google profile embedded — rather than only the subset the engine currently wires up.

**Architecture:** No new subsystems. Two of these are wiring gaps (lead photos never reach the gallery; image curation is unreachable in the flow operators actually use), one is a fidelity limit in an existing pass (theme only rewrites `:root`), and two need a small addition to the token grammar so a template can express "brand block" and "profile embed". The Content Document stays the single source of truth throughout.

**Tech Stack:** Existing — compiler passes, renderer, `deriveTheme`, `rehostFromUrl`, `ImagePicker`.

**Origin:** every item below came out of the Phase 4b acceptance gate, from two real runs (`Knights Auto Window Tint`, `Drywall Guy Houston LLC`) against a real commercial template. Measured facts, not speculation:
- Both runs launched with `options.auto: true` → Gate 1 skipped → **45 sourced image slots never shown to anyone**, site built on template defaults.
- `color_scheme: "#0C5AA0 ,#F24F24"` derived correctly to `brand: #0c5aa0`, `brand_deep: #f24f24` — but the site barely changed, because the template writes most colours as literals in inline `style` attributes and `render/theme.ts` only rewrites the `:root` block.
- `image_links` (1 photo) reached the run as `client_photos` and was offered in a picker nobody opened. Never placed.
- Page selection **already works** (`options.page_ids` = the lead's `specify_pages`, `doc_pages: 6`). `num_webpages` is unused and superseded by the page list — no change needed.

**Operator decision (locked, do not re-litigate):** when a lead has BOTH `map_embed_link` and `business_profile_link`, the **map iframe keeps using `map_embed_link`** (it is the purpose-built embed) and the Google profile embeds **separately** — as its own block where the template has room, or a linked button where it doesn't.

**Hard rules:** never import from `lib/template-engine/` except the sanctioned DirectAdmin modules; targeted vitest; `NODE_OPTIONS=--max-old-space-size=6144` for tsc/build; `tests/siteStudioProductionRenderGolden.test.ts` pins production render bytes — **if a change moves a hash, stop and report rather than updating it**; commit per task; do not push.

---

## Split

**Part 1 (Tasks 1–4) unblocks the acceptance run** — the operator can curate images and the client's colours actually show. Do this first; it needs no template changes.

**Part 2 (Tasks 5–7) pairs with the template handover** — the brand block and profile embed require a template that expresses them, and the operator is handing one over to be adjusted. Do these with that template in hand.

---

### Task 1: Auto mode must state what it skips

**Files:** Modify `components/site-studio/RunLaunch.tsx`; Test `tests/siteStudioCockpit.test.tsx`

The checkbox is labelled "Skip content review" and defaults to `false` (correct). But it also skips **image curation**, and nothing says so — an operator reasonably reads "content" as "text" and loses the image step without knowing.

- [ ] **Step 1:** Relabel to name both consequences, e.g. **"Skip review — generate and render without stopping for content or image review"**, with a one-line hint underneath: *"Everything stays editable in the preview afterwards, but no image picks are made — the template's own images ship unless you change them."*
- [ ] **Step 2:** Add a test asserting the label mentions images.
- [ ] **Step 3:** Commit — `fix(site-studio): auto mode says it skips image review too`

---

### Task 2: The lead's own photos go into the gallery automatically

**Files:** Modify `lib/site-studio/run/engine.ts` (prepare), `lib/site-studio/run/seed.ts`; Test `tests/siteStudioSeed.test.ts`, `tests/siteStudioGateEngine.test.ts`

A lead's `image_links` already reach the run as `client_photos`. They are offered first in the picker — and in auto mode, never used at all. The operator's requirement: **client photos belong in the gallery without anyone clicking.**

- [ ] **Step 1: Write the failing tests** for this contract:
  - During `prepare`, after seeding, image slots on pages whose manifest `kind` is `gallery` are filled from `client_photos` **in order**, one photo per slot, until either runs out.
  - Each placed photo is **rehosted first** (via `rehostFromUrl`, `kind:'client'`, the run's `lead_id`, `source:'client_link'`) and the slot gets `asset:{id}` — never the raw external URL, so a rotting link can't break a live site. This is the same rule picks already follow.
  - A photo that fails to rehost is skipped, logged as a `studio_run_events` warn naming the URL, and does **not** fail the run.
  - Slots beyond the supplied photos keep the template's sample image (unchanged behaviour).
  - When the template has no gallery-kind page, photos are left for the picker and a warn event records that they were not placed.
  - Provenance for a placed slot is `operator` (a human supplied the photo), so a re-roll can't overwrite it.
- [ ] **Step 2: Implement** in the prepare step, after `seedContentDoc` and before the identity gate. **Step 3:** PASS. Commit — `feat(site-studio): the lead's own photos fill the gallery at prepare`

---

### Task 3: Repeat-row images are pickable at Gate 2

**Files:** Modify `components/site-studio/{RunPreview,ImagePicker}.tsx`, `app/api/site-studio/runs/[id]/images/route.ts`; Test `tests/siteStudioPreviewUi.test.tsx`, `tests/siteStudioGate2Routes.test.ts`

Gallery and card images typically sit inside repeat regions. `RunPreview` currently toasts "not supported" for a repeat-row image click, and the images route only accepts flat `"<pageIndex>:<slotId>"` keys — so the images an operator most wants to change are the ones they cannot.

- [ ] **Step 1: Write the failing tests:** the images route accepts a repeat-row key (`"<pageIndex>:<repeatId>#<rowIndex>:<slotId>"`, the format already used by the annotated build and `PATCH /content`), validates that the named slot is a declared **image** slot on that repeat def, and writes `asset:{id}` into `content_doc.pages[i].repeats[repeatId][row][slotId]`. Reject an out-of-range row and a non-image slot with 422. Keep every existing guard (candidate/fence validation, the client-photo membership check, `isEditable`, CAS, `refreshFinalizedZip`).
- [ ] **Step 2: Implement**, then wire `RunPreview` to open `ImagePicker` for repeat-row image clicks instead of toasting, and `ImagePicker` to carry the repeat key through unchanged. **Step 3:** PASS. Commit — `feat(site-studio): pick images for repeat rows from the gate 2 preview`

---

### Task 4: Theme retints literal colours, not just `:root`

**Files:** Modify `lib/site-studio/render/theme.ts`, `lib/site-studio/compiler/theme.ts`; Test `tests/siteStudioRenderTheme.test.ts`, `tests/siteStudioThemeCompiler.test.ts`

`applyTheme` in `css_vars` mode emits a `studio-theme.css` overriding the mapped variables — correct, and enough for a template that references `var(--brand)` everywhere. Real templates don't: they write `color:#0C5AA0` inline and in rules that never touch a variable, so the client's palette barely shows.

- [ ] **Step 1: Write the failing tests:**
  - In `css_vars` mode, a literal occurrence of a mapped role's **own demo hex** (in a stylesheet, in an inline `style` attribute, in a tokenized asset) is replaced with the doc's hex for that role — this is exactly what `literal_remap` mode already does, applied *in addition to* the variable override rather than instead of it.
  - Matching is case-insensitive and covers the 3-digit shorthand of the same colour (`#fff` where the role hex is `#ffffff`), but **never** partial matches inside a longer token.
  - A colour the template uses that is NOT a mapped role hex is left alone — we retint the brand palette, not every colour on the page.
  - The round-trip property still holds: rendering from samples reproduces the original (samples carry the demo hexes, so remapping is identity).
  - Production render bytes for both fixtures are unchanged (assert the golden test still passes).
- [ ] **Step 2:** Add a compiler diagnostic: when a template is `css_vars` mode but a mapped role's hex also appears as a literal more than a handful of times outside `:root`, emit a **warn** (`theme_literal_colors`) saying theme control will be partial until those literals use `var()`. This is what tells an operator at review time that a template will not fully retint.
- [ ] **Step 3:** PASS + golden unchanged. Commit — `feat(site-studio): retint literal brand colours, not just css variables`

---

## Part 2 — with the handed-over template

### Task 5: A brand block — logo where the template shows the business name

**Files:** Modify `lib/site-studio/tokens.ts`, `lib/site-studio/schema.ts`, `lib/site-studio/compiler/identity.ts`, `lib/site-studio/render/renderer.ts`; Tests across those

Requirement: *"Logo link — use this link in the header and footer instead of business name, and if it's empty just add the business name there."* Today `logo` and `business_name` are separate identity values and a header renders `{{id:business_name}}` as **text**. Nothing can swap an `<img>` in for text, so a lead's logo can never appear.

- [ ] **Step 1:** Add a `{{brand}}` token kind (grammar, `findTokens`, schema). The compiler's identity pass marks the site's brand element — the header/footer link or element whose content is the demo business name, or the demo logo `<img>` — with `{{brand}}`. The renderer emits `<img src="<logo>" alt="<business_name>">` when the doc's identity has a non-empty `logo`, and the escaped business name as text otherwise.
- [ ] **Step 2:** The round-trip must still hold: with samples (whose `logo` is the template's own demo logo, or absent), rendering reproduces the original markup exactly. This is the constraint that decides the exact emitted shape — derive it from what the handed-over template actually contains, and state in your report what shape you had to emit and why.
- [ ] **Step 3:** Add the authoring rule to `docs/sops/site-studio/04-authoring-a-template.md`. Commit — `feat(site-studio): brand block renders the client's logo or their name`

### Task 6: The Google profile embeds separately from the map

**Files:** Modify `lib/site-studio/run/dossier.ts`, `lib/site-studio/compiler/identity.ts`, `lib/site-studio/render/renderer.ts`; Tests across those

- [ ] **Step 1:** Derive `profile_embed` on the Dossier when `business_profile_link` is a Google URL (a Maps place, `g.page`, or a business profile), producing an embeddable `src`. Leave `map_embed` sourced from `map_embed_link` — **the locked decision: the map iframe keeps using `map_embed_link`.** When there is no profile link, `profile_embed` is absent and any element bound to it renders empty.
- [ ] **Step 2:** The compiler tokenizes a second Google iframe (one that is not the map embed) as `{{id:profile_embed}}`, and a link pointing at the demo business's Google profile as `{{id:profile_link}}` (already handled — verify). Add the authoring rule to SOP 04: a template may include one map iframe and one profile iframe, and they are distinguished by which demo URL they point at.
- [ ] **Step 3:** Commit — `feat(site-studio): embed the client's google profile alongside the map`

### Task 7: Adjust the handed-over template + acceptance re-run

- [ ] **Step 1:** Take the operator's template through SOP 04 rule by rule; fix what fails (nav as a real list, one block element per string, attribute-uniform card runs, `alt` on every image, `var()` instead of literal colours, no identity or DOM-writing in JS). Report every change made and why.
- [ ] **Step 2:** Compile it: **zero blockers**, and note the warn count before/after.
- [ ] **Step 3:** Hand back to the operator for the Phase 4b Task 5 acceptance gate, with the measured machine time.

---

## Self-review notes

- **Not in scope, deliberately:** page selection (verified already working — `options.page_ids` carries the lead's `specify_pages`); `num_webpages` (superseded by the page list); the JS-built nav from Phase 4b (a runtime-generated nav still cannot be tokenized, and that remains a warn).
- **The riskiest task is 4**, because it touches the render path that the golden hashes pin. The samples carry the demo hexes, so literal remapping is an identity transform during verification — that is *why* the round-trip stays green, and it is worth asserting explicitly rather than assuming.
- **Task 5 changes the token grammar**, which means every already-compiled package predates it. Existing templates keep working (no `{{brand}}` token means no brand block); to gain a logo they must be re-compiled. Say so in the report.
- Names used consistently: `client_photos` → gallery placement (Task 2), `"<pageIndex>:<repeatId>#<rowIndex>:<slotId>"` repeat key (Task 3, matching the annotated build and `PATCH /content`), `theme_literal_colors` diagnostic (Task 4), `{{brand}}` token (Task 5), `profile_embed` identity key (Task 6).
