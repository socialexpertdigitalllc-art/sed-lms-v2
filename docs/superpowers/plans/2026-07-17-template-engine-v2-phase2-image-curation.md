# Template Engine v2 — Phase 2: Image Curation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` tracking.

**Goal:** Turn image selection from a hidden one-shot pick into an operator-curated step: for every image slot, gather a wide Pexels net, have Gemini vision rank each candidate (hard-dropping people by default), present the best (6 hero → pick ≤3; 5 per service → pick 1), and let the operator swap in a custom URL or request fresh alternatives — before the site is built.

**Architecture:** The runner splits into two entry points around a human pause. **Plan phase** (`runTemplateGenerationV2`, existing name kept): plan the content model → gather + vision-rank image candidates into `image_slots` → stop at `status='curating'`. **Build phase** (`buildFromSelection`, new): triggered after the operator selects → regenerate content files using the SELECTED image URLs → verify → finalize → `status='review'`. Phase 1's plan/regenerate/verify/finalize logic is reused verbatim; only image resolution changes (selected URLs instead of one auto-pick) and the pause is inserted.

**Tech Stack:** Next 16, TypeScript, Supabase, Gemini (Flash for vision — verified multimodal), Pexels, vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-template-engine-v2-design.md` §7 (+ §3 states, §4 `image_slots` shape). Read them.

**Branch:** `template-engine-v2-p2` off main (Phase 1 merged @ 7f18b6d).

**Ground rules (every task):** work only in `D:/sed-lms-v2`; never touch `D:/Old LMS Dashboard/sed-lms`. Gates: `npx tsc --noEmit` + `npx vitest run` green (~511 baseline). NO `npm run build` per task (controller runs once). Keep dev server DOWN during tsc/build. No emojis. Commit per task; body ends `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Migrations written, applied by controller via MCP. Verified Gemini facts: OpenAI-compat endpoint; `gemini-3.5-flash` for vision (`GEMINI_FLASH_MODEL`), `image_url` content parts work; Gemini fences JSON → use `parseJsonLoose`, never `?? {}`.

---

## Task 1: Image-slot types + pure slot builder

**Files:** Create `lib/template-engine/imageSlots.ts`; Test `tests/imageSlots.test.ts`.

Types (align with spec §4):
```ts
export interface ImageCandidate {
  url: string; thumb: string; source: "pexels" | "custom" | "client";
  photographer?: string; width?: number; height?: number;
  vision?: { people: boolean; relevance: number; quality: number; reason: string };
  pexelsId?: number;
}
export interface ImageSlot {
  id: string;              // = the brief's slot_id
  kind: string;            // hero | service | gallery | about
  label: string;
  pick_max: number;        // hero 3, else 1
  present_max: number;     // hero 6, service 5
  candidates: ImageCandidate[];
  selected: string[];      // chosen urls (<= pick_max)
  seen_pexels_ids: number[]; // powers "show different ones"
}
```

- [ ] **Step 1: failing test** `tests/imageSlots.test.ts` for the two pure helpers below.
- [ ] **Step 2: run, watch fail.**
- [ ] **Step 3: implement:**
  - `slotDefaults(kind: string): { pick_max: number; present_max: number }` — hero → `{3,6}`, else → `{1,5}`.
  - `rankAndTrim(candidates: ImageCandidate[], opts: { excludePeople: boolean; presentMax: number }): ImageCandidate[]` — drop `vision.people === true` when `excludePeople`; sort by `(vision.relevance ?? 0) * (vision.quality ?? 0)` desc (candidates with no vision sort last but are kept); take `presentMax`. Client-sourced candidates are never dropped and sort first (the client's real photo wins).
  - `mergeCandidates(existing: ImageCandidate[], fresh: ImageCandidate[]): ImageCandidate[]` — union by `url`, preserving order (existing first), so "show more" appends without duplicating.
  Tests: people dropped only when excludePeople; ordering by relevance*quality; client photos first + never dropped; present_max respected; merge dedupes by url; hero vs service defaults.
- [ ] **Step 4: pass. Step 5: commit** `feat: image-slot types + pure ranking/merge helpers`.

---

## Task 2: Gemini vision ranking

**Files:** Create `lib/template-engine/vision.ts`; Test `tests/vision.test.ts`.

- [ ] **Step 1: failing test** for the pure prompt-builder + verdict-parser (NOT the network call).
- [ ] **Step 2: run, fail.**
- [ ] **Step 3: implement:**
  - `VISION_SYSTEM` + `visionPrompt(brief: { query: string; kind: string; businessType: string }): string` — instruct: judge each supplied photo for a `{businessType}` website; return ONLY a JSON array, one object per image IN ORDER: `{people:boolean, relevance:0-1, quality:0-1, reason:"<=8 words"}`; people=true if ANY human or body part (hand/arm/face) is visible; relevance = fit for the trade/section; quality = professional stock quality.
  - `parseVisionVerdicts(raw: string, n: number): VisionVerdict[]` (pure) — `parseJsonLoose`; coerce to an array of exactly `n` verdicts; any missing/malformed entry → a conservative default `{people:true, relevance:0, quality:0, reason:"unreadable"}` (conservative = drop it, never wrongly ship a person). Cover: good array, fenced JSON, short array padded, garbage → all-conservative.
  - `rankImages(candidates: {url:string}[], brief, model = GEMINI_FLASH_MODEL): Promise<VisionVerdict[]>` — one Gemini Flash call with a text part (visionPrompt) + one `image_url` part per candidate (use the thumb/url); `callProvider("gemini", model, VISION_SYSTEM, ...)`. NOTE: `callProvider`'s current signature takes string prompts — if it cannot pass multimodal `image_url` parts, EXTEND it minimally (add an optional `images?: string[]` arg that appends `image_url` parts to the user message) and say exactly what you changed. Batch cap: ≤ 12 images per call (chunk if more). On call failure, return all-conservative verdicts (never throw — a vision outage must not fail generation, just yields no vetted picks).
- [ ] **Step 4: pass (pure tests). Step 5: commit** `feat: Gemini-vision image ranking (no-people + trade-relevance)`.

---

## Task 3: Candidate gathering (Pexels wide-net + vision, I/O orchestration)

**Files:** Create `lib/template-engine/gatherImages.ts`; Test `tests/gatherImages.test.ts` (pure mapping only).

- [ ] **Step 1-2:** failing test for a pure `pexelsToCandidate(photo): ImageCandidate` mapper (url/thumb/photographer/dims/pexelsId, source "pexels").
- [ ] **Step 3: implement:**
  - `pexelsToCandidate(photo)` (pure).
  - `gatherSlotCandidates(args: { brief: ImageBrief; businessType: string; admin; excludePeople: boolean; excludeIds: number[]; presentMax: number }): Promise<ImageCandidate[]>` — `searchPexels(brief.query, ...)` for a WIDE net (~24, reuse pexels.ts cache), filter out `excludeIds`, map to candidates, `rankImages` them, `rankAndTrim`. Returns the vetted top `presentMax`.
  - `buildInitialSlots(briefs: ImageBrief[], args): Promise<ImageSlot[]>` — one slot per brief; hero/about slots seed `selected` with a client photo when available (source "client", pick_max respected); gather candidates for the rest. `businessType` derived from the brief/lead (e.g. `brief.site_type` or the services).
  - Concurrency-cap the per-slot gather (≤3) like the regen loop.
- [ ] **Step 4-5:** pass; commit `feat: Pexels wide-net + vision candidate gathering per slot`.

---

## Task 4: Split the runner (plan→curating, build-from-selection)

**Files:** Modify `lib/template-engine/runnerV2.ts`; modify `lib/template-engine/queue.ts`; migration `supabase/migrations/0035_tge_build_phase.sql`.

- [ ] **Step 1: migration 0035** — add `template_gen_queue.kind text not null default 'plan'` (values `'plan' | 'build'`) so the processor can dispatch the two phases. (Written, not applied.)
- [ ] **Step 2: `runTemplateGenerationV2` (plan phase)** — after the `images` step, instead of resolving one pick + building: call `buildInitialSlots(...)`, persist `image_slots`, set `status='curating'`, write a `curate` step `done`, and RETURN (do not prepare/build/verify/finalize). Client-photo-only slots may be pre-selected but the run still pauses for operator confirmation.
- [ ] **Step 3: `buildFromSelection(generationId)` (build phase, new export)** — load gen (`content_model`, `image_slots`, `brief`, template). Resolve `imagesForFile` from each slot's `selected` urls (fall back to the top candidate if a non-optional slot is empty — but the `/build` API should prevent that). Then run the EXISTING prepare → classify → pageSelect → neutralize → regenerate → runGates (+repair) → finalize logic (extract it from the current runner into a shared helper both phases can call, OR call it from here). Terminal `review`/`failed` as today.
- [ ] **Step 4: `queue.ts`** — `processTemplateQueue` dispatches on the claimed row's `kind`: `'plan'` → `runTemplateGenerationV2`, `'build'` → `buildFromSelection`. Keep the serial claim RPC.
- [ ] **Step 5:** tsc + vitest green (the runner split has no new unit tests; the extracted build helper keeps existing behavior). Commit `feat: split runner into plan/curate/build phases`.

---

## Task 5: Curation APIs

**Files:** Create `app/api/template-engine/generations/[id]/images/[slotId]/more/route.ts`, `.../select/route.ts`, `.../custom/route.ts`, and `app/api/template-engine/generations/[id]/build/route.ts`. Test any extracted pure validators.

All: auth + `templates.generate`; RLS-check the lead is visible (mirror `generate/route.ts:64-71`); load the gen, mutate `image_slots` via the admin client, return the updated slot(s). Gen must be `status='curating'` (409 otherwise).
- [ ] **`POST .../[slotId]/more`** — `gatherSlotCandidates` excluding the slot's `seen_pexels_ids`; `mergeCandidates` onto the slot; append new pexels ids to `seen_pexels_ids`; persist; return the slot.
- [ ] **`POST .../[slotId]/select` `{urls: string[]}`** — validate each url is a candidate on the slot; cap to `pick_max`; set `selected`; persist.
- [ ] **`POST .../[slotId]/custom` `{url}`** — server-side validate the url resolves + is an image (HEAD/GET, content-type `image/*`, size sane); add as `source:"custom"` candidate; auto-add to `selected` (respect pick_max); persist.
- [ ] **`POST .../build`** — validate every slot has `selected.length >= 1` (422 listing empty slots); flip gen to a build-pending state, insert a `template_gen_queue` row `kind='build'`, `kickTemplateProcessor()`. Return 202.
- [ ] Commit `feat: image curation APIs (more/select/custom) + build trigger`.

---

## Task 6: Controller live-verify

- [ ] Apply migration 0035 via MCP.
- [ ] `npm run build` → 0.
- [ ] Live run (test-harness recipe from the memory note): insert a `kind='plan'` generation for the Warrior lead → processor → confirm it stops at `curating` with populated `image_slots` (candidates carry vision verdicts; people-flagged ones dropped). Hit `/more` (fresh candidates, no repeats), `/select`, `/custom`. Then `/build` → confirm it reaches `review` with the SELECTED images wired into the output (grep the chosen urls in the built files). Pull the zip from Storage and eyeball.
- [ ] Merge `template-engine-v2-p2` → main, push.

---

## Self-review notes
- Spec coverage: §7 candidate gather + vision → T2/T3; 6-hero/5-service + custom + "more" → T1/T5; the `curating` pause state (§3) → T4; `image_slots` shape (§4) → T1.
- The pure helpers (slot ranking, verdict parsing, candidate mapping) are unit-tested; the network paths (vision, Pexels, the runner split) are verified by the T6 live run, as in Phase 1.
- Phase 3 (the 5-step wizard UI) consumes these APIs + `image_slots`; it is a separate plan.
