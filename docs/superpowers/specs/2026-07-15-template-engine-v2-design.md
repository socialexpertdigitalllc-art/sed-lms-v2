# Template Engine v2 — Plan → Curate → Build → Verify → Review

**Date:** 2026-07-15 · **Status:** approved design (pending spec review) · **Supersedes:** the v1 edit-ops engine (`lib/template-engine/*`, migration 0026).

The generated website is the product being sold. v2 is designed so that "shipped an unchanged/wrong template" is **impossible by construction**, and so the operator controls the two things that decide quality: **copy** and **images**.

---

## 1. Why v1 fails (evidence, not theory)

Verified by diffing a real v1 run (`warrior-contracting-services-w4v8vv.zip`) against its source template (`1st template final`) and against a known-good target (`insideout-painting.zip`):

- v1's `index.html` had **0 changed lines** vs the template. `script.js` + `components.js` were **hash-identical**. The shipped site was the template's demo business ("Northpoint Remodeling", Denver, Cherry Creek) — status still `ready_for_review`.
- **Root causes:**
  1. **Edit-ops primitive.** The model must emit `{find:"<verbatim substring>", replace}`. If it paraphrases `find`, ops are dropped (`editOps.ts:73-93`). If output hits the **6000-token cap**, JSON truncates → `parseOps` salvages to `[]` → `applyOps(source, [])` returns the source **unchanged**, step marked `done` (`runner.ts:475-507`). Silent total no-op.
  2. **`script.js` is never processed.** Only manifest `pages` + `components.js` are edited; every other `.js` sits in `manifest.js[]` which the runner never reads (`runner.ts:573-577`). The template's testimonials/service data/`NorthpointApp` identity live in `script.js` → guaranteed leak.
  3. **Starved input.** Only 6 lead fields reach the model (`runner.ts:264-272`) — no location, description, years, brand. ~20 other collected fields are ignored.
  4. **Underpowered model + rules that forbid the goal.** Kimi/DeepSeek @ 6k tokens, told to *never* touch structure or `<script>` — but the known-good output *did* rewrite `script.js`/`components.js` and enrich pages.
  5. **No verification.** Nothing asserts the template's identity is gone.
- **What v1 got right (keep):** queue + serial claim RPC, Storage buckets (`website-templates`, `template-sites`), realtime step tracker, preview route, DirectAdmin deploy, Pexels cache, manifest/zip utilities.
- **Known-good target proves the shape:** `style.css` byte-identical (design preserved) while HTML **and** JS are fully rewritten with real client identity + real client photos.

## 2. Decisions (locked with the user)

| Decision | Choice |
|---|---|
| Architecture | **Hybrid** — whole-file regeneration + blocking gates now; content model designed so high-volume templates can graduate to deterministic slot-fill later |
| Model | **Gemini** (`GEMINI_API_KEY`). Pro for plan/regeneration, Flash for verification/vision ranking |
| Client input | **Full lead record** feeds generation (no new form fields); AI enriches genuine gaps |
| Human control | **Review + edit before deploy**, plus a dedicated **image curation** checkpoint |
| Images | Operator curates: **6 hero candidates → pick ≤3**, **5 per service → pick 1**, custom URL, or "more" |
| Image preservation | **Deferred** — schema shaped for it now, built later |

## 3. Architecture — staged pipeline with human checkpoints

v1 is fire-and-forget. v2 is a **resumable state machine** that pauses for the operator.

```
setup ──▶ planning ──▶ curating ──(operator picks copy+images)──▶ building ──▶ review ──▶ deployed
                │           ▲                                        │           │
                └── failed  └────────── "regenerate" ────────────────┴───────────┘
```

`template_generations.status`: `planning | curating | building | review | deployed | failed`.
Each transition is driven by an API call; `planning`/`building` run in the existing queue+processor (long work), `curating`/`review` are operator-blocking states. `steps jsonb` + realtime tracker are reused for `planning`/`building` progress.

## 4. Data model — migration `0034_template_engine_v2.sql`

Extend `template_generations` (keep existing columns):
- `content_model jsonb` — the editable source of truth (§6).
- `image_slots jsonb` — array of slots, each: `{ id, kind:'hero'|'service'|'gallery'|'about', label, pick_max, candidates:[{url,thumb,source:'pexels'|'custom'|'client',photographer,width,height,vision:{people:bool,score:number,reason}}], selected:[url], seen_ids:[string], custom_urls:[string] }`. `seen_ids` powers "show me different ones".
- `options jsonb` — `{ exclude_people: boolean (default true), tone?: string }`.
- `brief jsonb` — the frozen lead snapshot used for generation (auditable; lead can change later).
- Widen the status check constraint to the new states.

Reserved for the deferred **image preservation library** (create table now, unused until phase 2):
- `curated_images(id, service_key text, business_type text, url text, thumb text, source text, vision jsonb, approved_by uuid, times_used int default 0, created_at)` + index on `(service_key, business_type)`. Later: the candidate fetcher consults this first.

## 5. Provider — Gemini (**VERIFIED against the live account 2026-07-15**)

Add a `gemini` provider to `lib/ai-tools/config.ts` using Google's **OpenAI-compatible endpoint** so the existing `callProvider` (`lib/ai-tools/run.ts:81`) is reused with no new HTTP client:
- Base: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, auth `Authorization: Bearer ${GEMINI_API_KEY}` — **verified HTTP 200**.
- **Model IDs (probed, not assumed):**
  - `gemini-3.1-pro-preview` → **plan + whole-file regeneration** (newest pro tier that works on the compat endpoint).
  - `gemini-3.5-flash` → **vision ranking + verification** (newest flash tier).
  - Fallbacks that also verified 200: `gemini-2.5-pro`, `gemini-2.5-flash`.
  - **`gemini-3-pro-preview` returns 404 on the compat endpoint** despite being listed by `/v1beta/models` — do not use it; keep all ids in config so they're swappable without touching call sites.
- `maxOutputTokens`: **≥32000** (kills the v1 truncation class of bug).
- **Vision verified on real Pexels photos** via OpenAI-style `image_url` parts. Probe results:
  - `…/1388944/floor-flooring-hand-man…` → `{"people":true,"relevance":0,"quality":0.8,"reason":"Shows flooring installation, not house painting"}` — caught a bare hand **and** independently judged trade-relevance.
  - `…/3615730/…` → `{"people":false,"relevance":0.9,"quality":0.9,"reason":"Clean shot of a paintbrush on wood."}`
  - Conclusion: the §7 vision gate is sound — it delivers both "no people" **and** the per-trade "sense" that text search cannot.
- **Parsing note:** Gemini wraps JSON in ```` ```json ```` fences. Reuse `parseOps`' existing fence/prose tolerance (`editOps.ts:10-56`) for every JSON response, or set `response_format:{type:"json_object"}` — never `JSON.parse` raw.
- Keep Kimi/DeepSeek selectable as fallbacks.

## 6. Phase 1-2 — Brief + Content Plan

**Brief** = the whole lead record, not 6 fields: `business_name, phone, email, site_type, services[], service_areas[], client_experience (years), comments, color_scheme/color_same_as_logo, logo_link, image_links[] (client photos), rating, add_ons[], num_webpages, specify_pages[], business_profile_link, map_embed_link, reference_link`. Frozen into `brief`.

**Content Plan** (Gemini Pro, one call, JSON-schema-validated → `content_model`):
```jsonc
{
  "identity": { "name", "tagline", "positioning", "phone", "email", "areas": [], "years", "license_line" },
  "hero": { "eyebrow", "headline_parts": [], "subcopy", "cta_primary", "cta_secondary" },
  "services": [ { "key", "name", "short", "long", "bullets": [], "image_query" } ],
  "stats": [ { "value", "label" } ],
  "testimonials": [ { "quote", "name", "meta", "initials" } ],
  "faq": [ { "q", "a" } ],
  "about": { "story", "why_us": [] },
  "pages": { "<file>": { "title", "meta_description", "sections": {...} } },
  "image_briefs": [ { "slot_id", "kind", "query", "must_show", "avoid" } ]
}
```
Rules: testimonials/stats must be plausible and **localized to the client's real service areas**; never invent licenses/awards/certifications; services come from the lead's real services. The plan is **the editable artifact** (operator edits it in the UI; re-render is instant).

## 7. Phase 3 — Image candidates + Gemini vision curation

Per image slot:
1. **Source order:** client photos (`image_links`) and `logo_link` are offered first for slots where they fit; then Pexels.
2. **Fetch:** Pexels search on the plan's `image_query` (reuse `pexels.ts` + its 30-day cache), pulling a **wide net (~20-30)** excluding any id in `seen_ids`.
3. **Vision rank (Gemini Flash, multimodal):** send candidate thumbnails; return per-image `{ people: bool, relevance: 0-1, quality: 0-1, reason }`. **Hard-drop `people:true` when `options.exclude_people` (default ON)**; rank by relevance×quality. This is the mechanism that delivers "high quality, no-men images" — text search alone cannot.
4. **Present:** top **6** for hero/background (`pick_max: 3`), top **5** per service (`pick_max: 1`). Store candidates + vision verdicts in `image_slots`; append returned ids to `seen_ids`.
5. **"Show different ones":** re-run 2-4 excluding `seen_ids` → fresh candidates, never repeats.
6. **Custom URL:** operator pastes a URL → server validates it resolves + is an image (content-type/size) → becomes a candidate with `source:'custom'`, auto-selected.
7. Selected image URLs are written into the content model and used at regeneration. Direct CDN URLs (as the known-good output does) — no download/rehost step.

**APIs:** `POST /api/template-engine/generations/[id]/images/[slotId]/more`, `POST .../images/[slotId]/select` `{urls[]}`, `POST .../images/[slotId]/custom` `{url}`.

## 8. Phase 4 — Regeneration (the core fix)

- **File classification:** `style.css` and any pure-asset file → **never sent, never changed** (design preserved by construction). **Every content-bearing file** — all `.html` **plus `script.js`, `components.js`, and any other content `.js`** — is regenerated. (v1's fatal omission.)
- **Whole-file rewrite**, one call per file (Gemini Pro), conditioned on the **same content model** (guarantees cross-page consistency: one phone, one service list, one testimonial set everywhere).
- **Hard rules in the prompt:** preserve every CSS class, id, `data-*`, inline handler, and every JS identifier (class/function/method/variable names) and control flow; the file must still parse; change **only** human-visible text, content data values (e.g. testimonial arrays), image URLs, alt text, `<title>`/meta, and contact details; enrich thin sections to match the client's real offering; never leave any template-identity token.
- Output = the complete file. No find/replace, so **no silent no-op path exists**.
- Unrequested template pages (e.g. demo `area-cherry-creek.html`, `service-kitchen.html`) are dropped or cloned per the plan, as v1 does.

## 9. Phase 5 — Verification gates (blocking, with bounded auto-repair)

Runs after regeneration; failure blocks `review`, triggers a targeted repair pass (max 2 rounds), then surfaces the specific problem to the operator.

1. **Identity-leak scan (hard fail).** Auto-derive the template's demo token set at **template-upload time** (business name, city/areas, demo person names, demo phone/email, JS identifiers like `NorthpointApp`) and store it on `website_templates.demo_tokens jsonb`. After build, **any occurrence in any output file = fail**. This gate alone makes the Warrior bug unshippable.
2. **Structure preservation.** The set of CSS classes/ids/tag skeleton per HTML file must match the template's; JS must parse and retain its top-level identifier set. Drift → fail.
3. **Asset integrity.** No template image paths remain; every image URL resolves (HEAD 200, image content-type); internal links point at files that exist.
4. **Content completeness.** No empty required sections; client's real services all present; no lorem/placeholder.
5. **(Optional, phase 2) Visual QA:** headless screenshot per page → Gemini vision critique vs the brief (catches layout breakage).

`ops_applied`/`ops_missed` are retired in favour of `gate_results jsonb`.

## 10. UI redesign — a 5-step generation workspace

Replaces `TemplateEngineBoard`. Route: `/ai-tools/template-engine/[generationId]` with a step rail; entry from **the lead detail page** ("Generate website") and from a leads-connected launcher.

- **Step 1 · Setup.** Searchable **lead picker showing real lead data** (business, services, areas, photos, colors) so the operator sees exactly what will feed the AI, with inline per-generation overrides (stored in `brief`, never silently mutating the lead). Template picker **with thumbnails** (`.thumbnail` already ships in template zips). Page checkboxes. Options: "Exclude photos with people" (default ON), tone.
- **Step 2 · Content.** The content model rendered as a friendly editable form — hero headline/subcopy, per-service name/short/long/bullets, stats, testimonials, FAQ, about. Inline "regenerate this section" buttons. Live validation.
- **Step 3 · Images.** The centrepiece. Per slot, a **thumbnail grid** (hero: 6 → pick ≤3; each service: 5 → pick 1) with: click-to-select, hover preview/lightbox, a **"Show different ones"** button, a **custom URL** field with instant thumbnail preview, and client-photo chips. Each card shows source + a "no people ✓" indicator from the vision pass. Progress ("4/7 slots chosen"); can't build until every required slot is satisfied.
- **Step 4 · Build.** The existing realtime step tracker + a live gate checklist (leak scan / structure / assets / completeness) with clear failure detail.
- **Step 5 · Review.** Full-page **preview iframe** (existing preview route) + per-page tabs, the verification report, "Edit content" / "Edit images" (→ back to step 2/3, rebuild), **Download zip**, and **Deploy** (existing DirectAdmin leg → writes `leads.website_link`, fires `website_link_added`).

All steps are resumable — the wizard reads state from `template_generations`, so a refresh or a colleague picking it up loses nothing.

## 11. Migration & rollout

- v2 lives beside v1 behind the existing `templates.generate` permission; v1's runner is removed once v2 is verified on a real lead (no in-flight generations to migrate — the table gains columns, old rows keep `status='ready_for_review'`).
- New env: `GEMINI_API_KEY` (+ existing `PEXELS_API_KEY`, DirectAdmin vars).
- Reused unchanged: queue/claim RPC, buckets, preview, deploy, zip/manifest, Pexels cache.

## 12. Deferred (explicitly out of scope, designed-for)

1. **Image preservation library** — `curated_images` consulted before Pexels so an approved "interior painting" shot is reused, not re-fetched.
2. **Slot instrumentation** — graduate high-volume templates to deterministic slot-fill (the content model is already the contract).
3. Visual-QA screenshots; multi-template A/B.

## 13. Success criteria

1. Running the *same* Warrior lead + *same* template produces a site with **zero** "Northpoint/Denver/Cherry Creek" tokens (gate-enforced) — the current failure is impossible to reproduce.
2. Output quality matches `insideout-painting.zip`: real identity everywhere, `script.js`/`components.js` rewritten, CSS untouched, rich inner pages, curated people-free imagery.
3. Operator picks every service image from ≥5 vetted options (or a custom URL) and ≤3 of 6 hero options, and can request unlimited fresh alternatives.
4. No generation can reach `deployed` with a failing gate.
