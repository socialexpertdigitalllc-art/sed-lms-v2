# Template Engine v2 — Phase 3: 5-Step Operator Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 `TemplateEngineBoard` with a lead-connected 5-step generation workspace (Setup → Content → Images → Build → Review) that drives the proven Phase-1/2 pipeline end-to-end, including image curation and deploy.

**Architecture:** A launcher page at `/ai-tools/template-engine` (Setup panel creates a run + recent-runs list) and a resumable wizard at `/ai-tools/template-engine/[genId]` whose active step derives from `template_generations.status` (`planning→curating→building→review→deployed`). The generation row IS the wizard state — refresh/resume loses nothing. Realtime `postgres_changes` events are only a *poke*; data always re-fetches from the REST detail route (established board pattern).

**Tech Stack:** Next 16.2.9 App Router (promised `params`), React 19, Tailwind v4 tokens (Data Console/Teal), zod 4.4.3, Supabase (RLS user client + admin client per existing patterns), vitest 3 (jsdom, repo-root `tests/`), lucide-react icons (NO emojis — house rule).

**Design source:** `docs/superpowers/specs/2026-07-15-template-engine-v2-design.md` §10.

---

## Verified facts this plan is built on (from the 2026-07-17 codebase survey)

- **Status flow (v2, exact strings):** `queued → running → planning → curating → building → review | deployed | failed`. `ready_for_review` is v1-legacy (kept in the 0034 check constraint for old rows).
- **BUG to fix first:** `deploy/route.ts:39` and `download/route.ts:25` gate on `ready_for_review|deployed` → they 409 on every v2 build (which ends at `review`). `generate/route.ts:29` samples `estimate_ms` from `.in("status",["ready_for_review","deployed"])` only.
- **No route writes `content_model`** — step 2 needs a new PATCH route. `buildFromSelection` re-reads the row at build time (`runnerV2.ts:613`), so edits made during `curating` flow into the build. Editing `image_briefs` does NOT rebuild slots (slots are built once in the plan phase) → the editor must treat `image_briefs` and `pages` as frozen.
- **`generate` route** requires `tool`/`model` in the body today, but v2 ignores both (`planContent`/`regenerateFile` default to `GEMINI_PRO_MODEL`). `isToolId()` already accepts `"gemini"`. There is no `options` field — `exclude_people` is always the DB default `true`.
- **Curation APIs exist and are final** (all 409 unless status `curating`, all gate `templates.generate` + RLS-visible lead):
  - `POST .../images/[slotId]/select` `{urls: string[]}` (empty = clear) → `{slot}`; 422 `"Too many images selected: this slot allows at most N"` / `"Not a candidate on this slot: <urls>"`.
  - `POST .../images/[slotId]/more` (no body) → `{slot}` with merged fresh candidates, `next_page` incremented.
  - `POST .../images/[slotId]/custom` `{url}` → `{slot}`; server verifies content-type `image/*`, ≤15MB; auto-selects (evicts oldest at pick_max).
  - `POST .../build` → 202 `{ok:true}`; 409 `{error:"Not in curation"}`; 422 `{error:"Every slot needs at least one selected image", slots:[{id,label}]}`. CAS `curating→building`, queues `kind:'build'`, kicks processor.
- **Slot shape** (`lib/template-engine/imageSlots.ts`): `ImageSlot {id, kind, label, pick_max (hero 3, else 1), present_max (hero 6, else 5), candidates: ImageCandidate[], selected: string[], seen_pexels_ids, next_page?}`; `ImageCandidate {url, thumb, source: "pexels"|"custom"|"client", photographer?, width?, height?, vision?: {people, relevance, quality, reason}, pexelsId?}`.
- **ContentModel** (`lib/template-engine/contentModel.ts`, zod, unknown keys stripped): `identity {name!, tagline, positioning, phone?, email?, areas[], years?, license_line?}`, `hero {eyebrow, headline_parts[], subcopy, cta_primary, cta_secondary}`, `services[] {key!, name!, short, long, bullets[], image_query!}` (min 1), `stats[] {value, label}`, `testimonials[] {quote, name, meta, initials}`, `faq[] {q, a}`, `about {story, why_us[]}`, `pages Record<file,{title, meta_description, sections?}>`, `image_briefs[] {slot_id!, kind!, query!, must_show?, avoid?}`.
- **Steps timeline** (`GenStep {key,label,status: pending|running|done|failed|partial, started_at?, ms?, detail?}`): plan phase `plan`, `images`, `curate`; build phase `prepare`, `build:<file>` per content file (count ≠ requested_pages.length — pageSelect can drop pages, reason in `prepare` detail), `verify`, `finalize`; deploy appends `deploy:subdomain|upload|verify|link` (prior `deploy:*` pruned on redeploy). `current_step` is set to the literal `"build"` then each finished file name during the build loop — do NOT treat it as a step-key lookup.
- **v2 rows have `tokens_used: 0, cost_usd: 0` hardcoded** — never display them as real data for v2 runs.
- **Gates reality check:** `gates.ts` `GateResult` carries only `leaks` + `structure` — the asset-integrity and content-completeness gates named in spec §9/§10 were never built in Phase 2. The tracker renders what exists; do not invent placeholder rows for gates the engine doesn't run.
- **Detail/list APIs:** `GET /api/template-engine/generations/[id]` → `{generation: {…select *, template_name, business_name}}` (v2 jsonb columns come through). List route returns full `select *` of 50 rows (heavy) — this plan slims it.
- **Realtime pattern** (canonical, copied from the v1 board): channel + `postgres_changes` on `template_generations`, `supabase.realtime.setAuth(session.access_token)` first, 400ms debounce, then re-fetch via REST. Table is already in the `supabase_realtime` publication.
- **Page/server conventions:** async server `page.tsx` → auth (`createClient().auth.getUser()` → redirect `/login`) → `getUserPermissions(user.id)` → gate `templates.generate` (redirect `/dashboard`) → admin client for cross-team pickers (safe because page is perm-gated) → one client component with typed props. New dynamic routes use `{ params }: { params: Promise<{ id: string }> }` + `await params`.
- **Lead-detail entry point already exists** (`components/leads/LeadDetail.tsx` header actions): `Link href={/ai-tools/template-engine?lead=${lead.id}}` gated on `templates.generate` — the launcher keeps consuming `?lead=` so this needs no change.
- **Shared UI:** `Select` (chevroned native select — it applies only `appearance-none pr-8`; callers MUST pass their own input styling, e.g. `className={inputCls}`), `useToast()`, `RelativeTime`, `EmptyState`, `Skeleton` + `TableSkeleton` (SEPARATE files: `components/common/Skeleton.tsx` and `components/common/TableSkeleton.tsx`), `Field`/`inputCls`/`FormSection` (`Field` accepts `className`), `SectionCard {n, icon, title, subtitle, done, delay}` (numbered wizard-style card — reuse for the step rail), `ChipGroup`, `DynamicList`, `CopyButton`, `cn`. Card header style: `text-[10px] uppercase tracking-wider text-text-faint font-semibold`. Status-pill palette: running `bg-accent-soft text-accent-ink`, review `bg-notready-bg text-notready-fg`, deployed `bg-ready-bg text-ready-fg`, failed `bg-dropped-bg text-dropped-fg`.
- **Tests:** vitest, repo-root `tests/*.test.ts`, jsdom, globals. House pattern: pure validators/helpers unit-tested; thin route wrappers and client boards are not.
- Next free migration number is 0036 — **this plan needs NO migration.**

## Explicitly deferred (do not build)

- Nav-badge for "runs awaiting curation" (`NAV_COUNT_BY_HREF` + `COUNT_TABLES` + count fn) — nice-to-have, separate change.
- "Rebuild image slots" API for edited `image_briefs` — editor freezes briefs instead.
- Per-generation lead-field overrides in Setup (design §10 mentions inline overrides "stored in brief" — YAGNI for v3; the brief freezes the lead as-is today).
- Deleting v1 `runner.ts` / the v1 ai-tools stack (separate cleanup, tracked in memory).
- Visual-QA screenshots, template thumbnails endpoint (template zips ship `.thumbnail` but no route serves extracted template files today — picker shows name/page-count cards instead; add a thumbnail route only if the storage layout is confirmed extracted during execution).
- Inline "regenerate this section" buttons in the content editor (spec §10 step 2) — needs a new section-scoped AI endpoint; the edit-whole-model + reopen/rebuild loop (Task 11b) covers the need until then.
- Tone option (spec §4 reserves `options.tone`) — `planContent` doesn't consume a tone yet; a dead knob would lie to the operator. Add the control the day the planner reads it.
- Hover preview / lightbox on image candidate cards (spec §10 step 3) — later polish; grid thumbs are already generous.
- Live inline validation in the content editor — validation is server-side at save (422 with detail toast); per-field zod highlighting deferred.

---

## File structure

**Create:**
- `lib/template-engine/wizard.ts` — pure step/status/pill/progress helpers (the wizard's brain, fully unit-tested)
- `lib/template-engine/contentEdit.ts` — pure `applyContentEdit(existing, incoming)` merge guard (freezes `image_briefs` + `pages`)
- `lib/template-engine/generateInput.ts` — zod body schema for POST /generate (extracted so it's unit-testable; tool/model now optional, `options.exclude_people` added)
- `app/api/template-engine/generations/[id]/content/route.ts` — PATCH content_model (new)
- `app/api/template-engine/generations/[id]/reopen/route.ts` — POST review→curating (Task 11b, the spec's edit-and-rebuild loop)
- `app/(app)/ai-tools/template-engine/[genId]/page.tsx` — wizard server page
- `components/template-engine/wizard/GenerationWizard.tsx` — client shell: detail fetch + realtime poke + step rail + step routing
- `components/template-engine/wizard/SetupPanel.tsx` — launcher: lead picker w/ live preview, template cards, page chips, options → POST generate → push wizard
- `components/template-engine/wizard/RunsList.tsx` — launcher: recent runs (v2 pills) linking into the wizard
- `components/template-engine/wizard/ContentEditor.tsx` — step 2
- `components/template-engine/wizard/ImageCuration.tsx` — step 3
- `components/template-engine/wizard/BuildTracker.tsx` — step 4 (also renders plan-phase steps while `planning`)
- `components/template-engine/wizard/ReviewPanel.tsx` — step 5
- `tests/templateWizard.test.ts`, `tests/contentEdit.test.ts`, `tests/generateInput.test.ts`

**Modify:**
- `app/api/template-engine/generations/[id]/deploy/route.ts:39` — accept `review`
- `app/api/template-engine/generations/[id]/download/route.ts:25` — accept `review`
- `app/api/template-engine/generate/route.ts` — use `generateInput.ts`; default tool/model; persist `options`; sample estimates from `review|ready_for_review|deployed`
- `app/api/template-engine/generations/route.ts` — slim column projection (drop `image_slots`, `content_model`, `brief`)
- `app/(app)/ai-tools/template-engine/page.tsx` — render launcher (SetupPanel + RunsList) instead of TemplateEngineBoard

**Delete (final task, after live verification):**
- `components/template-engine/TemplateEngineBoard.tsx`

---

### Task 1: Deploy/download must accept the v2 terminal status `review`

**Files:**
- Create: `lib/template-engine/wizard.ts`
- Test: `tests/templateWizard.test.ts`
- Modify: `app/api/template-engine/generations/[id]/deploy/route.ts:39`, `app/api/template-engine/generations/[id]/download/route.ts:25`, `app/api/template-engine/generate/route.ts:29`

- [ ] **Step 1: Write the failing test**

```ts
// tests/templateWizard.test.ts
import { describe, it, expect } from "vitest";
import { isDeployableStatus } from "@/lib/template-engine/wizard";

describe("isDeployableStatus", () => {
  it("accepts the v2 terminal status and the v1 legacy + deployed", () => {
    expect(isDeployableStatus("review")).toBe(true); // v2 build ends here
    expect(isDeployableStatus("ready_for_review")).toBe(true); // v1 legacy rows
    expect(isDeployableStatus("deployed")).toBe(true); // redeploy
  });
  it("rejects every in-flight or failed status", () => {
    for (const s of ["queued", "running", "planning", "curating", "building", "failed"]) {
      expect(isDeployableStatus(s)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it — must fail with "wizard.ts not found / isDeployableStatus is not exported"**

Run: `npx vitest run tests/templateWizard.test.ts`

- [ ] **Step 3: Create the helper**

```ts
// lib/template-engine/wizard.ts
/**
 * Pure status/step helpers for the 5-step generation wizard (design §10).
 * The generation row is the wizard's single source of truth; everything here
 * derives UI state from `template_generations.status` and friends. No I/O.
 */

/** Statuses with a finished, downloadable/deployable site zip. "review" is the
 *  v2 terminal build status; "ready_for_review" is v1-legacy (old rows only). */
export const DEPLOYABLE_STATUSES = ["review", "ready_for_review", "deployed"] as const;

export function isDeployableStatus(status: string): boolean {
  return (DEPLOYABLE_STATUSES as readonly string[]).includes(status);
}
```

- [ ] **Step 4: Point both routes at it**

In `app/api/template-engine/generations/[id]/deploy/route.ts` — replace the line-39 gate:

```ts
// BEFORE
if (gen.status !== "ready_for_review" && gen.status !== "deployed") {
// AFTER
if (!isDeployableStatus(gen.status)) {
```

with import `import { isDeployableStatus } from "@/lib/template-engine/wizard";`. Same replacement in `download/route.ts:25`.

Also in the deploy route: widen its generation select to include `gate_results`, and add a server-side gate check right after the status gate, so a failing run can never deploy (spec §13.4 holds by construction, not just by the runner's failed-status write):

```ts
const gr = gen.gate_results as { ok?: boolean } | null;
if (gr && gr.ok === false) {
  return NextResponse.json(
    { error: "Verification gates failed — rebuild before deploying" },
    { status: 409 },
  );
}
```

(v1 rows and pre-gate runs have `gate_results` null → unaffected.)

In `app/api/template-engine/generate/route.ts:29`, widen the estimate sample:

```ts
// BEFORE
.in("status", ["ready_for_review", "deployed"])
// AFTER
.in("status", ["review", "ready_for_review", "deployed"])
```

- [ ] **Step 5: Run tests + typecheck, verify green**

Run: `npx vitest run tests/templateWizard.test.ts` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add lib/template-engine/wizard.ts tests/templateWizard.test.ts app/api/template-engine/generations/[id]/deploy/route.ts app/api/template-engine/generations/[id]/download/route.ts app/api/template-engine/generate/route.ts
git commit -m "fix: deploy/download accept v2 terminal status 'review'"
```

---

### Task 2: Wizard step/status derivation helpers

**Files:**
- Modify: `lib/template-engine/wizard.ts`
- Test: `tests/templateWizard.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/templateWizard.test.ts`:

```ts
import {
  activeWizardStep,
  maxReachedStep,
  V2_STATUS_PILL,
  statusPill,
  slotProgress,
} from "@/lib/template-engine/wizard";
import type { ImageSlot } from "@/lib/template-engine/imageSlots";

describe("activeWizardStep", () => {
  it("maps every status to the step the operator should see", () => {
    expect(activeWizardStep("queued")).toBe(4); // pipeline running → tracker
    expect(activeWizardStep("running")).toBe(4);
    expect(activeWizardStep("planning")).toBe(4);
    expect(activeWizardStep("curating")).toBe(3); // the centrepiece
    expect(activeWizardStep("building")).toBe(4);
    expect(activeWizardStep("review")).toBe(5);
    expect(activeWizardStep("ready_for_review")).toBe(5);
    expect(activeWizardStep("deployed")).toBe(5);
    expect(activeWizardStep("failed")).toBe(4); // tracker shows the failure
  });
});

describe("maxReachedStep", () => {
  it("lets the operator navigate back but never ahead of the pipeline", () => {
    expect(maxReachedStep("planning")).toBe(4); // steps 2-3 have no data yet, tracker visible
    expect(maxReachedStep("curating")).toBe(3); // content + images editable, build not run
    expect(maxReachedStep("building")).toBe(4);
    expect(maxReachedStep("review")).toBe(5);
    expect(maxReachedStep("deployed")).toBe(5);
  });
});

describe("statusPill", () => {
  it("knows every v2 status (v1 board only knew five)", () => {
    for (const s of ["queued", "running", "planning", "curating", "building", "review", "ready_for_review", "deployed", "failed"]) {
      expect(V2_STATUS_PILL[s]).toBeDefined();
      expect(statusPill(s).label.length).toBeGreaterThan(0);
    }
  });
  it("falls back to Queued for unknown strings", () => {
    expect(statusPill("garbage").label).toBe("Queued");
  });
});

describe("slotProgress", () => {
  const slot = (id: string, selected: string[]): ImageSlot => ({
    id, kind: "service", label: id, pick_max: 1, present_max: 5,
    candidates: [], selected, seen_pexels_ids: [],
  });
  it("counts slots with at least one pick", () => {
    const slots = [slot("a", ["u1"]), slot("b", []), slot("c", ["u2"])];
    expect(slotProgress(slots)).toEqual({ chosen: 2, total: 3 });
  });
  it("handles empty", () => {
    expect(slotProgress([])).toEqual({ chosen: 0, total: 0 });
  });
});
```

- [ ] **Step 2: Run — fails: not exported**

Run: `npx vitest run tests/templateWizard.test.ts`

- [ ] **Step 3: Implement in `lib/template-engine/wizard.ts`**

```ts
import type { ImageSlot } from "./imageSlots";

/** The five operator steps, in rail order. */
export const WIZARD_STEPS = [
  { n: 1, key: "setup", label: "Setup" },
  { n: 2, key: "content", label: "Content" },
  { n: 3, key: "images", label: "Images" },
  { n: 4, key: "build", label: "Build" },
  { n: 5, key: "review", label: "Review" },
] as const;

export type WizardStepN = 1 | 2 | 3 | 4 | 5;

/**
 * The step the operator should land on for a given status. While the pipeline
 * owns the run (queued/running/planning/building/failed) that's the tracker;
 * the human checkpoints are curating (step 3) and review/deployed (step 5).
 */
export function activeWizardStep(status: string): WizardStepN {
  if (status === "curating") return 3;
  if (status === "review" || status === "ready_for_review" || status === "deployed") return 5;
  return 4;
}

/**
 * Highest step reachable via the rail: operators may look back at earlier
 * steps (read-only where the status no longer allows edits) but never ahead
 * of what the pipeline has produced.
 */
export function maxReachedStep(status: string): WizardStepN {
  if (status === "curating") return 3;
  if (status === "review" || status === "ready_for_review" || status === "deployed") return 5;
  return 4;
}

/** Status pill map covering ALL v2 statuses (the v1 board only knew five). */
export const V2_STATUS_PILL: Record<string, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "bg-surface-2 text-text-muted" },
  running: { label: "Running", cls: "bg-accent-soft text-accent-ink" },
  planning: { label: "Planning", cls: "bg-accent-soft text-accent-ink" },
  curating: { label: "Awaiting curation", cls: "bg-notready-bg text-notready-fg" },
  building: { label: "Building", cls: "bg-accent-soft text-accent-ink" },
  review: { label: "Ready for review", cls: "bg-notready-bg text-notready-fg" },
  ready_for_review: { label: "Ready for review", cls: "bg-notready-bg text-notready-fg" },
  deployed: { label: "Deployed", cls: "bg-ready-bg text-ready-fg" },
  failed: { label: "Failed", cls: "bg-dropped-bg text-dropped-fg" },
};

export function statusPill(status: string): { label: string; cls: string } {
  return V2_STATUS_PILL[status] ?? V2_STATUS_PILL.queued;
}

/** Curation progress: how many slots have at least one selected image. */
export function slotProgress(slots: ImageSlot[]): { chosen: number; total: number } {
  return {
    chosen: slots.filter((s) => s.selected.length > 0).length,
    total: slots.length,
  };
}
```

- [ ] **Step 4: Run tests → PASS; `npx tsc --noEmit` → clean**

- [ ] **Step 5: Commit**

```bash
git add lib/template-engine/wizard.ts tests/templateWizard.test.ts
git commit -m "feat: wizard step/status derivation helpers"
```

---

### Task 3: Content-edit merge guard (pure) + PATCH content route

**Files:**
- Create: `lib/template-engine/contentEdit.ts`
- Create: `app/api/template-engine/generations/[id]/content/route.ts`
- Test: `tests/contentEdit.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/contentEdit.test.ts
import { describe, it, expect } from "vitest";
import { applyContentEdit } from "@/lib/template-engine/contentEdit";
import { emptyContentModel } from "@/lib/template-engine/contentModel";

const base = () => {
  const m = emptyContentModel("Warrior Contracting");
  m.services = [{ key: "roofing", name: "Roofing", short: "s", long: "l", bullets: ["b"], image_query: "roof" }];
  m.image_briefs = [{ slot_id: "hero-1", kind: "hero", query: "modern home exterior" }];
  m.pages = { "index.html": { title: "Home", meta_description: "d" } };
  return m;
};

describe("applyContentEdit", () => {
  it("applies operator edits to the editable sections", () => {
    const incoming = base();
    incoming.hero.headline_parts = ["Built to last"];
    incoming.identity.tagline = "Contracting done right";
    incoming.services[0].short = "Roofs installed and repaired";
    const out = applyContentEdit(base(), incoming);
    expect(out.hero.headline_parts).toEqual(["Built to last"]);
    expect(out.identity.tagline).toBe("Contracting done right");
    expect(out.services[0].short).toBe("Roofs installed and repaired");
  });

  it("freezes image_briefs and pages no matter what the client sends", () => {
    // Slots are built ONCE in the plan phase; editing briefs would silently
    // desync the curation UI from the queries that produced it. Pages carry
    // per-file section keys the regenerator relies on.
    const incoming = base();
    incoming.image_briefs = [{ slot_id: "hacked", kind: "hero", query: "x" }];
    incoming.pages = {};
    const out = applyContentEdit(base(), incoming);
    expect(out.image_briefs).toEqual(base().image_briefs);
    expect(out.pages).toEqual(base().pages);
  });

  it("preserves each service's key and image_query from the existing model", () => {
    // `key` doubles as the slot id; image_query feeds /more. Both frozen.
    const incoming = base();
    incoming.services[0].key = "renamed";
    incoming.services[0].image_query = "different";
    const out = applyContentEdit(base(), incoming);
    expect(out.services[0].key).toBe("roofing");
    expect(out.services[0].image_query).toBe("roof");
  });

  it("rejects a model that adds or removes services", () => {
    const incoming = base();
    incoming.services = [...incoming.services, { key: "x", name: "X", short: "", long: "", bullets: [], image_query: "x" }];
    expect(() => applyContentEdit(base(), incoming)).toThrow();
  });
});
```

- [ ] **Step 2: Run — fails (module missing)**

Run: `npx vitest run tests/contentEdit.test.ts`

- [ ] **Step 3: Implement `lib/template-engine/contentEdit.ts`**

```ts
/**
 * Merge an operator's content edits into the existing content model without
 * letting them touch the frozen parts (Phase 3, design §10 step 2).
 *
 * Frozen: `image_briefs` + `pages` (slots were built once in the plan phase —
 * brief edits would desync curation; pages carry regenerator section keys),
 * and each service's `key` (doubles as slot id) + `image_query` (feeds /more).
 * Everything else — identity, hero, service copy, stats, testimonials, faq,
 * about — is the operator's to edit. Throws (zod or Error) on invalid input
 * so the route can 422 with detail.
 */
import { contentModelSchema, type ContentModel } from "./contentModel";

export function applyContentEdit(existing: ContentModel, incoming: unknown): ContentModel {
  const parsed = contentModelSchema.parse(incoming); // throws -> route 422s

  // Frozen service fields: match by index (the editor renders existing
  // services in order and cannot add/remove rows - enforce that here).
  if (parsed.services.length !== existing.services.length) {
    throw new Error("Services cannot be added or removed in the editor");
  }
  const services = parsed.services.map((s, i) => ({
    ...s,
    key: existing.services[i].key,
    image_query: existing.services[i].image_query,
  }));

  return {
    ...parsed,
    services,
    image_briefs: existing.image_briefs,
    pages: existing.pages,
  };
}
```

- [ ] **Step 4: Run tests → PASS**

- [ ] **Step 5: Create the PATCH route**

```ts
// app/api/template-engine/generations/[id]/content/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { contentModelSchema } from "@/lib/template-engine/contentModel";
import { applyContentEdit } from "@/lib/template-engine/contentEdit";

// PATCH /api/template-engine/generations/[id]/content - save the operator's
// step-2 edits. Only while the run is paused at `curating` (the build phase
// re-reads content_model, so edits made here flow into the build). Follows
// the curation routes' exact gate order: auth -> perm -> row -> RLS lead -> state.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: gen } = await admin
    .from("template_generations")
    .select("id, lead_id, status, content_model")
    .eq("id", id)
    .maybeSingle();
  if (!gen) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  // RLS check: the user must be able to see the lead this run belongs to.
  const { data: lead } = await supabase.from("leads").select("id").eq("id", gen.lead_id).maybeSingle();
  if (!lead) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  if (gen.status !== "curating") {
    return NextResponse.json({ error: "Not in curation" }, { status: 409 });
  }
  const existing = contentModelSchema.safeParse(gen.content_model);
  if (!existing.success) {
    return NextResponse.json({ error: "Run has no editable content model" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  let next;
  try {
    next = applyContentEdit(existing.data, body);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Invalid content";
    return NextResponse.json({ error: "Invalid content", detail }, { status: 422 });
  }

  // CAS: a concurrent build start must not lose to a save. Supabase returns
  // NO error on a 0-row update, so the row must be selected back — the repo's
  // established pattern (see build/route.ts's curating→building flip).
  const { data: updated, error } = await admin
    .from("template_generations")
    .update({ content_model: next, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "curating")
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!updated) return NextResponse.json({ error: "Not in curation" }, { status: 409 }); // lost the race

  return NextResponse.json({ content_model: next });
}
```

- [ ] **Step 6: `npx tsc --noEmit` → clean; full `npx vitest run` → green**

- [ ] **Step 7: Commit**

```bash
git add lib/template-engine/contentEdit.ts app/api/template-engine/generations/[id]/content/route.ts tests/contentEdit.test.ts
git commit -m "feat: content-model PATCH route with frozen-fields merge guard"
```

---

### Task 4: Generate-input schema — gemini by default, options exposed

**Files:**
- Create: `lib/template-engine/generateInput.ts`
- Modify: `app/api/template-engine/generate/route.ts`
- Test: `tests/generateInput.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/generateInput.test.ts
import { describe, it, expect } from "vitest";
import { generateInputSchema } from "@/lib/template-engine/generateInput";

const base = {
  leadId: "e721febb-8a30-441e-bae0-6835af74d5fd",
  templateId: "c2d638ea-cdd6-4e80-aa80-c89cef2898c7",
  pages: ["index.html"],
};

describe("generateInputSchema", () => {
  it("defaults tool/model to the v2 gemini pipeline when omitted", () => {
    const out = generateInputSchema.parse(base);
    expect(out.tool).toBe("gemini");
    expect(out.model).toBe("gemini-3.1-pro-preview");
  });
  it("defaults options.exclude_people to true", () => {
    expect(generateInputSchema.parse(base).options.exclude_people).toBe(true);
  });
  it("accepts an explicit exclude_people=false", () => {
    const out = generateInputSchema.parse({ ...base, options: { exclude_people: false } });
    expect(out.options.exclude_people).toBe(false);
  });
  it("still accepts explicit v1 tool/model (back-compat)", () => {
    const out = generateInputSchema.parse({ ...base, tool: "webcraft", model: "moonshot-v1-128k" });
    expect(out.tool).toBe("webcraft");
  });
  it("rejects a non-uuid lead, empty pages, empty page string", () => {
    expect(generateInputSchema.safeParse({ ...base, leadId: "nope" }).success).toBe(false);
    expect(generateInputSchema.safeParse({ ...base, pages: [] }).success).toBe(false);
    expect(generateInputSchema.safeParse({ ...base, pages: [""] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run — fails (module missing)**

- [ ] **Step 3: Implement `lib/template-engine/generateInput.ts`**

```ts
/**
 * Body schema for POST /api/template-engine/generate, extracted from the
 * route so it's unit-testable. Phase 3 change: the wizard never shows
 * tool/model pickers — v2 ignores gen.tool/gen.model entirely (runnerV2
 * hardcodes Gemini), but the columns are NOT NULL, so they default here.
 * `options` is new: the only supported knob is exclude_people (design §10
 * step 1 "Exclude photos with people", default ON).
 */
import { z } from "zod";
import { GEMINI_PRO_MODEL } from "@/lib/ai-tools/config";

export const generateInputSchema = z.object({
  leadId: z.string().uuid(),
  templateId: z.string().uuid(),
  pages: z.array(z.string().min(1)).min(1),
  tool: z.string().min(1).default("gemini"),
  model: z.string().min(1).default(GEMINI_PRO_MODEL),
  options: z
    .object({ exclude_people: z.boolean().default(true) })
    .default({ exclude_people: true }),
});

export type GenerateInput = z.infer<typeof generateInputSchema>;
```

- [ ] **Step 4: Run tests → PASS**

- [ ] **Step 5: Rework `app/api/template-engine/generate/route.ts`**

Replace the inline zod schema (lines 14-20) with `import { generateInputSchema } from "@/lib/template-engine/generateInput";` and parse with it (`generateInputSchema.safeParse(body)`, keeping the existing 422 `{error:"Invalid input", issues}` shape). Keep the existing `isToolId(tool)` check (gemini passes). In the `template_generations` insert (lines 96-107), add one field:

```ts
options: parsed.data.options,
```

Everything else (lead RLS lookup, template active check, page validation, estimate, queue insert, kick) stays byte-identical.

- [ ] **Step 6: `npx tsc --noEmit` + full `npx vitest run` → green**

- [ ] **Step 7: Commit**

```bash
git add lib/template-engine/generateInput.ts app/api/template-engine/generate/route.ts tests/generateInput.test.ts
git commit -m "feat: generate API defaults to gemini and accepts exclude_people option"
```

---

### Task 5: Slim the generations list payload

**Files:**
- Modify: `app/api/template-engine/generations/route.ts`

The list route returns `select("*")` for 50 rows — each carrying `image_slots` (dozens of candidates with vision verdicts), `content_model`, and `brief`. The launcher list needs none of those; the wizard always uses the detail route.

- [ ] **Step 1: Replace the select**

```ts
// BEFORE
.select("*")
// AFTER — everything the launcher list renders; jsonb blobs stay on the detail route
.select(
  "id, lead_id, template_id, tool, model, requested_pages, status, current_step, steps, estimate_ms, total_ms, tokens_used, cost_usd, pages_built, images_used, ops_applied, ops_missed, site_slug, zip_path, deployed_url, error, created_at, updated_at"
)
```

- [ ] **Step 2: Check consumers + gates**

Consumers: `TemplateEngineBoard.tsx` (alive until Task 12 — it renders `ops_applied`/`ops_missed` from the LIST payload at lines ~530-531, which is why those two stay in the projection above; only the heavy jsonb columns are dropped) and the new `RunsList` (Task 7). `tsc` cannot catch a dropped field here (the board's fetch is untyped), so re-check the projection against the board's rendered fields before committing. Run `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/template-engine/generations/route.ts
git commit -m "perf: drop heavy jsonb columns from the generations list payload"
```

---

### Task 6: Wizard route + client shell (step rail, detail fetch, realtime poke)

**Files:**
- Create: `app/(app)/ai-tools/template-engine/[genId]/page.tsx`
- Create: `components/template-engine/wizard/GenerationWizard.tsx`

The shell owns: fetching `GET /api/template-engine/generations/[id]`, the realtime poke → refetch loop, the step rail, and routing the active step to the panel components (Tasks 8-11 fill the panels in; until then render simple placeholders so this task compiles and ships alone).

- [ ] **Step 1: Server page**

```tsx
// app/(app)/ai-tools/template-engine/[genId]/page.tsx
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { GenerationWizard } from "@/components/template-engine/wizard/GenerationWizard";

export const dynamic = "force-dynamic";

// One generation's 5-step workspace. The row is loaded client-side (the
// wizard re-fetches live), but we gate + 404 server-side so a bad link never
// mounts the client shell.
export default async function GenerationWizardPage({
  params,
}: {
  params: Promise<{ genId: string }>;
}) {
  const { genId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate") && !perms.has("templates.manage")) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: gen } = await admin
    .from("template_generations")
    .select("id")
    .eq("id", genId)
    .maybeSingle();
  if (!gen) notFound();

  return <GenerationWizard genId={genId} canDeploy={perms.has("templates.deploy")} />;
}
```

- [ ] **Step 2: Client shell**

```tsx
// components/template-engine/wizard/GenerationWizard.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Settings2, FileText, Images, Hammer, MonitorCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/common/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import type { GenStep } from "@/lib/template-engine/types";
import type { ImageSlot } from "@/lib/template-engine/imageSlots";
import type { ContentModel } from "@/lib/template-engine/contentModel";
import {
  WIZARD_STEPS, activeWizardStep, maxReachedStep, statusPill, type WizardStepN,
} from "@/lib/template-engine/wizard";
import { ContentEditor } from "./ContentEditor";
import { ImageCuration } from "./ImageCuration";
import { BuildTracker } from "./BuildTracker";
import { ReviewPanel } from "./ReviewPanel";

// The detail route returns select("*") + template_name/business_name; this is
// the subset the wizard reads. v2 jsonb columns come through as-is.
export type GenerationDetail = {
  id: string;
  lead_id: string;
  template_id: string;
  requested_pages: string[];
  status: string;
  current_step: string | null;
  steps: GenStep[];
  estimate_ms: number | null;
  total_ms: number | null;
  pages_built: number;
  images_used: number;
  site_slug: string | null;
  zip_path: string | null;
  deployed_url: string | null;
  error: string | null;
  created_at: string;
  brief: Record<string, unknown> | null;
  content_model: ContentModel | null;
  image_slots: ImageSlot[] | null;
  options: { exclude_people?: boolean } | null;
  gate_results: { ok: boolean; leaks: unknown[]; structure: { file: string; ok: boolean; detail?: string }[] } | null;
  template_name: string | null;
  business_name: string | null;
};

const STEP_ICONS = [Settings2, FileText, Images, Hammer, MonitorCheck];

export function GenerationWizard({ genId, canDeploy }: { genId: string; canDeploy: boolean }) {
  const [gen, setGen] = useState<GenerationDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStepN | null>(null); // null = follow status
  const [rtTick, setRtTick] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch(`/api/template-engine/generations/${genId}`);
    if (!res.ok) {
      setLoadErr((await res.json().catch(() => ({}))).error ?? "Failed to load generation");
      return;
    }
    const { generation } = await res.json();
    setGen(generation);
  }, [genId]);

  useEffect(() => { load(); }, [load, rtTick]);

  // Realtime is only a poke — data always re-fetches through the REST route.
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const channel = supabase.channel(`rt-tge-wizard-${genId}`);
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "template_generations" }, () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => setRtTick((n) => n + 1), 400);
        })
        .subscribe();
    })();
    return () => { cancelled = true; if (t) clearTimeout(t); supabase.removeChannel(channel); };
  }, [genId]);

  const active: WizardStepN = step ?? (gen ? activeWizardStep(gen.status) : 4);
  const maxStep: WizardStepN = gen ? maxReachedStep(gen.status) : 1;

  // Status changes own the rail: when the pipeline advances (curating→building
  // →review), drop any manual back-navigation and follow it forward again.
  useEffect(() => { setStep(null); }, [gen?.status]);

  if (loadErr) return <EmptyState icon={Hammer} title="Generation unavailable" hint={loadErr} />;
  if (!gen) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const pill = statusPill(gen.status);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/ai-tools/template-engine"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" /> Template Engine
        </Link>
        <h1 className="font-display text-xl font-semibold text-text">
          {gen.business_name ?? "Generation"}
          <span className="ml-2 text-sm font-normal text-text-faint">{gen.template_name}</span>
        </h1>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", pill.cls)}>{pill.label}</span>
      </div>

      {/* Step rail */}
      <ol className="flex flex-wrap gap-2">
        {WIZARD_STEPS.map((s, i) => {
          const Icon = STEP_ICONS[i];
          const reachable = s.n <= maxStep;
          const current = s.n === active;
          return (
            <li key={s.key}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => setStep(s.n as WizardStepN)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  current
                    ? "border-accent bg-accent-soft font-medium text-accent-ink"
                    : reachable
                      ? "border-border bg-surface text-text-muted hover:text-text"
                      : "border-border-subtle bg-surface-2 text-text-faint cursor-not-allowed",
                )}
              >
                <span className={cn(
                  "grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold",
                  current ? "bg-accent text-white" : "bg-surface-2 text-text-faint",
                )}>
                  {s.n}
                </span>
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      {active === 1 && <SetupSummary gen={gen} />}
      {active === 2 && <ContentEditor gen={gen} onSaved={load} />}
      {active === 3 && <ImageCuration gen={gen} onChanged={load} />}
      {active === 4 && <BuildTracker gen={gen} />}
      {active === 5 && <ReviewPanel gen={gen} canDeploy={canDeploy} onChanged={load} />}
    </div>
  );
}

/** Step 1 inside the wizard is a read-only recap — the run was configured on
 *  the launcher and the brief is frozen. */
function SetupSummary({ gen }: { gen: GenerationDetail }) {
  const brief = (gen.brief ?? {}) as Record<string, unknown>;
  const rows: [string, string][] = [
    ["Business", String(brief.business_name ?? gen.business_name ?? "")],
    ["Template", gen.template_name ?? gen.template_id],
    ["Pages", gen.requested_pages.join(", ")],
    ["Services", Array.isArray(brief.services) ? (brief.services as string[]).join(", ") : ""],
    ["Areas", Array.isArray(brief.service_areas) ? (brief.service_areas as string[]).join(", ") : ""],
    ["Exclude people in photos", gen.options?.exclude_people === false ? "No" : "Yes"],
  ];
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-text-faint">Run setup (frozen at creation)</h2>
      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex gap-2 text-sm">
            <dt className="w-44 shrink-0 text-text-muted">{k}</dt>
            <dd className="text-text">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
```

- [ ] **Step 3: Temporary placeholders so this task compiles alone**

Until Tasks 8-11 land, create each panel file with a stub (same directory, same named export, same props) — e.g.:

```tsx
// components/template-engine/wizard/ContentEditor.tsx  (stub — replaced in Task 9)
"use client";
import type { GenerationDetail } from "./GenerationWizard";
export function ContentEditor({ gen, onSaved }: { gen: GenerationDetail; onSaved: () => void }) {
  return <div className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">Content editor arrives in Task 9.</div>;
}
```

Same pattern: `ImageCuration({ gen, onChanged })`, `BuildTracker({ gen })`, `ReviewPanel({ gen, canDeploy, onChanged })`.

- [ ] **Step 4: Gates**

`npx tsc --noEmit` → clean. Manual: `npm run dev`, open `/ai-tools/template-engine/<existing-gen-id>` logged in as Admin — rail renders, status pill correct, SetupSummary shows the frozen brief. (Generation `b516b4ea-e098-490f-afe5-dee4ad65020d` on the shared DB is at `review` — good test data.)

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/ai-tools/template-engine/[genId]/page.tsx" components/template-engine/wizard/
git commit -m "feat: wizard route + shell with status-driven step rail"
```

---

### Task 7: Launcher — SetupPanel + RunsList replace the v1 board

**Files:**
- Create: `components/template-engine/wizard/SetupPanel.tsx`
- Create: `components/template-engine/wizard/RunsList.tsx`
- Modify: `app/(app)/ai-tools/template-engine/page.tsx`

- [ ] **Step 1: SetupPanel**

Design §10 step 1: searchable lead picker **showing real lead data** so the operator sees exactly what will feed the AI; template picker; page checkboxes; exclude-people option.

```tsx
// components/template-engine/wizard/SetupPanel.tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Images as ImagesIcon, Layers, Loader2, Rocket, Search } from "lucide-react";
import { Select } from "@/components/common/Select";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { ChipGroup } from "@/components/forms/ChipGroup";
import { cn } from "@/lib/utils";
import type { TemplateManifest } from "@/lib/template-engine/types";

export type LeadOption = {
  id: string;
  business_name: string;
  services: string[] | null;
  service_areas: string[] | null;
  image_links: string[] | null;
  site_type: string | null;
  color_scheme: string | null;
  status: string;
};
export type TemplateOption = { id: string; name: string; manifest: TemplateManifest; page_count: number };

export function SetupPanel({ leads, templates }: { leads: LeadOption[]; templates: TemplateOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const preselect = useSearchParams().get("lead");
  const [leadId, setLeadId] = useState(() => (leads.some((l) => l.id === preselect) ? preselect! : ""));
  const [query, setQuery] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [pages, setPages] = useState<string[]>([]);
  const [excludePeople, setExcludePeople] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const lead = leads.find((l) => l.id === leadId) ?? null;
  const template = templates.find((t) => t.id === templateId) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? leads.filter((l) => l.business_name.toLowerCase().includes(q)) : leads;
  }, [leads, query]);

  const pageFiles = template?.manifest.pages.map((p) => p.file) ?? [];
  const selectedPages = pages.length ? pages : pageFiles; // default: all template pages

  async function start() {
    if (!leadId || !templateId) return;
    setSubmitting(true);
    const res = await fetch("/api/template-engine/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId,
        templateId,
        pages: selectedPages,
        options: { exclude_people: excludePeople },
      }),
    });
    if (!res.ok) {
      setSubmitting(false);
      toast({ kind: "error", title: "Could not start", body: (await res.json().catch(() => ({}))).error ?? "Generation failed to queue" });
      return;
    }
    const { id } = await res.json();
    router.push(`/ai-tools/template-engine/${id}`);
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-5">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">New generation</h2>

      {/* Lead picker with live search + data preview */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-text-faint" />
            <input
              className={cn(inputCls, "pl-8")}
              placeholder="Search leads by business name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select className={inputCls} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">Select a lead…</option>
            {filtered.map((l) => (
              <option key={l.id} value={l.id}>{l.business_name} — {l.status}</option>
            ))}
          </Select>
        </div>

        {/* What will feed the AI */}
        {lead ? (
          <div className="rounded-md border border-border-subtle bg-surface-2 p-3 text-sm space-y-1.5">
            <p className="font-medium text-text">{lead.business_name}
              {lead.site_type ? <span className="ml-2 text-xs text-text-faint">{lead.site_type}</span> : null}
            </p>
            <p className="text-text-muted"><Layers className="mr-1 inline h-3.5 w-3.5" />{(lead.services ?? []).length} services{lead.services?.length ? `: ${lead.services.slice(0, 6).join(", ")}${lead.services.length > 6 ? "…" : ""}` : ""}</p>
            <p className="text-text-muted">Areas: {(lead.service_areas ?? []).join(", ") || "none"}</p>
            <p className="text-text-muted"><ImagesIcon className="mr-1 inline h-3.5 w-3.5" />{(lead.image_links ?? []).length} client photos{lead.color_scheme ? ` · colors: ${lead.color_scheme}` : ""}</p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-3 text-sm text-text-faint">
            Pick a lead to see exactly what will feed the generator.
          </div>
        )}
      </div>

      {/* Template picker (cards) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setTemplateId(t.id); setPages([]); }}
            className={cn(
              "rounded-md border p-3 text-left transition-colors",
              t.id === templateId ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-accent/50",
            )}
          >
            <p className={cn("text-sm font-medium", t.id === templateId ? "text-accent-ink" : "text-text")}>{t.name}</p>
            <p className="text-xs text-text-muted">{t.page_count} pages</p>
          </button>
        ))}
      </div>

      {/* Page selection */}
      {template ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-text-muted">Pages ({selectedPages.length}/{pageFiles.length} selected — all by default)</p>
          <ChipGroup
            options={pageFiles}
            selected={selectedPages}
            onToggle={(file) =>
              setPages(selectedPages.includes(file) ? selectedPages.filter((f) => f !== file) : [...selectedPages, file])
            }
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={excludePeople} onChange={(e) => setExcludePeople(e.target.checked)} className="h-4 w-4 accent-[--color-accent]" />
          Exclude photos with people
        </label>
        <button
          type="button"
          disabled={!leadId || !templateId || selectedPages.length === 0 || submitting}
          onClick={start}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Start generation
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: RunsList**

```tsx
// components/template-engine/wizard/RunsList.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { RelativeTime } from "@/components/common/RelativeTime";
import { EmptyState } from "@/components/common/EmptyState";
import { TableSkeleton } from "@/components/common/TableSkeleton";
import { statusPill } from "@/lib/template-engine/wizard";
import { cn } from "@/lib/utils";

type Row = {
  id: string; status: string; created_at: string; pages_built: number;
  deployed_url: string | null; error: string | null;
  template_name: string | null; business_name: string | null;
};

export function RunsList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [rtTick, setRtTick] = useState(0);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/template-engine/generations");
      if (res.ok) setRows((await res.json()).generations ?? []);
      else setRows([]);
    })();
  }, [rtTick]);

  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const channel = supabase.channel("rt-tge-runs");
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "template_generations" }, () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => setRtTick((n) => n + 1), 400);
        })
        .subscribe();
    })();
    return () => { cancelled = true; if (t) clearTimeout(t); supabase.removeChannel(channel); };
  }, []);

  if (rows === null) return <TableSkeleton rows={5} cols={4} toolbar={false} />;
  if (rows.length === 0) return <EmptyState icon={History} title="No generations yet" hint="Start one above — it takes about ten minutes end to end." />;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-[10px] uppercase tracking-wider text-text-faint">
            <th className="px-4 py-2.5 font-semibold">Business</th>
            <th className="px-4 py-2.5 font-semibold">Template</th>
            <th className="px-4 py-2.5 font-semibold">Status</th>
            <th className="px-4 py-2.5 font-semibold">Started</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pill = statusPill(r.status);
            return (
              <tr key={r.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-2">
                <td className="px-4 py-2.5">
                  <Link href={`/ai-tools/template-engine/${r.id}`} className="font-medium text-text hover:text-accent-ink">
                    {r.business_name ?? "—"}
                  </Link>
                  {r.error ? <p className="mt-0.5 max-w-md truncate text-xs text-dropped-fg">{r.error}</p> : null}
                </td>
                <td className="px-4 py-2.5 text-text-muted">{r.template_name ?? "—"}</td>
                <td className="px-4 py-2.5"><span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", pill.cls)}>{pill.label}</span></td>
                <td className="px-4 py-2.5 text-text-muted"><RelativeTime iso={r.created_at} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Rework the launcher page**

`app/(app)/ai-tools/template-engine/page.tsx` — keep the exact auth/perm/data pattern, widen the leads select with `site_type, color_scheme` (SetupPanel preview), swap the board for the launcher pair:

```tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { SetupPanel } from "@/components/template-engine/wizard/SetupPanel";
import { RunsList } from "@/components/template-engine/wizard/RunsList";

export const dynamic = "force-dynamic";

export default async function TemplateEnginePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate")) redirect("/dashboard");

  // Cross-team pickers bypass RLS deliberately — safe because the page is perm-gated.
  const admin = createAdminClient();
  const [{ data: leads }, { data: templates }] = await Promise.all([
    admin
      .from("leads")
      .select("id, business_name, services, service_areas, image_links, site_type, color_scheme, status")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("website_templates")
      .select("id, name, manifest, page_count")
      .eq("status", "active")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-xl font-semibold text-text">Template Engine</h1>
      <Suspense fallback={null}>
        <SetupPanel leads={leads ?? []} templates={templates ?? []} />
      </Suspense>
      <RunsList />
    </div>
  );
}
```

(Match the existing file's header markup style when editing — if the current page renders a description line or different heading classes, keep them.)

- [ ] **Step 4: Gates + manual check**

`npx tsc --noEmit` → clean; `npx vitest run` → green. Manual: launcher renders pickers; `?lead=<id>` preselects; starting a run navigates to the wizard where the tracker (stub) shows.

- [ ] **Step 5: Commit**

```bash
git add components/template-engine/wizard/SetupPanel.tsx components/template-engine/wizard/RunsList.tsx "app/(app)/ai-tools/template-engine/page.tsx"
git commit -m "feat: launcher with lead-preview setup panel and v2 runs list"
```

---

### Task 8: Step 4 — BuildTracker (replace stub)

**Files:**
- Modify: `components/template-engine/wizard/BuildTracker.tsx`

Renders the shared `steps` timeline for BOTH phases (plan steps while `planning`, build steps while `building`), the ETA from `estimate_ms`, gate results once present, and the failure state. No new data plumbing — the shell already refetches on realtime pokes.

- [ ] **Step 1: Implement**

```tsx
// components/template-engine/wizard/BuildTracker.tsx
"use client";

import { AlertTriangle, CheckCircle2, Circle, Loader2, MinusCircle } from "lucide-react";
import type { GenStep } from "@/lib/template-engine/types";
import type { GenerationDetail } from "./GenerationWizard";
import { cn } from "@/lib/utils";

function StepIcon({ status }: { status: GenStep["status"] }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-accent-ink" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-accent-ink" />;
  if (status === "failed") return <AlertTriangle className="h-4 w-4 text-dropped-fg" />;
  if (status === "partial") return <MinusCircle className="h-4 w-4 text-notready-fg" />;
  return <Circle className="h-4 w-4 text-text-faint" />;
}

const ACTIVE_STATUSES = new Set(["queued", "running", "planning", "building"]);

export function BuildTracker({ gen }: { gen: GenerationDetail }) {
  const steps = Array.isArray(gen.steps) ? gen.steps : [];
  const running = ACTIVE_STATUSES.has(gen.status);

  return (
    <div className="space-y-4">
      {gen.status === "failed" ? (
        <div className="rounded-md border border-dropped-fg/30 bg-dropped-bg p-4 text-sm text-dropped-fg">
          <p className="font-medium">Generation failed</p>
          <p className="mt-1">{gen.error ?? "Unknown error"}</p>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Pipeline</h2>
          {running && gen.estimate_ms ? (
            <span className="text-xs text-text-faint">Typically ~{Math.round(gen.estimate_ms / 60000)} min</span>
          ) : null}
        </div>
        {steps.length === 0 ? (
          <p className="text-sm text-text-muted">Waiting for the processor to pick this run up…</p>
        ) : (
          <ol className="space-y-2">
            {steps.map((s) => (
              <li key={s.key} className="flex items-start gap-2.5 text-sm">
                <StepIcon status={s.status} />
                <div className="min-w-0 flex-1">
                  <p className={cn("leading-5", s.status === "pending" ? "text-text-faint" : "text-text")}>
                    {s.label}
                    {typeof s.ms === "number" ? <span className="ml-2 text-xs text-text-faint">{(s.ms / 1000).toFixed(1)}s</span> : null}
                  </p>
                  {s.detail ? <p className="truncate text-xs text-text-muted" title={s.detail}>{s.detail}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {gen.gate_results ? (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-text-faint">Verification gates</h2>
          <p className={cn("mb-2 text-sm font-medium", gen.gate_results.ok ? "text-accent-ink" : "text-dropped-fg")}>
            {gen.gate_results.ok ? "All gates passed" : "Gates failed"}
          </p>
          <ul className="space-y-1 text-sm">
            <li className={gen.gate_results.leaks.length === 0 ? "text-text-muted" : "text-dropped-fg"}>
              Demo-identity leak scan: {gen.gate_results.leaks.length === 0 ? "clean" : `${gen.gate_results.leaks.length} leaks`}
            </li>
            {gen.gate_results.structure.map((f) => (
              <li key={f.file} className={f.ok ? "text-text-muted" : "text-dropped-fg"}>
                {f.file}: {f.ok ? "structure preserved" : f.detail ?? "structure changed"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Gates + manual check**

`npx tsc --noEmit` → clean. Manual: open the wizard for a `review`-status run — timeline shows plan + build + verify steps with timings and the gates card; for a fresh run, watch steps tick live while `planning`.

- [ ] **Step 3: Commit**

```bash
git add components/template-engine/wizard/BuildTracker.tsx
git commit -m "feat: wizard build tracker with live steps timeline and gate results"
```

---

### Task 9: Step 2 — ContentEditor (replace stub)

**Files:**
- Modify: `components/template-engine/wizard/ContentEditor.tsx`

A friendly form over `content_model` (design §10 step 2): identity, hero, per-service copy, stats, testimonials, FAQ, about. Editable only while `curating`; read-only banner otherwise. Saves via Task 3's PATCH. `image_briefs`/`pages`/service `key`+`image_query` are never shown (frozen server-side anyway — defense in depth).

- [ ] **Step 1: Implement**

```tsx
// components/template-engine/wizard/ContentEditor.tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock, Save } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { Field, inputCls } from "@/components/forms/Field";
import { DynamicList } from "@/components/forms/DynamicList";
import type { ContentModel } from "@/lib/template-engine/contentModel";
import type { GenerationDetail } from "./GenerationWizard";
import { cn } from "@/lib/utils";

const areaCls = cn(inputCls, "min-h-20 resize-y");

export function ContentEditor({ gen, onSaved }: { gen: GenerationDetail; onSaved: () => void }) {
  const editable = gen.status === "curating";
  const [model, setModel] = useState<ContentModel | null>(gen.content_model);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // A realtime refetch (e.g. build started elsewhere) replaces the row —
  // only adopt the fresh model when the operator has no unsaved base yet.
  useEffect(() => { if (!model && gen.content_model) setModel(gen.content_model); }, [gen.content_model, model]);

  if (!model) {
    return <div className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">No content model yet — the planning step produces it.</div>;
  }

  const set = (patch: Partial<ContentModel>) => setModel({ ...model, ...patch });

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/template-engine/generations/${gen.id}/content`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(model),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast({ kind: "error", title: "Save failed", body: j.detail ?? j.error ?? "Could not save content" });
      return;
    }
    toast({ kind: "success", title: "Content saved", body: "Your edits will be used when the site builds." });
    onSaved();
  }

  return (
    <div className="space-y-5">
      {!editable ? (
        <p className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">
          <Lock className="h-3.5 w-3.5" /> Content is locked once the build starts — this is what the site was built from.
        </p>
      ) : null}

      <fieldset disabled={!editable} className="space-y-5">
        <Card title="Identity">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business name" required>
              <input className={inputCls} value={model.identity.name}
                onChange={(e) => set({ identity: { ...model.identity, name: e.target.value } })} />
            </Field>
            <Field label="Tagline">
              <input className={inputCls} value={model.identity.tagline}
                onChange={(e) => set({ identity: { ...model.identity, tagline: e.target.value } })} />
            </Field>
            <Field label="Positioning" className="sm:col-span-2">
              <textarea className={areaCls} value={model.identity.positioning}
                onChange={(e) => set({ identity: { ...model.identity, positioning: e.target.value } })} />
            </Field>
          </div>
        </Card>

        <Card title="Hero">
          <div className="space-y-3">
            <Field label="Headline parts (rendered as one headline)">
              <DynamicList values={model.hero.headline_parts}
                onChange={(v) => set({ hero: { ...model.hero, headline_parts: v } })}
                placeholder="Headline line" addLabel="Add line" />
            </Field>
            <Field label="Subcopy">
              <textarea className={areaCls} value={model.hero.subcopy}
                onChange={(e) => set({ hero: { ...model.hero, subcopy: e.target.value } })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Primary button"><input className={inputCls} value={model.hero.cta_primary}
                onChange={(e) => set({ hero: { ...model.hero, cta_primary: e.target.value } })} /></Field>
              <Field label="Secondary button"><input className={inputCls} value={model.hero.cta_secondary}
                onChange={(e) => set({ hero: { ...model.hero, cta_secondary: e.target.value } })} /></Field>
            </div>
          </div>
        </Card>

        <Card title={`Services (${model.services.length})`}>
          <div className="space-y-4">
            {model.services.map((svc, i) => (
              <div key={svc.key} className="rounded-md border border-border-subtle p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name">
                    <input className={inputCls} value={svc.name} onChange={(e) => {
                      const services = [...model.services];
                      services[i] = { ...svc, name: e.target.value };
                      set({ services });
                    }} />
                  </Field>
                  <Field label="Short description">
                    <input className={inputCls} value={svc.short} onChange={(e) => {
                      const services = [...model.services];
                      services[i] = { ...svc, short: e.target.value };
                      set({ services });
                    }} />
                  </Field>
                  <Field label="Long description" className="sm:col-span-2">
                    <textarea className={areaCls} value={svc.long} onChange={(e) => {
                      const services = [...model.services];
                      services[i] = { ...svc, long: e.target.value };
                      set({ services });
                    }} />
                  </Field>
                  <Field label="Bullets" className="sm:col-span-2">
                    <DynamicList values={svc.bullets} onChange={(bullets) => {
                      const services = [...model.services];
                      services[i] = { ...svc, bullets };
                      set({ services });
                    }} placeholder="Bullet" addLabel="Add bullet" />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="About">
          <div className="space-y-3">
            <Field label="Story">
              <textarea className={areaCls} value={model.about.story}
                onChange={(e) => set({ about: { ...model.about, story: e.target.value } })} />
            </Field>
            <Field label="Why choose us">
              <DynamicList values={model.about.why_us}
                onChange={(why_us) => set({ about: { ...model.about, why_us } })}
                placeholder="Reason" addLabel="Add reason" />
            </Field>
          </div>
        </Card>

        <Card title={`Testimonials (${model.testimonials.length}) · FAQ (${model.faq.length}) · Stats (${model.stats.length})`}>
          <div className="space-y-4">
            {model.testimonials.map((t, i) => (
              <div key={i} className="grid gap-3 sm:grid-cols-[1fr_200px]">
                <Field label={`Quote ${i + 1}`}>
                  <textarea className={areaCls} value={t.quote} onChange={(e) => {
                    const testimonials = [...model.testimonials];
                    testimonials[i] = { ...t, quote: e.target.value };
                    set({ testimonials });
                  }} />
                </Field>
                <Field label="Name">
                  <input className={inputCls} value={t.name} onChange={(e) => {
                    const testimonials = [...model.testimonials];
                    testimonials[i] = { ...t, name: e.target.value };
                    set({ testimonials });
                  }} />
                </Field>
              </div>
            ))}
            {model.faq.map((f, i) => (
              <div key={i} className="grid gap-3 sm:grid-cols-2">
                <Field label={`Question ${i + 1}`}>
                  <input className={inputCls} value={f.q} onChange={(e) => {
                    const faq = [...model.faq];
                    faq[i] = { ...f, q: e.target.value };
                    set({ faq });
                  }} />
                </Field>
                <Field label="Answer">
                  <input className={inputCls} value={f.a} onChange={(e) => {
                    const faq = [...model.faq];
                    faq[i] = { ...f, a: e.target.value };
                    set({ faq });
                  }} />
                </Field>
              </div>
            ))}
            <div className="grid gap-3 sm:grid-cols-3">
              {model.stats.map((s, i) => (
                <div key={i} className="grid gap-2">
                  <Field label={`Stat ${i + 1} value`}>
                    <input className={inputCls} value={String(s.value)} onChange={(e) => {
                      const stats = [...model.stats];
                      stats[i] = { ...s, value: e.target.value };
                      set({ stats });
                    }} />
                  </Field>
                  <Field label="Label">
                    <input className={inputCls} value={s.label} onChange={(e) => {
                      const stats = [...model.stats];
                      stats[i] = { ...s, label: e.target.value };
                      set({ stats });
                    }} />
                  </Field>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </fieldset>

      {editable ? (
        <div className="flex justify-end">
          <button type="button" onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save content
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-text-faint">{title}</h2>
      {children}
    </section>
  );
}
```

NOTE for the implementer: check `Field`'s actual props — if it has no `className` prop, wrap in a `<div className="sm:col-span-2">` instead. Check `DynamicList`'s exact prop names (`values/onChange/placeholder/addLabel`) against `components/forms/DynamicList` and adjust.

- [ ] **Step 2: Gates + manual check**

`npx tsc --noEmit` → clean. Manual (needs a `curating` run): edit the tagline → Save → toast; reload → edit persisted; confirm the same PATCH 409s once the run is `building` (locked banner shows instead).

- [ ] **Step 3: Commit**

```bash
git add components/template-engine/wizard/ContentEditor.tsx
git commit -m "feat: wizard content editor over the run's content model"
```

---

### Task 10: Step 3 — ImageCuration (replace stub)

**Files:**
- Modify: `components/template-engine/wizard/ImageCuration.tsx`

The centrepiece (design §10 step 3): per-slot thumbnail grid (hero 6 → pick ≤3, service 5 → pick 1), click-to-select, "Show different ones", custom URL with preview, source + no-people indicators, progress, Build button (422 lists unfilled slots).

- [ ] **Step 1: Implement**

```tsx
// components/template-engine/wizard/ImageCuration.tsx
"use client";

import { useState } from "react";
import {
  Check, CircleUserRound, Hammer, ImagePlus, Link2, Loader2, RefreshCw, ShieldCheck,
} from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import type { ImageSlot } from "@/lib/template-engine/imageSlots";
import { slotProgress } from "@/lib/template-engine/wizard";
import type { GenerationDetail } from "./GenerationWizard";
import { cn } from "@/lib/utils";

export function ImageCuration({ gen, onChanged }: { gen: GenerationDetail; onChanged: () => void }) {
  const editable = gen.status === "curating";
  const slots = Array.isArray(gen.image_slots) ? gen.image_slots : [];
  const { chosen, total } = slotProgress(slots);
  const [building, setBuilding] = useState(false);
  const { toast } = useToast();

  async function startBuild() {
    setBuilding(true);
    const res = await fetch(`/api/template-engine/generations/${gen.id}/build`, { method: "POST" });
    setBuilding(false);
    if (res.status === 422) {
      const j = await res.json().catch(() => ({}));
      const names = (j.slots ?? []).map((s: { label: string }) => s.label).join(", ");
      toast({ kind: "error", title: "Pick an image for every slot", body: names || j.error });
      return;
    }
    if (!res.ok) {
      toast({ kind: "error", title: "Could not start build", body: (await res.json().catch(() => ({}))).error ?? "Build failed to queue" });
      return;
    }
    toast({ kind: "success", title: "Build started", body: "Watch it on the Build step." });
    onChanged();
  }

  if (slots.length === 0) {
    return <div className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">No image slots yet — they appear when planning finishes.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          <span className="font-medium text-text">{chosen}/{total}</span> slots chosen
          {editable ? " — every slot needs at least one image before the build" : ""}
        </p>
        {editable ? (
          <button type="button" onClick={startBuild} disabled={building || chosen < total}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
            Build the site
          </button>
        ) : null}
      </div>

      {slots.map((slot) => (
        <SlotGrid key={slot.id} genId={gen.id} slot={slot} editable={editable} onChanged={onChanged} />
      ))}
    </div>
  );
}

function SlotGrid({ genId, slot, editable, onChanged }: {
  genId: string; slot: ImageSlot; editable: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"more" | "select" | "custom" | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const { toast } = useToast();

  async function post(path: string, body?: unknown, kind: "more" | "select" | "custom" = "select") {
    setBusy(kind);
    const res = await fetch(`/api/template-engine/generations/${genId}/images/${slot.id}/${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(null);
    if (!res.ok) {
      toast({ kind: "error", title: "Image update failed", body: (await res.json().catch(() => ({}))).error ?? "Try again" });
      return false;
    }
    onChanged();
    return true;
  }

  function toggle(url: string) {
    if (!editable) return;
    if (slot.selected.includes(url)) {
      post("select", { urls: slot.selected.filter((u) => u !== url) });
      return;
    }
    if (slot.selected.length < slot.pick_max) {
      post("select", { urls: [...slot.selected, url] });
      return;
    }
    if (slot.pick_max === 1) {
      post("select", { urls: [url] }); // single-pick: clicking another image swaps the pick
      return;
    }
    // Multi-pick slot already full — say so instead of silently ignoring the click.
    toast({ kind: "info", title: `This slot allows ${slot.pick_max} images`, body: "Deselect one first to swap." });
  }

  async function addCustom() {
    if (!customUrl.trim()) return;
    if (await post("custom", { url: customUrl.trim() }, "custom")) setCustomUrl("");
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text">
          {slot.label}
          <span className="ml-2 text-xs text-text-faint">
            {slot.kind === "hero" ? `pick up to ${slot.pick_max}` : "pick 1"} · {slot.selected.length} selected
          </span>
        </h2>
        {editable ? (
          <button type="button" onClick={() => post("more", undefined, "more")} disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text disabled:opacity-50">
            {busy === "more" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Show different ones
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {slot.candidates.map((c) => {
          const selected = slot.selected.includes(c.url);
          return (
            <button key={c.url} type="button" onClick={() => toggle(c.url)} disabled={!editable || busy !== null}
              className={cn(
                "group relative aspect-[4/3] overflow-hidden rounded-md border-2 transition-colors",
                selected ? "border-accent" : "border-transparent hover:border-border",
              )}>
              {/* Stock thumbs come from Pexels CDN; plain img keeps it simple */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.thumb || c.url} alt="" loading="lazy" className="h-full w-full object-cover" />
              {selected ? (
                <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-accent text-white">
                  <Check className="h-4 w-4" />
                </span>
              ) : null}
              <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/60 to-transparent p-1.5 text-[10px] text-white">
                {c.source === "client" ? "Client photo" : c.source === "custom" ? "Custom" : c.photographer ?? "Pexels"}
                {c.vision && !c.vision.people ? <ShieldCheck className="h-3 w-3" aria-label="No people detected" /> : null}
                {c.vision?.people ? <CircleUserRound className="h-3 w-3 text-notready-bg" aria-label="People detected" /> : null}
              </span>
            </button>
          );
        })}
        {slot.candidates.length === 0 ? (
          <p className="col-span-full text-sm text-text-faint">No candidates — use "Show different ones" or add a custom URL.</p>
        ) : null}
      </div>

      {editable ? (
        <div className="mt-3 flex items-center gap-2">
          {/* Instant preview of the pasted URL, before the server round-trip */}
          {/^https?:\/\//.test(customUrl.trim()) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={customUrl} src={customUrl.trim()} alt="" className="h-10 w-14 rounded border border-border object-cover"
              onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
          ) : null}
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-text-faint" />
            <input className={cn(inputCls, "pl-8")} placeholder="Custom image URL (https://…)"
              value={customUrl} onChange={(e) => setCustomUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }} />
          </div>
          <button type="button" onClick={addCustom} disabled={busy !== null || !customUrl.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50">
            {busy === "custom" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            Add
          </button>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 2: Gates + manual check (this is the flow that was never login-tested)**

`npx tsc --noEmit` → clean. Manual against a `curating` run: select/deselect updates instantly and survives reload; hero allows 3 then swaps refuse politely; single-pick slots swap on click; "Show different ones" appends fresh candidates (fresh Pexels page); custom URL adds + auto-selects; Build with an empty slot → toast lists the slot label; Build with all slots → run flips to `building`, shell follows to step 4 on the next poke.

- [ ] **Step 3: Commit**

```bash
git add components/template-engine/wizard/ImageCuration.tsx
git commit -m "feat: wizard image curation grids (select/more/custom + build gate)"
```

---

### Task 11: Step 5 — ReviewPanel (replace stub)

**Files:**
- Modify: `components/template-engine/wizard/ReviewPanel.tsx`

Preview iframe over the existing preview route + per-page tabs, gate summary, Download zip, Deploy (only with `templates.deploy`), deployed URL + note that `leads.website_link` was written.

- [ ] **Step 1: Implement**

```tsx
// components/template-engine/wizard/ReviewPanel.tsx
"use client";

import { useMemo, useState } from "react";
import { Download, ExternalLink, Globe, Loader2, Rocket, ShieldCheck, TriangleAlert } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { isDeployableStatus } from "@/lib/template-engine/wizard";
import type { GenerationDetail } from "./GenerationWizard";
import { cn } from "@/lib/utils";

export function ReviewPanel({ gen, canDeploy, onChanged }: {
  gen: GenerationDetail; canDeploy: boolean; onChanged: () => void;
}) {
  const pages = gen.requested_pages ?? [];
  const entry = useMemo(
    () => pages.find((f) => /index|home/i.test(f)) ?? pages[0] ?? "index.html",
    [pages],
  );
  const [page, setPage] = useState(entry);
  const [deploying, setDeploying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { toast } = useToast();
  const ready = isDeployableStatus(gen.status);
  const previewSrc = `/api/template-engine/preview/${gen.id}/${page}`;

  async function deploy() {
    setConfirming(false);
    setDeploying(true);
    const res = await fetch(`/api/template-engine/generations/${gen.id}/deploy`, { method: "POST" });
    setDeploying(false);
    if (!res.ok) {
      toast({ kind: "error", title: "Deploy failed", body: (await res.json().catch(() => ({}))).error ?? "DirectAdmin deploy failed" });
      return;
    }
    const { url } = await res.json();
    toast({ kind: "success", title: "Site deployed", body: `${url} — saved to the lead's website link.` });
    onChanged();
  }

  if (!ready) {
    return <div className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">The review opens when the build finishes.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Gate summary + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {gen.gate_results ? (
          <p className={cn("inline-flex items-center gap-1.5 text-sm font-medium", gen.gate_results.ok ? "text-accent-ink" : "text-dropped-fg")}>
            {gen.gate_results.ok ? <ShieldCheck className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
            {gen.gate_results.ok ? "All verification gates passed" : "Verification gates FAILED — inspect before deploying"}
          </p>
        ) : <span />}
        <div className="flex items-center gap-2">
          <a href={previewSrc} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">
            <ExternalLink className="h-4 w-4" /> Open preview
          </a>
          <a href={`/api/template-engine/generations/${gen.id}/download`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">
            <Download className="h-4 w-4" /> Download zip
          </a>
          {canDeploy ? (
            <button type="button" onClick={() => setConfirming(true)} disabled={deploying}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {deploying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {gen.status === "deployed" ? "Redeploy" : "Deploy"}
            </button>
          ) : null}
        </div>
      </div>

      {gen.deployed_url ? (
        <p className="inline-flex items-center gap-2 rounded-md border border-ready-fg/20 bg-ready-bg px-3 py-2 text-sm text-ready-fg">
          <Globe className="h-4 w-4" /> Live at <a className="underline" href={gen.deployed_url} target="_blank" rel="noreferrer">{gen.deployed_url}</a> — written to the lead's website link.
        </p>
      ) : null}

      {/* Per-page tabs + iframe. Rebuilt pages reference assets relatively, so
          the iframe resolves them under the same preview prefix. */}
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap gap-1 border-b border-border-subtle p-2">
          {pages.map((f) => (
            <button key={f} type="button" onClick={() => setPage(f)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs",
                f === page ? "bg-accent-soft font-medium text-accent-ink" : "text-text-muted hover:text-text",
              )}>
              {f}
            </button>
          ))}
        </div>
        <iframe key={page} src={previewSrc} title={`Preview ${page}`} className="h-[70vh] w-full bg-white" />
      </div>

      {/* Deploy confirm — modal closes only via its buttons (house rule) */}
      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-text">Deploy this site?</h3>
            <p className="mt-2 text-sm text-text-muted">
              It goes live on a public subdomain and the URL is saved to the lead's website link
              {gen.gate_results && !gen.gate_results.ok ? " — and its verification gates FAILED." : "."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">Cancel</button>
              <button type="button" onClick={deploy}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">Deploy</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

NOTE for the implementer: `requested_pages` may include pages the build dropped (pageSelect). If a tab 404s in the iframe that's acceptable for now — or filter tabs to `steps` keys `build:<file>` with status done, which reflects what was actually built:
`const built = gen.steps.filter(s => s.key.startsWith("build:") && s.key.endsWith(".html") && s.status !== "failed").map(s => s.key.slice(6));` — prefer this if simple.

- [ ] **Step 2: Gates + manual check**

`npx tsc --noEmit` → clean. Manual against the `review` run: preview iframe renders index.html with styles (assets are relative); tabs switch pages; Download streams the zip (this exercises Task 1's fix); Deploy hidden without `templates.deploy`. Deploy itself needs a write-capable DirectAdmin key (memory: the current DA login key is READ-ONLY — deploy 502s; test when a new key exists).

- [ ] **Step 3: Commit**

```bash
git add components/template-engine/wizard/ReviewPanel.tsx
git commit -m "feat: wizard review panel with per-page preview, download, deploy"
```

Design intent note: the full per-file gate report intentionally lives on the Build step (reachable via the rail); ReviewPanel shows the pass/fail summary line only.

---

### Task 11b: Reopen for edits (review → curating) — the spec's rebuild loop

**Files:**
- Create: `app/api/template-engine/generations/[id]/reopen/route.ts`
- Modify: `components/template-engine/wizard/ReviewPanel.tsx`

Spec §10 step 5 promises "Edit content" / "Edit images" → back to steps 2/3 → rebuild. Every mutating API requires status `curating`, so Review needs a state transition back. One CAS route does it: `review → curating`. The operator then edits content/images (all existing routes work again) and hits Build (existing CAS `curating → building`). Only `review` runs can reopen — a `deployed` run's live site must not silently desync from its row (redeploy covers post-deploy changes).

- [ ] **Step 1: The route**

```ts
// app/api/template-engine/generations/[id]/reopen/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";

// POST /api/template-engine/generations/[id]/reopen — send a built (but not
// deployed) run back to curation so the operator can edit content/images and
// rebuild (spec §10 step 5's "Edit content"/"Edit images" loop). The previous
// build's zip/preview stay on the row until the next build overwrites them.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("templates.generate")) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: gen } = await admin
    .from("template_generations")
    .select("id, lead_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!gen) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  const { data: lead } = await supabase.from("leads").select("id").eq("id", gen.lead_id).maybeSingle();
  if (!lead) return NextResponse.json({ error: "Generation not found" }, { status: 404 });

  if (gen.status !== "review") {
    return NextResponse.json({ error: "Only a built, undeployed run can be reopened" }, { status: 409 });
  }

  // CAS review -> curating (same pattern as build's curating -> building flip).
  const { data: updated, error } = await admin
    .from("template_generations")
    .update({ status: "curating", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "review")
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!updated) return NextResponse.json({ error: "Only a built, undeployed run can be reopened" }, { status: 409 });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: The button in ReviewPanel**

In the actions cluster (next to Download), visible only when `gen.status === "review"`:

```tsx
// add to the lucide import: PencilLine
{gen.status === "review" ? (
  <button type="button" disabled={reopening} onClick={reopen}
    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50">
    {reopening ? <Loader2 className="h-4 w-4 animate-spin" /> : <PencilLine className="h-4 w-4" />}
    Reopen for edits
  </button>
) : null}
```

with state + handler alongside `deploy()`:

```tsx
const [reopening, setReopening] = useState(false);

async function reopen() {
  setReopening(true);
  const res = await fetch(`/api/template-engine/generations/${gen.id}/reopen`, { method: "POST" });
  setReopening(false);
  if (!res.ok) {
    toast({ kind: "error", title: "Could not reopen", body: (await res.json().catch(() => ({}))).error ?? "Try again" });
    return;
  }
  toast({ kind: "info", title: "Run reopened", body: "Edit content or images, then build again." });
  onChanged(); // status is curating now — the shell's rail follows to step 3
}
```

- [ ] **Step 3: Gates + manual check**

`npx tsc --noEmit` → clean. Manual: on a `review` run, Reopen → wizard lands on Images (editable again), content editor unlocked, change a pick, Build → new zip replaces the old → Review again. Verify a `deployed` run shows no Reopen button and the route 409s.

- [ ] **Step 4: Commit**

```bash
git add "app/api/template-engine/generations/[id]/reopen/route.ts" components/template-engine/wizard/ReviewPanel.tsx
git commit -m "feat: reopen a built run for edits (review -> curating loop)"
```

---

### Task 12: Cutover — delete the v1 board

**Files:**
- Delete: `components/template-engine/TemplateEngineBoard.tsx`

- [ ] **Step 1: Verify nothing imports it**

Run: `grep -rn "TemplateEngineBoard" --include="*.tsx" --include="*.ts" app/ components/ lib/` → only the file itself (the launcher page was repointed in Task 7).

- [ ] **Step 2: Delete + gates**

```bash
git rm components/template-engine/TemplateEngineBoard.tsx
npx tsc --noEmit   # clean
npx vitest run     # green
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove v1 TemplateEngineBoard (replaced by the wizard)"
```

---

### Task 13: End-to-end verification (live, logged in)

No new code. Run the whole journey once on the dev server as Admin (admin@sedsolutions.online):

- [ ] 1. Lead detail → "Generate from template" → launcher preselects the lead.
- [ ] 2. Setup: pick the Warrior lead + "First template", leave all pages + exclude-people ON → Start → wizard opens on Build (planning).
- [ ] 3. Planning finishes (~3 min) → shell auto-advances to Images; all slots have candidates (hero 6, services 5).
- [ ] 4. Content step: change the tagline, Save, reload — persisted.
- [ ] 5. Images: pick 3 hero + 1 per service (test "Show different ones" and one custom URL) → Build.
- [ ] 6. Build finishes (~6 min) → Review: gates green, preview renders, Download works.
- [ ] 6b. Reopen for edits → back to Images (editable), swap one pick, Build again → fresh zip on Review.
- [ ] 7. (When a write-capable DA key exists) Deploy → live URL → lead's `website_link` set + `website_link_added` notification fired.
- [ ] 8. Full gates: `npx tsc --noEmit` + `npx vitest run` green; `npm run build` once (dev server DOWN — machine OOMs otherwise).
- [ ] 9. Commit any fixes, merge branch → main, push.

---

## Execution notes

- Work on branch `template-engine-v2-p3` off `main`.
- Keep the dev server DOWN during `tsc`/`npm run build` (machine OOMs; `.next/dev` type corruption → `rm -rf .next/dev`).
- Headless test-harness (no login) still works for pipeline legs: insert `template_generations` + `template_gen_queue` rows via MCP SQL, POST `/api/template-engine/process` with `x-wge-secret`. The curation/content APIs need a real session — that's what Task 13 covers.
- The shared Supabase DB has a `review`-status generation `b516b4ea-e098-490f-afe5-dee4ad65020d` (Warrior lead) — ready-made test data for Tasks 6, 8, 11.
