# Site Studio Phase 4a — Editable Preview & Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop. Gate 2 — a real, navigable, click-to-edit preview of the generated site — and then a deploy that puts it on a live subdomain through the kept DirectAdmin layer, with `studio_deployments` and a deployments board that lives inside Site Studio.

**Architecture:** The Content Document stays the single source of truth. The preview renders an **annotated build** (slot markers on elements) into a sandboxed iframe; clicking an element edits the *document*, never the markup, and re-renders — so preview editing cannot corrupt a site by construction. The **production build is the default and carries no annotations**, and a test asserts it is byte-identical to what the renderer already produces today. Deploy is a pure handoff: the same `FileMap → zip` the engine already finalizes, handed to `uploadZipAndExtract`, with one live site per lead on a stable subdomain.

**Tech Stack:** Everything 3a/3b used, plus the kept `lib/template-engine/directadmin.ts` primitives (`uploadZipAndExtract`, `clearDocroot`, `docrootFor`, `subFromWebsiteLink`, `createSubdomain`, `subdomainExists`, `deleteSubdomain`, `daConfigured`).

**Spec authority:** `docs/superpowers/specs/2026-07-23-site-studio-design.md` §9 (editable preview & deploy handoff), §10 (`studio_deployments`, buckets), §13 (kept systems). Prior art: the v2 deploy route `app/api/template-engine/generations/[id]/deploy/route.ts` — **read it before Task 8**; it encodes hard-won DirectAdmin behaviour and is the contract we are re-implementing, not importing.

**Scope decisions (locked with the user, recorded so they aren't re-litigated):**
- **Phase 4a builds; Phase 4b cuts over.** SOPs, the acceptance gate, and the two-stage deletion of the old engine are 4b — they're gated on the user's sign-off from a real deployed lead, which cannot happen until 4a ships.
- **Deploy is verified against a throwaway subdomain**, created and torn down by the final task. No client's site is touched during the build.
- **The deployments board moves into Site Studio now** (`/ai-tools/site-studio/deployments`, reading `studio_deployments`), so 4b's cutover can delete the `template-engine` namespace wholesale with no exception carved out. Seeding v2's live deployment rows into `studio_deployments` happens at cutover (4b), per spec §11.3 — this phase only creates the table and writes new rows to it.

**Hard rules:** never import from `lib/template-engine/` **except** the DirectAdmin deploy modules named above (they are the sanctioned kept boundary, spec §13); new DB objects `studio_`-prefixed; targeted vitest; `NODE_OPTIONS=--max-old-space-size=6144` for tsc/build; commit per task with the exact message; do not push; **do not apply the migration or make live DirectAdmin calls until the final task**.

**File structure (new):**

```
supabase/migrations/0055_studio_deployments.sql
lib/site-studio/render/annotate.ts       (annotated-build contract + marker constants)
lib/site-studio/preview/buildPreview.ts  (doc + package -> annotated FileMap for the iframe)
lib/site-studio/run/revert.ts            (per-field revert-to-AI, pure)
lib/site-studio/deploy/slug.ts           (subdomain derivation + reuse rules, pure)
lib/site-studio/deploy/deployRun.ts      (service: zip -> DirectAdmin -> studio_deployments)
app/api/site-studio/runs/[id]/preview/route.ts     (GET annotated page HTML)
app/api/site-studio/runs/[id]/theme/route.ts       (PATCH theme roles)
app/api/site-studio/runs/[id]/revert/route.ts      (POST revert a field to its AI value)
app/api/site-studio/runs/[id]/deploy/route.ts      (POST deploy / redeploy)
app/api/site-studio/deployments/route.ts           (GET list)
app/api/site-studio/deployments/[id]/route.ts      (DELETE takedown)
components/site-studio/RunPreview.tsx    (iframe, page nav, width toggle, edit wiring)
components/site-studio/ThemePanel.tsx    (live theme role colours)
components/site-studio/DeploymentsBoard.tsx
app/(app)/ai-tools/site-studio/deployments/page.tsx
tests/siteStudioAnnotate.test.ts
tests/siteStudioPreviewBuild.test.ts
tests/siteStudioRevert.test.ts
tests/siteStudioDeploySlug.test.ts
tests/siteStudioDeployRun.test.ts
tests/siteStudioPreviewUi.test.tsx
```

---

## The two properties this phase must not break

1. **The production build is unchanged.** Annotation is opt-in; `renderSite(tpl, doc)` with no options must keep producing exactly what it produces today. Task 2 locks this with a byte-equality test against the existing fixtures — if that test ever fails, the deployed sites changed, which is the one thing preview editing is not allowed to do.
2. **One live site per lead.** A lead whose `website_link` already points at a subdomain redeploys **onto that same subdomain**, in place. The v2 route learned this the hard way; `subFromWebsiteLink` exists precisely for it. Getting this wrong strands a client's live site at a dead URL.

---

### Task 1: Migration 0055 — `studio_deployments`

**Files:** Create `supabase/migrations/0055_studio_deployments.sql`

- [ ] **Step 1: Write the migration** (file only — applied in Task 12)

```sql
-- 0055_studio_deployments.sql — Site Studio Phase 4a: deployed sites.
--
-- One row per deployed client site (spec §10). New Site Studio runs write here;
-- at cutover (Phase 4b) v2's live deployment records are seeded into this same
-- table, so the deployments board manages old and new sites through one
-- surface and takedown/redeploy of pre-v3 sites keeps working forever.
--
-- `subdomain` is unique: one live site per subdomain, and the ON CONFLICT path
-- is what makes redeploy idempotent. `lead_id` is NOT unique — a lead's
-- history may include a taken-down site and its replacement — but the partial
-- index below enforces one LIVE site per lead, which is the real invariant.
--
-- RLS: enabled, no policies — service-role routes only, matching every other
-- studio_ table.

create table public.studio_deployments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete set null,
  -- the run that produced this deployment; null for rows seeded from v2 at
  -- cutover, which have no studio run behind them
  run_id uuid references public.studio_runs (id) on delete set null,
  subdomain text not null unique,
  docroot text not null,
  url text not null,
  status text not null default 'live' check (status in ('live','taken_down','failed')),
  -- 'studio' for rows this phase writes, 'v2_import' for cutover-seeded rows,
  -- so a post-mortem can always tell where a site came from
  origin text not null default 'studio' check (origin in ('studio','v2_import')),
  deployed_at timestamptz not null default now(),
  taken_down_at timestamptz,
  deployed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One LIVE site per lead. Taken-down and failed rows accumulate as history.
create unique index studio_deployments_one_live_per_lead
  on public.studio_deployments (lead_id)
  where status = 'live' and lead_id is not null;

create index studio_deployments_status on public.studio_deployments (status, deployed_at desc);
create index studio_deployments_run on public.studio_deployments (run_id);

alter table public.studio_deployments enable row level security;
```

- [ ] **Step 2: Commit** — `git add supabase/migrations/0055_studio_deployments.sql && git commit -m "feat(site-studio): migration 0055 - studio_deployments"`

**Do NOT apply it.** Task 12 applies it, after the pre-flight checks.

---

### Task 2: The annotated build

**Files:** Create `lib/site-studio/render/annotate.ts`; Modify `lib/site-studio/render/renderer.ts`; Test `tests/siteStudioAnnotate.test.ts`

`renderSite` currently has signature `renderSite(tpl: CompiledTemplate, doc: ContentDoc): RenderResult`. Add an optional third parameter.

- [ ] **Step 1: Probe before writing.** Read `lib/site-studio/render/renderer.ts` and determine **how slot values are substituted** — string replacement on the skeleton, or a parsed DOM pass. Report which. The annotation mechanism below assumes you can identify the element enclosing each `{{slot:id}}` token; if the renderer is pure string substitution, use `node-html-parser` (already a dependency, used throughout the compiler) on the *skeleton* to find each token's enclosing element before substitution. **State in your report which mechanism you used.**

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { fixtureZip } from "./helpers/siteStudioFixtures";
import { sampleContentDoc } from "@/lib/site-studio/sample";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { SLOT_ATTR, PAGE_ATTR } from "@/lib/site-studio/render/annotate";

describe("annotated build", () => {
  const { template } = compileTemplate(fixtureZip("plumberpro"), "plumberpro");
  const doc = sampleContentDoc(template.manifest);

  it("PRODUCTION BUILD IS UNCHANGED — no options, and with annotate:false", () => {
    const base = renderSite(template, doc);
    const explicit = renderSite(template, doc, { annotate: false });
    expect(base.ok).toBe(true);
    if (!base.ok || !explicit.ok) return;
    // byte-identical: preview work must never alter a deployed site
    for (const path of Object.keys(base.files)) {
      expect(explicit.files[path]).toEqual(base.files[path]);
    }
  });

  it("production build carries NO annotation attributes at all", () => {
    const r = renderSite(template, doc);
    if (!r.ok) return;
    for (const [path, bytes] of Object.entries(r.files)) {
      if (!path.endsWith(".html")) continue;
      const html = new TextDecoder().decode(bytes);
      expect(html).not.toContain(SLOT_ATTR);
      expect(html).not.toContain(PAGE_ATTR);
    }
  });

  it("annotated build marks every text and image slot with page:slot keys", () => {
    const r = renderSite(template, doc, { annotate: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const home = new TextDecoder().decode(r.files["index.html"]);
    expect(home).toContain(`${PAGE_ATTR}="0"`);
    // every text slot on page 0 is addressable by the SAME key the images
    // route and ImagePicker already use: "${docPageIndex}:${slotId}"
    const pageDef = template.manifest.pages.find((p) => p.id === "index")!;
    for (const slot of pageDef.slots) {
      expect(home).toContain(`${SLOT_ATTR}="0:${slot.id}"`);
    }
  });

  it("annotating does not change the visible text of any slot", () => {
    const plain = renderSite(template, doc);
    const marked = renderSite(template, doc, { annotate: true });
    if (!plain.ok || !marked.ok) return;
    const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(strip(new TextDecoder().decode(marked.files["index.html"])))
      .toBe(strip(new TextDecoder().decode(plain.files["index.html"])));
  });

  it("marks stamped fan-out pages with their own doc index", () => {
    // a stamped page shares a page_id but has its own doc index — the marker
    // must carry the INDEX, or edits from the preview would hit the wrong page
    const multi = { ...doc, pages: [...doc.pages, { ...doc.pages[0], output: "services/x.html" }] };
    const r = renderSite(template, multi as never, { annotate: true });
    if (!r.ok) return;
    expect(new TextDecoder().decode(r.files["services/x.html"])).toContain(`${PAGE_ATTR}="${multi.pages.length - 1}"`);
  });
});
```

- [ ] **Step 3: Implement.** `annotate.ts` exports `export const SLOT_ATTR = "data-ss-slot";`, `export const PAGE_ATTR = "data-ss-page";`, `export const IMAGE_ATTR = "data-ss-image";` plus `export interface RenderOptions { annotate?: boolean }`. In the renderer:
  - Default `annotate` to **false** — production safety is the default, not a flag someone must remember.
  - When annotating: set `PAGE_ATTR="<docPageIndex>"` on the page's `<body>` (or root element); for each **image** slot, set `SLOT_ATTR="<idx>:<slotId>"` and `IMAGE_ATTR` directly on the `<img>` element (unambiguous — the token lives in its `src`); for each **text** slot, if the enclosing element's content is exactly the token, set `SLOT_ATTR` on that element (no DOM change); otherwise wrap the substituted value in `<span data-ss-slot="…">`.
  - **Document the wrapper tradeoff in the file**: a wrapper span can shift `:first-child`/`>` CSS in rare templates, which is why it is preview-only and why the production path never emits one.
- [ ] **Step 4:** PASS. Commit: `feat(site-studio): annotated render build for the editable preview`

---

### Task 3: Preview build service

**Files:** Create `lib/site-studio/preview/buildPreview.ts`; Test `tests/siteStudioPreviewBuild.test.ts`

- [ ] **Step 1: Write the failing tests** for this contract:
  - `buildPreview(tpl, doc, pageIndex)` returns `{ ok: true, html: string } | { ok: false, missing }`: renders the whole site annotated (the renderer is whole-site by design), then returns just that page's HTML.
  - **Asset references are rewritten to the preview route** so the iframe can load CSS/images from the package: every relative `href`/`src` that resolves to a file in the render output becomes `/api/site-studio/runs/{runId}/preview?asset=<path>` — take the `runId` as a parameter and keep the function pure.
  - **Inter-page links become preview navigations**: an `href` pointing at another rendered page becomes `#ss-page-<targetDocIndex>` so the shell intercepts it rather than the iframe navigating away.
  - `asset:` values still present (an unresolved pick) are left alone and reported in a `warnings` array — the preview must render *something*, not refuse; deploy is where that becomes fatal.
  - Pure: same inputs → same output; input doc not mutated.
- [ ] **Step 2: Implement. Step 3:** PASS. Commit: `feat(site-studio): preview build - annotated page html with routed assets`

---

### Task 4: Revert-to-AI

**Files:** Create `lib/site-studio/run/revert.ts`; Modify `lib/site-studio/run/applyWritten.ts`; Test `tests/siteStudioRevert.test.ts`

The document already records provenance per field (`ai` / `operator`). Reverting needs the *previous AI value*, which is currently overwritten by an operator edit.

- [ ] **Step 1: Write the failing tests:**
  - `applyOperatorEdit` now **preserves the prior AI value** in a parallel `ai_backup` map on the page's provenance entry the first time a field flips from `ai` to `operator` (and does NOT overwrite that backup on subsequent operator edits — the backup is the AI's value, not the last value).
  - `revertField(doc, provenance, pageIndex, { slotId | title })` restores the backed-up AI value, flips provenance back to `ai`, and clears the backup. Returns `{ok:false}` when there is no backup (the field was never operator-edited) — never silently no-ops.
  - Pure; input untouched; a revert on one field leaves every other field and page alone.
  - A field the operator edited, reverted, and edited again backs up the ORIGINAL AI value both times.
- [ ] **Step 2: Implement. Step 3:** PASS. Commit: `feat(site-studio): per-field revert to the AI value`

---

### Task 5: Theme editing

**Files:** Create `app/api/site-studio/runs/[id]/theme/route.ts`; extend `tests/siteStudioRevert.test.ts` or add a small pure helper test.

- [ ] **Step 1:** The Content Document already carries `theme: Record<role, hex>` and the schema already validates hex. Add `PATCH /runs/[id]/theme` with body `{ roles: Record<string,string> }`:
  - Validate every value against the schema's hex regex; 422 naming any bad role.
  - Reject roles the template's manifest doesn't declare (422) — a role the renderer won't consume is a silent no-op otherwise.
  - Merge into `content_doc.theme`, CAS on `updated_at` → 409 (same discipline as `/content` and `/images`).
  - Refuse on terminal runs.
- [ ] **Step 2:** `tsc` clean. Commit: `feat(site-studio): live theme role editing`

---

### Task 6: Preview + edit routes

**Files:** Create `app/api/site-studio/runs/[id]/preview/route.ts`, `app/api/site-studio/runs/[id]/revert/route.ts`

- [ ] **Step 1: Implement:**
  - **GET `/preview?page=<docIndex>`** — loads the run + package, calls `buildPreview`, returns `text/html` with **`untrustedContentHeaders("text/html")`** from `lib/site-studio/service/guard` (the CSP-sandbox headers Phase 2a added for exactly this: serving generated HTML into an iframe without granting it same-origin access to the LMS session). Refuse before `prepare` has produced a doc.
  - **GET `/preview?asset=<path>`** — streams one asset from the rendered file map (or the package's assets) with its content type and the same untrusted headers. Reject any `asset` path containing `..` or a leading `/` (path traversal) with 400.
  - **POST `/revert`** — body `{ page_index, slot_id? , title?: true }`; drives Task 4; CAS on `updated_at` → 409; refuse on terminal runs.
- [ ] **Step 2:** `tsc` clean. Commit: `feat(site-studio): preview and revert routes`

---

### Task 7: The preview UI

**Files:** Create `components/site-studio/RunPreview.tsx`, `components/site-studio/ThemePanel.tsx`; Modify `components/site-studio/RunCockpit.tsx` (mount the preview once a run is `ready`); Test `tests/siteStudioPreviewUi.test.tsx`

- [ ] **Step 1: Build to this contract** (follow the 3b component conventions exactly — `RunCockpit`/`RunPageCard`/`ImagePicker` are the precedent):
  - **Iframe** loading `GET /preview?page=N`, `sandbox=""` (defense in depth on top of the server CSP — same posture as 2b's ReviewDrawer).
  - **Page navigation**: a tab/select per doc page (label from `nav_title` or `page_id`, showing `output` for stamped pages). Intercept `#ss-page-N` hash messages from the iframe to follow in-site links.
  - **Width toggle**: mobile (375px) / desktop (full) — a CSS width change on the iframe, not a re-render.
  - **Click-to-edit**: a small injected script in the annotated build posts `{type:"ss-click", key}` to the parent on click of any `[data-ss-slot]`. The shell opens the right editor: text → inline textarea saving via `PATCH /content`; image → the existing `ImagePicker` keyed by the same `"idx:slotId"` string it already uses. **Reuse ImagePicker as-is** — the key convention is identical by design.
  - After any successful edit, re-fetch the preview HTML (the document is the source of truth; the iframe just re-renders).
  - **Revert button** on any field whose provenance is `operator`, calling `POST /revert`; hidden otherwise.
  - **ThemePanel**: one colour input per manifest-declared role, seeded from `content_doc.theme`, saving via `PATCH /theme`, then re-fetching the preview.
  - 409s from any of these: toast the server message verbatim, refetch the run, refresh the preview (the 3b `handleStaleWrite` helper is the precedent — reuse it).
  - **Deploy button** appears when the run is `ready`: confirms, then `POST /deploy` (Task 9), showing the resulting URL on success.
- [ ] **Step 2: Tests** (~6, mount-smoke per the 2b/3b precedent, fetch mocked): preview iframe renders with the right src; page tabs render one per doc page; width toggle changes the iframe width; the revert button shows only for operator-provenance fields; ThemePanel renders one input per declared role; the deploy button appears only when `ready`.
- [ ] **Step 3:** PASS + `tsc`. Commit: `feat(site-studio): gate 2 - editable preview with live theme`

---

### Task 8: Deploy slug rules

**Files:** Create `lib/site-studio/deploy/slug.ts`; Test `tests/siteStudioDeploySlug.test.ts`

Pure, and the single most dangerous logic in the phase — get it wrong and a client's live site moves or is overwritten.

- [ ] **Step 1: Write the failing tests** for `resolveSubdomain({ leadWebsiteLink, siteSlug, daDomain })` → `{ sub: string; reused: boolean }`:
  - An existing `website_link` on the lead that parses to a subdomain of `daDomain` → **that exact sub**, `reused: true` (in-place redeploy — this is the one-live-site-per-lead rule).
  - A `website_link` pointing at an unrelated domain (a client's own domain) → **ignored**, fall back to `siteSlug`, `reused: false`.
  - No `website_link` → `siteSlug`, `reused: false`.
  - The returned sub is always DNS-safe: lowercase, alphanumeric-and-hyphen, no leading/trailing hyphen, ≤63 chars.
  - Empty/garbage `siteSlug` with no link → `{ok:false}`-style refusal (throw or a typed error — your call, but it must not silently produce an empty subdomain and deploy to the domain root).
  - Uses the kept `subFromWebsiteLink` from `lib/template-engine/directadmin` for the parse (sanctioned import).
- [ ] **Step 2: Implement. Step 3:** PASS. Commit: `feat(site-studio): subdomain resolution - one live site per lead`

---

### Task 9: Deploy service + route

**Files:** Create `lib/site-studio/deploy/deployRun.ts`, `app/api/site-studio/runs/[id]/deploy/route.ts`; Test `tests/siteStudioDeployRun.test.ts`

**Read `app/api/template-engine/generations/[id]/deploy/route.ts` first** — it encodes the DirectAdmin behaviours listed in `directadmin.ts:1-23` (use `action=create` not `add`; the modern filemanager upload needs a `dir` param; the HTTPS cert lands 30–60s after creation so verification must be ONE quick check, never a long poll — a 90s poll once got cut off by the proxy and reported a false error on a successful deploy).

- [ ] **Step 1: Write the failing tests** with injected DirectAdmin primitives (`deps: { createSubdomain, subdomainExists, clearDocroot, uploadZipAndExtract, docrootFor }`) and the fake admin, covering:
  - Refuses unless the run is `ready` with a `zip_path`; refuses when `daConfigured()` is false with a clear message.
  - **Resolution**: reuses the lead's existing subdomain (`reused: true` → `clearDocroot` called before upload — an in-place redeploy must not leave orphaned files from the previous site); a fresh deploy creates the subdomain first.
  - `subdomainExists` true + not reused → does NOT create, still clears and uploads (idempotent redeploy).
  - Writes a `studio_deployments` row (`origin:'studio'`, `status:'live'`, subdomain/docroot/url/run_id/lead_id) and **upserts on the subdomain unique index** so a redeploy updates the row rather than erroring.
  - Sets `studio_runs.deployed_url` and the **lead's `website_link`**, and appends an `activity_log` entry — matching v2's behaviour so the leads UI keeps working.
  - A failed upload → `studio_deployments` row `status:'failed'`, the run NOT marked deployed, error surfaced; no partial success claimed.
  - Never throws.
- [ ] **Step 2: Implement** the service, then the route: `POST /runs/[id]/deploy`, `guard()`, `runtime = "nodejs"`, `maxDuration = 300`, a `studio_run_events` entry, and the run's status left `ready` with `deployed_url` set (there is no `deployed` status in the machine — deployment is recorded, not a step).
- [ ] **Step 3:** PASS + `tsc`. Commit: `feat(site-studio): deploy handoff to directadmin with studio_deployments`

---

### Task 10: Deployments board in Site Studio

**Files:** Create `app/api/site-studio/deployments/route.ts`, `app/api/site-studio/deployments/[id]/route.ts`, `components/site-studio/DeploymentsBoard.tsx`, `app/(app)/ai-tools/site-studio/deployments/page.tsx`; Modify `components/site-studio/StudioTabs.tsx` (add the tab)

- [ ] **Step 1: Implement:**
  - **GET `/api/site-studio/deployments`** — rows joined with lead business name, newest first, filterable by `status`.
  - **DELETE `/api/site-studio/deployments/[id]`** — takedown: `deleteSubdomain` (kept primitive), then set `status:'taken_down'` + `taken_down_at`, clear the lead's `website_link` if it matches this URL, `activity_log` entry. If the DirectAdmin call fails, do **not** mark it taken down — report the error (a row claiming a site is gone while it is still live is worse than an error).
  - **Board**: status filter chips (Live / Taken down / Failed), the site URL as an external link, lead name, origin badge (`studio` vs `v2_import` — the latter appears after 4b's cutover seeding), deployed date, takedown with confirm. Server page gates on `studio.manage`, mounts `StudioTabs`.
- [ ] **Step 2:** 2 mount tests appended to `tests/siteStudioPreviewUi.test.tsx` (board renders rows; status filter works). Commit: `feat(site-studio): deployments board inside site studio`

---

### Task 11: End-to-end proof + gates

- [ ] **Step 1: Extend `tests/siteStudioGenerationE2E.test.ts`** with a Gate-2 case, still no DB/network: run through to `ready` (auto mode), then **build the annotated preview** and assert every text slot is addressable by its `idx:slotId` key; **operator-edit a slot through the same merge path the route uses**, rebuild the preview, and assert the new text appears; **revert it** and assert the AI value is back and provenance is `ai` again; finally assert the **production** render of the same doc contains **no annotation attributes** and is byte-identical to a render taken before any preview work.
- [ ] **Step 2: Gates.** `npm test` (full — note the known `tests/personalize.test.ts` parallel-load flake in legacy code; re-run that file alone to confirm if it appears), `tsc --noEmit` clean, `npm run build` succeeds with the new routes and pages in the manifest.
- [ ] **Step 3:** Commit: `test(site-studio): gate 2 preview, edit and revert end to end`

---

### Task 12: Migration + live deploy verification (throwaway subdomain)

**This is the only task that touches production infrastructure. It is gated: do not start it until Tasks 1–11 are committed and green.**

- [ ] **Step 1: Pre-flight, then apply migration 0055** via the Supabase MCP `apply_migration` (project `ikuvbxjkoojtgekapbul` — the user has pre-approved migration application). First run read-only: confirm `studio_deployments` does not already exist, and `select count(*) from studio_runs where status = 'ready'`.
  **Also check for stale compiled packages:** the attribute-escaping fix added `SlotDef.attr`, which only the post-fix compiler sets — a package compiled before it keeps routing `<img alt>` values through the element-text escape, so a quote in alt text corrupts the tag (and an operator-typed `" onmouseover=` would inject a live handler). Run `select id, name, status, compiled_at from studio_templates order by compiled_at;` — **as of 2026-07-26 this returned zero rows, so nothing is affected** — but if any row's `compiled_at` predates commit `269446f`, re-compile that template before it is used for a deploy, and say so in the report. Then apply. Then verify read-only and report actual results: table exists, RLS enabled with zero policies, the `subdomain` unique constraint, the `studio_deployments_one_live_per_lead` partial index, the `status`/`origin` CHECKs.
- [ ] **Step 2: Live deploy against a throwaway subdomain.** Confirm `daConfigured()` and that `DA_DOMAIN` is set. Using a **fixture-generated site** (not a real lead — construct the run row directly, or use a lead only if the user has designated a test lead), deploy to a disposable subdomain named `ss-verify-<short-random>`. Verify with **ONE quick check** (never a poll — the HTTPS cert lands 30–60s later and a long poll has historically been cut off by the proxy and reported a false failure on a successful deploy): fetch the site root, expect the rendered HTML. If the cert isn't ready, an HTTP-level fetch or a single retry after a short wait is acceptable — say exactly what you did.
- [ ] **Step 3: Tear it down** via the takedown route, and verify the `studio_deployments` row is `taken_down` and the subdomain is gone (`subdomainExists` false). **Leave no test subdomain behind.**
- [ ] **Step 4:** `git status --short` clean. Report the deployed URL that existed, the verification response, and the teardown confirmation.

**Phase 4a is complete when** the preview edits and reverts a real generated site, a fixture site deploys to a real subdomain and is torn down cleanly, migration 0055 is applied, and all gates are green. Phase 4b then covers SOPs, the acceptance run on a real lead, cutover, and the two-stage deletion of the old engine.

---

## Self-review notes

- **Spec §9 coverage:** navigable preview + width toggle (T7); annotated build with slot ids (T2); click text → inline edit, click image → picker, theme live (T7, reusing 3b's ImagePicker via the identical key convention); every edit writes the document and re-renders (T7 — markup corruption impossible by construction); per-field revert-to-AI (T4/T6); re-roll per slot/page already shipped in 3b and is reachable from the cockpit; annotation stripped from production builds (T2, byte-equality test); deploy handoff to the kept DirectAdmin layer with stable per-lead subdomain and in-place redeploy (T8/T9); deployed URL on run + lead (T9); deployments board continues to work (T10). **§10:** `studio_deployments` (T1). Zip download already exists from 3b's `/download`.
- **Deferred to 4b with reasons:** SOPs (§12) and cutover/deletion (§11) — both gated on the user's acceptance sign-off, which needs 4a shipped first. Custom-domain transfer (§9) is deferred with the Hostinger token path; it is not on the critical path to acceptance and the spec lists it as one of three deploy outcomes, the other two of which ship here.
- **Type/name consistency:** the `"${docPageIndex}:${slotId}"` slot key is the same string used by 3b's `SlotImageState`, images route, and ImagePicker — T2's markers, T7's click messages, and T6's revert body all use it, so ImagePicker is reused unmodified. `SLOT_ATTR`/`PAGE_ATTR`/`IMAGE_ATTR` are defined once in `annotate.ts` and imported by renderer, preview build, tests, and the injected click script.
- **Risks named for implementers:** the renderer's substitution mechanism must be probed before annotating (T2 Step 1); the wrapper-span CSS tradeoff is documented and preview-only; the DirectAdmin verification must be one quick check, never a poll (T12); and the in-place-redeploy `clearDocroot` step is the difference between a clean redeploy and a site serving a mix of two generations.
