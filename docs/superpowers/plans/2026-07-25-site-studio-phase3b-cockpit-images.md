# Site Studio Phase 3b — Cockpit & Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a face and eyes on the Phase 3a engine: the live generation cockpit (launch → per-page progress → **Gate 1 review with image picks** → approve → render → download) plus the image system — `studio_assets` library, Pexels top-up, client photos, everything rehosted into our own bucket.

**Architecture:** The engine stays the authority; the cockpit is a thin polling client that drives `POST /step` and renders the run row. Gate 1 becomes real: a run whose pages are all written parks at `reviewing` until the operator approves (or `options.auto` skips the park). Image sourcing runs inside the write phase in parallel with the page writes — candidates (library first, Pexels top-up) are persisted on the run and picked by a human at the gate; **only picks are rehosted** (download → `studio-assets` bucket → `studio_assets` row), never candidates. `finalize` resolves picked assets into real files inside the site zip, so a deployed site never depends on a third-party URL. An advancer cron finishes abandoned machine steps but **never crosses a gate**.

**Tech Stack:** Everything Phase 3a used, plus the `studio-assets` bucket. No new npm dependencies — Pexels is plain `fetch`.

**Spec authority:** `docs/superpowers/specs/2026-07-23-site-studio-design.md` §7 (cockpit, gates, advancer, re-roll), §8 (images), §10 (`studio_assets`, buckets, step claims). UI conventions: Phase 2b's board/drawer (`components/site-studio/`, toasts, fetch idiom). Engine contracts: Phase 3a plan + `lib/site-studio/run/`.

**Scope decisions (locked earlier, recorded so they aren't re-litigated):**
- **Rehost, never hot-link.** v2 referenced live Pexels URLs; a rotting URL broke a client site, and the "library" was just bookmarks. Picks are downloaded and stored in our bucket; the deployed zip carries the actual files.
- **No vision AI anywhere in the path.** v2's people-gate auto-rejected >50% of home-service stock and produced empty slots. 3b shows a wide net of candidates and lets the human choose; cheap filters only (dimensions, dedupe).
- **Client photos are first-class but fenced.** A lead's own photos (captured on the run at prepare) are offered FIRST for that lead, stored `kind='client'` with the lead linkage, and never surface for any other client. Stock is shared.
- **Gate 2 (editable preview) is Phase 4.** In 3b, a `ready` run offers the zip via signed URL. Alt text needs nothing new — the compiler already pairs every image slot with a `{id}_alt` text slot the Writer fills.

**Hard rules (unchanged):** never import from or modify `lib/template-engine/`; new DB objects `studio_`-prefixed; targeted vitest; `NODE_OPTIONS=--max-old-space-size=6144` for tsc/build; no dev server; commit per task, exact messages, no pushing; **migration applied only in the final task**.

**File structure (new):**

```
supabase/migrations/0054_studio_assets_and_gate.sql
lib/site-studio/assets/types.ts        (AssetRow, ImageCandidate, PickChoice)
lib/site-studio/assets/pexels.ts       (search client: injectable fetch, retry, never throws)
lib/site-studio/assets/library.ts      (search/insert/use-count against studio_assets)
lib/site-studio/assets/rehost.ts       (URL or bytes → bucket object + asset row)
lib/site-studio/run/imageSource.ts     (per-slot queries + candidate assembly; pure core)
lib/site-studio/run/reroll.ts          (page/slot re-roll honouring provenance; pure core)
lib/site-studio/run/resolveAssets.ts   (asset: refs → FileMap entries + per-depth relative srcs)
app/api/site-studio/runs/[id]/approve/route.ts
app/api/site-studio/runs/[id]/images/route.ts    (POST pick, GET candidates)
app/api/site-studio/runs/[id]/reroll/route.ts
app/api/site-studio/runs/[id]/control/route.ts   (pause / resume / cancel)
app/api/site-studio/runs/[id]/download/route.ts  (signed URL for the zip)
app/api/site-studio/assets/route.ts              (GET search, POST upload)
app/api/site-studio/assets/[id]/route.ts         (DELETE)
app/api/site-studio/advance/route.ts             (secret-guarded advancer cron)
components/site-studio/RunLaunch.tsx    (lead picker + template picker + pages + fan-out)
components/site-studio/RunCockpit.tsx   (the live page: cards, gate, approve, control)
components/site-studio/RunPageCard.tsx  (one page: write state, slots, retry, re-roll)
components/site-studio/ImagePicker.tsx  (candidates grid + library search + client photos + upload)
components/site-studio/AssetLibrary.tsx (library management grid)
components/site-studio/StudioTabs.tsx   (Templates | Runs | Library nav)
app/(app)/ai-tools/site-studio/runs/page.tsx
app/(app)/ai-tools/site-studio/runs/[id]/page.tsx
app/(app)/ai-tools/site-studio/library/page.tsx
tests/siteStudioGateMachine.test.ts
tests/siteStudioPexels.test.ts
tests/siteStudioAssetLibrary.test.ts
tests/siteStudioImageSource.test.ts
tests/siteStudioReroll.test.ts
tests/siteStudioResolveAssets.test.ts
tests/siteStudioGateEngine.test.ts
tests/siteStudioCockpit.test.tsx        (mount smoke tests, 2b precedent)
```

Pure logic under `lib/`, thin routes, components mirroring 2b's conventions. The engine files from 3a (`engine.ts`, `types.ts`, `finalize.ts`, `applyWritten.ts`) are **modified**, not replaced.

---

## The status machine change (read before Task 1 — everything hangs off this)

3a's statuses name the step that JUST completed: `queued → preparing → writing → rendering → ready`. Gate 1 inserts a park between "all pages written" and "render":

```
queued → preparing → [write phase: status stays "preparing" across retries]
       → reviewing   (all pages written + images sourced; Gate 1 open; machine CANNOT advance)
       → approved    (operator hit "Approve & render", or options.auto skipped the park)
       → rendering → ready          (unchanged)
       failed / cancelled           (unchanged, terminal)
```

`writing` becomes dead: in 3a it was only ever set at the moment the write phase fully completed (partial writes stay `preparing`), and that moment now produces `reviewing` or `approved` instead. The table is empty in prod (no cockpit existed), so the migration can drop `writing` from the CHECK outright — no data to migrate. `nextStep("reviewing")` is `null` **by design**: a gate is not a machine step, and that single `null` is what makes it structurally impossible for the advancer cron to blow through a review.

`paused` is a boolean column, not a status — Stop/Pause/Resume are flags checked between steps (spec §7), and a paused run must remember where it was.

---

### Task 1: Migration 0054 — `studio_assets`, gate statuses, pause flag

**Files:** Create `supabase/migrations/0054_studio_assets_and_gate.sql`

- [ ] **Step 1: Write the migration** (file only — applied in Task 12)

```sql
-- 0054_studio_assets_and_gate.sql — Site Studio Phase 3b: image library + Gate 1.
--
-- studio_assets is the persistent, human-curated image library (spec §8):
-- every operator-approved image lands here and feeds future runs — library
-- first, Pexels top-up second, NO vision AI in the critical path. Assets are
-- REHOSTED (bytes in our studio-assets bucket), never hot-linked: v2
-- referenced live Pexels URLs and a rotted URL broke a deployed client site.
--
-- kind='client' rows belong to one lead (lead_id set) and must never be
-- offered to any other client; kind='stock' is shared. Enforced by a CHECK
-- here and by every library query filtering (kind = 'stock' or lead_id = X).

create table public.studio_assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('stock','client')),
  -- client-owned assets MUST carry their lead; stock MUST NOT
  lead_id uuid references public.leads (id) on delete set null,
  constraint studio_assets_client_needs_lead
    check ((kind = 'client') = (lead_id is not null)),
  subject text not null default '',
  niche_tags text[] not null default '{}',
  width int not null,
  height int not null,
  source text not null check (source in ('pexels','upload','client_link')),
  pexels_id bigint,
  photographer text,
  storage_path text not null,
  content_type text not null,
  use_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- one library row per Pexels photo — re-picking the same photo reuses the row
create unique index studio_assets_pexels on public.studio_assets (pexels_id)
  where pexels_id is not null;
create index studio_assets_kind_subject on public.studio_assets (kind, subject);
create index studio_assets_lead on public.studio_assets (lead_id) where lead_id is not null;

alter table public.studio_assets enable row level security;

insert into storage.buckets (id, name, public)
values ('studio-assets', 'studio-assets', false)
on conflict (id) do nothing;

-- ---- Gate 1 statuses ------------------------------------------------------
-- 'writing' was only ever assigned at the instant the write phase fully
-- completed; that instant now parks at 'reviewing' (Gate 1) or skips to
-- 'approved' (auto mode). The table is empty pre-cockpit, so the CHECK can
-- simply be replaced. The one-active-per-lead partial index must be recreated
-- to cover the new active statuses, and 'paused' is a flag, not a status —
-- a paused run must remember exactly where it was.

alter table public.studio_runs drop constraint studio_runs_status_check;
alter table public.studio_runs add constraint studio_runs_status_check
  check (status in ('queued','preparing','reviewing','approved','rendering','ready','failed','cancelled'));

drop index public.studio_runs_one_active_per_lead;
create unique index studio_runs_one_active_per_lead
  on public.studio_runs (lead_id)
  where status in ('queued','preparing','reviewing','approved','rendering');

alter table public.studio_runs add column paused boolean not null default false;
```

*(The generated CHECK constraint name `studio_runs_status_check` is Postgres's default for an inline column check on `status`; the implementer must verify it against the live catalog in Task 12's apply step — if it differs, adjust the migration before applying, not after.)*

- [ ] **Step 2: Commit** — `git add supabase/migrations/0054_studio_assets_and_gate.sql && git commit -m "feat(site-studio): migration 0054 - asset library, gate statuses, pause flag"`

---

### Task 2: Gate statuses in the run types

**Files:** Modify `lib/site-studio/run/types.ts`; Test `tests/siteStudioGateMachine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { RUN_STATUSES, nextStep, isTerminal, canCancel, awaitingGate, RUNNING_STATUS } from "@/lib/site-studio/run/types";

describe("gate-aware step machine", () => {
  it("declares the 3b statuses (writing is gone; reviewing/approved exist)", () => {
    expect(RUN_STATUSES).toEqual(["queued","preparing","reviewing","approved","rendering","ready","failed","cancelled"]);
  });
  it("walks the machine steps: queued→prepare, preparing→write, approved→render, rendering→finalize", () => {
    expect(nextStep("queued")).toBe("prepare");
    expect(nextStep("preparing")).toBe("write");
    expect(nextStep("approved")).toBe("render");
    expect(nextStep("rendering")).toBe("finalize");
  });
  it("REVIEWING is a park: no machine step may advance it — only the approve action", () => {
    expect(nextStep("reviewing")).toBeNull();
    expect(awaitingGate("reviewing")).toBe(true);
    expect(awaitingGate("preparing")).toBe(false);
  });
  it("terminal statuses are unchanged and cancellable set includes the gate", () => {
    for (const s of ["ready","failed","cancelled"] as const) expect(isTerminal(s)).toBe(true);
    expect(canCancel("reviewing")).toBe(true);
    expect(canCancel("approved")).toBe(true);
    expect(canCancel("ready")).toBe(false);
  });
  it("RUNNING_STATUS has no entry pointing at the dead 'writing' status", () => {
    expect(Object.values(RUNNING_STATUS)).not.toContain("writing");
  });
});
```

Run: `npx vitest run tests/siteStudioGateMachine.test.ts` — FAIL (writing still present, no `awaitingGate`).

- [ ] **Step 2: Implement.** In `types.ts`: replace `"writing"` in `RUN_STATUSES` with `"reviewing","approved"` (order as tested); `nextStep`: `queued→"prepare"`, `preparing→"write"`, `approved→"render"`, `rendering→"finalize"`, everything else `null`; add `export const awaitingGate = (s: RunStatus): boolean => s === "reviewing";`; update `RUNNING_STATUS` (`prepare:"preparing"`, `write:"preparing"`, `render:"rendering"`, `finalize:"rendering"` — write's running status is `preparing` because that's the status the row holds while pages are still being written, matching 3a's actual behaviour); extend `StudioRunRow` with `paused: boolean`; extend `RunSteps` with `images?: { slots: Record<string, SlotImageState> }` and add
  ```ts
  export interface SlotImageState {
    query: string;
    candidates: import("../assets/types").ImageCandidate[];
    sourced_at: string;
  }
  ```
  Keep the existing "status names the step that JUST completed" comment and extend it with the gate paragraph from this plan's header. **`tests/siteStudioRunTypes.test.ts` (3a) will now fail — update its expectations to the new machine in the same commit; its intent (the machine is explicit and total) is unchanged.**
- [ ] **Step 3:** Both test files PASS. Commit: `feat(site-studio): gate statuses - reviewing parks the machine, approved releases it`

---

### Task 3: Asset types + the Pexels client

**Files:** Create `lib/site-studio/assets/types.ts`, `lib/site-studio/assets/pexels.ts`; Test `tests/siteStudioPexels.test.ts`

- [ ] **Step 1: `types.ts`** (no test — pure declarations):

```ts
export interface AssetRow {
  id: string;
  kind: "stock" | "client";
  lead_id: string | null;
  subject: string;
  niche_tags: string[];
  width: number;
  height: number;
  source: "pexels" | "upload" | "client_link";
  pexels_id: number | null;
  photographer: string | null;
  storage_path: string;
  content_type: string;
  use_count: number;
  created_at: string;
}

/** One option shown to the operator at Gate 1. Library candidates already
 *  live in our bucket; pexels candidates are hot-linked THUMBNAILS ONLY —
 *  nothing is rehosted until a human picks it. */
export type ImageCandidate =
  | { kind: "library"; asset_id: string; thumb_path: string; width: number; height: number; subject: string }
  | { kind: "pexels"; pexels_id: number; thumb_url: string; download_url: string; width: number; height: number; photographer: string };

export type PickChoice =
  | { kind: "library"; asset_id: string }
  | { kind: "pexels"; pexels_id: number; download_url: string; width: number; height: number; photographer: string; subject: string }
  | { kind: "client"; url: string; subject: string };
```

- [ ] **Step 2: Write the failing Pexels test.** The v2-verified contract: endpoint `GET https://api.pexels.com/v1/search?query=…&per_page=…`, header `Authorization: <PEXELS_API_KEY>` (**no `Bearer` prefix**), retry up to 3 attempts on 429/5xx, **never throws**. Injectable `fetch` so tests are offline.

```ts
import { describe, it, expect, vi } from "vitest";
import { searchPexels } from "@/lib/site-studio/assets/pexels";

const photo = (id: number) => ({
  id, width: 4000, height: 2600, photographer: "Ana",
  src: { large2x: `https://images.pexels.com/${id}/large2x.jpg`, large: `https://images.pexels.com/${id}/large.jpg`, medium: `https://images.pexels.com/${id}/medium.jpg` },
});
const okResponse = (ids: number[]) =>
  new Response(JSON.stringify({ photos: ids.map(photo) }), { status: 200 });

describe("searchPexels", () => {
  it("calls the v1 search endpoint with the raw-key Authorization header", async () => {
    const f = vi.fn(async () => okResponse([1]));
    await searchPexels("plumber van", { apiKey: "K", perPage: 12, fetchImpl: f });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://api.pexels.com/v1/search");
    expect(url).toContain("query=plumber+van");
    expect(url).toContain("per_page=12");
    expect((init.headers as Record<string, string>).Authorization).toBe("K"); // no "Bearer"
  });
  it("maps photos to pexels candidates (medium thumb, large2x download)", async () => {
    const r = await searchPexels("q", { apiKey: "K", fetchImpl: async () => okResponse([7]) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidates[0]).toMatchObject({ kind: "pexels", pexels_id: 7, photographer: "Ana" });
    expect(r.candidates[0].thumb_url).toContain("medium");
    expect(r.candidates[0].download_url).toContain("large2x");
  });
  it("retries on 429 then succeeds; never more than 3 attempts", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(okResponse([1]));
    const r = await searchPexels("q", { apiKey: "K", fetchImpl: f, delayMs: 0 });
    expect(r.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("NEVER throws: exhausted retries, network error, and missing key all return ok:false", async () => {
    const exhausted = await searchPexels("q", { apiKey: "K", delayMs: 0, fetchImpl: async () => new Response("", { status: 500 }) });
    expect(exhausted.ok).toBe(false);
    const network = await searchPexels("q", { apiKey: "K", fetchImpl: async () => { throw new Error("boom"); } });
    expect(network.ok).toBe(false);
    const noKey = await searchPexels("q", { apiKey: "", fetchImpl: async () => okResponse([1]) });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.error).toMatch(/PEXELS_API_KEY/);
  });
  it("does not retry a 4xx that isn't 429", async () => {
    const f = vi.fn(async () => new Response("", { status: 403 }));
    const r = await searchPexels("q", { apiKey: "K", fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Implement `pexels.ts`.**

```ts
import type { ImageCandidate } from "./types";

interface PexelsOpts {
  apiKey?: string;              // default process.env.PEXELS_API_KEY
  perPage?: number;             // default 9
  fetchImpl?: typeof fetch;     // default global fetch
  delayMs?: number;             // backoff base, default 400 (tests pass 0)
}
export type PexelsResult =
  | { ok: true; candidates: Extract<ImageCandidate, { kind: "pexels" }>[] }
  | { ok: false; error: string };

/** Pexels search. Contract carried over from the v2 integration (verified in
 *  prod): raw key in Authorization (no Bearer), retry 3x on 429/5xx, and it
 *  NEVER throws — image sourcing is an enhancement, and a Pexels outage must
 *  degrade to "no stock candidates", never to a failed run. */
export async function searchPexels(query: string, opts: PexelsOpts = {}): Promise<PexelsResult> {
  const apiKey = opts.apiKey ?? process.env.PEXELS_API_KEY ?? "";
  if (!apiKey) return { ok: false, error: "PEXELS_API_KEY is not set" };
  const f = opts.fetchImpl ?? fetch;
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query).replace(/%20/g, "+")}&per_page=${opts.perPage ?? 9}`;
  const delay = opts.delayMs ?? 400;

  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response;
    try {
      res = await f(url, { headers: { Authorization: apiKey } });
    } catch (e) {
      return { ok: false, error: `pexels network error: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (res.ok) {
      try {
        const body = (await res.json()) as { photos?: Array<{ id: number; width: number; height: number; photographer?: string; src?: Record<string, string> }> };
        const candidates = (body.photos ?? []).map((p) => ({
          kind: "pexels" as const,
          pexels_id: p.id,
          thumb_url: p.src?.medium ?? p.src?.large ?? "",
          download_url: p.src?.large2x ?? p.src?.large ?? "",
          width: p.width,
          height: p.height,
          photographer: p.photographer ?? "",
        })).filter((c) => c.thumb_url && c.download_url);
        return { ok: true, candidates };
      } catch {
        return { ok: false, error: "pexels returned unparseable JSON" };
      }
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 3) return { ok: false, error: `pexels HTTP ${res.status}` };
    await new Promise((r) => setTimeout(r, delay * attempt));
  }
  return { ok: false, error: "unreachable" };
}
```

- [ ] **Step 4:** PASS. Commit: `feat(site-studio): pexels search client - raw-key auth, bounded retry, never throws`

---

### Task 4: Library service + rehost

**Files:** Create `lib/site-studio/assets/library.ts`, `lib/site-studio/assets/rehost.ts`; Test `tests/siteStudioAssetLibrary.test.ts`

Both take `admin` (the Supabase service client) as their first argument, like `lib/site-studio/service/templates.ts`. Tests use an extended `tests/helpers/fakeStudioAdmin.ts` (add a `studio_assets` table + an `insert()` that returns the row and honours the pexels_id unique index, and a fake `studio-assets` bucket — extending the existing helper, matching its style).

- [ ] **Step 1: Write the failing tests**, covering this contract:
  - `searchLibrary(admin, { subject?, leadId?, kinds?, limit? })` returns rows where **`kind='stock'` OR `lead_id = leadId`** — a probe inserts a `client` asset for lead A and asserts a search scoped to lead B never returns it (this is the fence; test it from both sides). Subject filtering is `ilike %subject%`; newest first; default limit 60.
  - `insertAsset(admin, fields)` inserts and returns the row; inserting a second asset with the same `pexels_id` returns the EXISTING row instead of erroring (upsert-by-pexels_id semantics — re-picking the same photo for a second client must reuse the stored bytes, not duplicate them).
  - `bumpUseCount(admin, assetId)` increments `use_count`.
  - `rehostFromUrl(admin, url, meta, fetchImpl?)`:
    - downloads the URL (injectable fetch), REFUSES non-`image/*` content types and bodies over 15 MB with `{ok:false, error}` — never throws;
    - uploads bytes to `studio-assets` at `` `${assetId}.${extFromContentType}` `` and inserts the row (`storage_path`, `content_type`, dimensions/subject/kind/lead_id/source/pexels_id from `meta`);
    - a storage upload failure surfaces `{ok:false}` **and does not leave an orphan row** (insert happens only after a successful upload);
    - passing `meta.pexels_id` that already exists short-circuits: no download, returns the existing row (`reused: true`).
- [ ] **Step 2: Implement.** `library.ts` ≈ 60 lines; `rehost.ts` ≈ 80. Extension map: `image/jpeg→jpg, image/png→png, image/webp→webp, image/avif→avif`, anything else refused. `rehostFromUrl` returns `{ok:true, asset: AssetRow, reused: boolean} | {ok:false, error: string}`.
- [ ] **Step 3:** PASS. Commit: `feat(site-studio): asset library and rehost - client fence, pexels dedupe, no orphan rows`

---

### Task 5: Image sourcing

**Files:** Create `lib/site-studio/run/imageSource.ts`; Test `tests/siteStudioImageSource.test.ts`

The pure core decides **what to search for**; the effectful wrapper gathers candidates. Runs inside the write phase (Task 7) in parallel with page writes — sourcing never blocks or fails a run.

- [ ] **Step 1: Write the failing tests** for this contract:
  - `imageSlotQueries(manifest, doc, dossier)` → `Array<{ key: string; page_id: string; slot_id: string; query: string }>` where `key = "${docPageIndex}:${slot_id}"`, one entry per **image** slot in each doc page:
    - query = `[semantic hint or subject words from the slot's sample filename] + [client trade noun]`. Trade noun: derived from `dossier.site_type`/`services[0]` (e.g. services `["Drain Cleaning"]` → "plumbing"? NO — never guess a trade taxonomy: use `dossier.site_type` if present else the first service phrase verbatim, lowercased). Sample filename words: `img/team-photo.jpg` → "team photo".
    - Identical queries are deduped in the RESULT (both slots keep entries, `query` shared) — the wrapper must issue each distinct query once.
    - Deterministic: same inputs, same output, stable order (doc order).
  - `sourceImages(deps, manifest, doc, dossier, leadId)` (deps = `{ admin, searchPexels, log }`) returns `Record<key, SlotImageState>`:
    - library candidates first (via `searchLibrary` scoped `stock OR leadId`, subject = the query), then Pexels top-up only when the library yields fewer than 4, to a total cap of 9 per slot;
    - cheap filters on Pexels results only: `width >= 1200 && height >= 800`, dedupe by `pexels_id` across the whole run;
    - a Pexels failure (`ok:false`) logs one warn and produces library-only candidates — **the return value is always complete** (every key present, possibly with `candidates: []`);
    - never throws.
- [ ] **Step 2: Implement** (~120 lines, pure core + thin wrapper). **Step 3:** PASS. Commit: `feat(site-studio): image sourcing - library first, pexels top-up, cheap filters only`

---

### Task 6: Re-roll

**Files:** Create `lib/site-studio/run/reroll.ts`; Test `tests/siteStudioReroll.test.ts`

- [ ] **Step 1: Write the failing tests** for this contract:
  - `rerollPage(deps, run, docPageIndex)` re-runs `writePage` for that page (same prompt path as the engine) and applies the result **only to fields whose provenance is NOT `"operator"`** — an operator's hand-edited headline survives a whole-page re-roll (spec §7: "AI-written fields only unless explicitly confirmed"). With `{ includeOperatorFields: true }` it overwrites everything.
  - `rerollSlot(deps, run, docPageIndex, slotId)` re-runs the page write but applies ONLY the named slot (the Writer writes whole pages — one call — but the merge cherry-picks; cheap and honest). Refuses (`ok:false`) if that slot's provenance is `"operator"` and `includeOperatorFields` is not set.
  - Both refuse when the run is not at the gate (`status !== "reviewing"`) — re-roll is a Gate 1 activity in 3b.
  - A failed write (`ok:false` from the model) leaves the doc untouched and reports the error.
- [ ] **Step 2: Implement** reusing `writePage` + a provenance-aware variant of the merge in `applyWritten.ts` (add `applyRewrite(doc, provenance, pageIndex, result, { onlySlot?, includeOperatorFields? })` there — pure, tested alongside). **Step 3:** PASS. Commit: `feat(site-studio): granular re-roll - page or slot, operator edits survive by default`

---

### Task 7: Engine — gate park, parallel sourcing, pause

**Files:** Modify `lib/site-studio/run/engine.ts`; Test `tests/siteStudioGateEngine.test.ts` (new; existing `siteStudioEngine.test.ts` updated where transitions changed)

- [ ] **Step 1: Write the failing tests:**
  - **Write completion parks at the gate:** happy-path write step (all pages written, sourcing done) leaves `status: "reviewing"`; a subsequent `runStep` returns without doing anything (`nextStep` is null) — the machine cannot cross the gate.
  - **Auto mode skips the park:** same scenario with `options.auto: true` → `status: "approved"`, and the next `runStep` renders.
  - **Sourcing runs alongside writes and cannot fail the run:** deps with a `searchPexels` that always returns `ok:false` → run still reaches `reviewing`, `steps.images.slots` populated with library-only/empty candidates, one warn event.
  - **Pause is respected between steps:** `paused: true` → `runStep` returns `{done:false, paused:true}` immediately, no claim, no AI call (spy asserts 0).
  - **Cancel from the gate:** the control path sets `cancelled` from `reviewing` (via `canCancel`) — engine treats it as terminal.
  - Existing 3a behaviours re-asserted after the change: per-page retry isolation, stuck-page → run `failed`, CAS claim, finalize re-rendering.
- [ ] **Step 2: Implement in `engine.ts`:**
  - `runWrite` gains `Promise.all([writes, sourceImagesOnce()])` where `sourceImagesOnce` fills `steps.images` only if absent (idempotent — a re-run after a crash must not re-query Pexels for slots already sourced); on full completion sets `status: run.options.auto ? "approved" : "reviewing"` and appends a `gate_opened` (or `gate_skipped_auto`) event.
  - `runStep` checks `row.paused` before claiming.
  - The claim/CAS, retry bookkeeping, and failure paths from 3a are untouched.
- [ ] **Step 3:** New + updated suites PASS (`siteStudioEngine`, `siteStudioGateEngine`, and the 3a E2E — which needs its expected post-write status updated from the old machine; its acceptance assertions are unchanged). Commit: `feat(site-studio): engine parks at gate 1, sources images in parallel, honours pause`

---

### Task 8: Asset resolution into the site zip

**Files:** Create `lib/site-studio/run/resolveAssets.ts`; Modify `lib/site-studio/run/finalize.ts`; Test `tests/siteStudioResolveAssets.test.ts`

A picked image slot holds `asset:{uuid}`. The deployed site must carry the actual file — never a bucket URL, never a Pexels URL.

- [ ] **Step 1: Write the failing tests:**
  - `resolveAssets(deps, doc)` (deps = `{ loadAssetBytes(assetId): Promise<{bytes, contentType, storagePath} | null> }`):
    - returns `{ doc: resolvedDoc, files: Record<string, Uint8Array>, missing: string[] }`;
    - every slot value matching `^asset:` is fetched once (two slots picking the same asset → one file), written into `files` at `` `img/studio/${assetId}.${ext}` ``, and the slot value rewritten to a **depth-correct relative path**: `img/studio/x.jpg` for a root page, `../img/studio/x.jpg` for a page whose `output` is `services/drain-cleaning.html` (depth = number of `/` in the output path);
    - non-asset slot values (template sample paths, empty) are untouched;
    - an asset that fails to load lands in `missing` and the slot keeps its `asset:` value — the caller decides;
    - pure apart from the injected loader; input doc not mutated.
  - `finalize` integration: a doc with one picked asset produces a zip whose FileMap contains the image bytes at `img/studio/…` and whose HTML references the relative path; `missing.length > 0` fails the run with the asset ids named (a site must never ship with a dangling `asset:` src).
  - **Depth probe for template-sample paths on stamped pages:** render a stamped page (`output: "services/x.html"`) whose image slot still holds the template sample `img/hero.jpg` and CHECK whether the rendered HTML resolves correctly (the renderer may already rewrite relative asset references per depth — the compiler/renderer handle template assets; probe, don't assume). If it does NOT, extend `resolveAssets` to also depth-adjust bare template-relative image slot values on nested pages, and say so in the report. *(This is a known open question from 3a — the fixture's stamped pages were never rendered with images checked.)*
- [ ] **Step 2: Implement** (~90 lines). `finalize.ts` calls `resolveAssets` after its render, merges `files` into the FileMap before zipping. **Step 3:** PASS. Commit: `feat(site-studio): picked assets resolve to real files in the site zip`

---

### Task 9: Routes — gate actions, images, control, library, advancer

**Files:** Create the 8 route files listed in the structure; Modify none of 3a's routes.

All follow the Phase 2a idiom: `guard()`/`guardError()`, `createAdminClient`, `runtime = "nodejs"`, async `params`, activity_log on state changes, `studio_run_events` on run actions. No route unit tests (repo convention); `tsc` + build are the gate.

- [ ] **Step 1: Implement, with these behaviours:**
  - **POST `/runs/[id]/approve`** — 409 unless `status === "reviewing"`; sets `approved` (CAS on status: `.eq("status","reviewing")`, zero rows → 409 "already advanced"); appends `gate_closed` event. Body optional `{ }` — approval is whole-run (per-page partial approval is not in the spec).
  - **GET `/runs/[id]/images`** — returns `steps.images.slots` plus, for library candidates, short-lived signed thumb URLs (60 min) so the grid can render from the private bucket. **POST** — body `{ key, choice: PickChoice }`; 409 unless at the gate; resolves the choice to an asset (`library` → `bumpUseCount`; `pexels` → `rehostFromUrl` (dedupes by pexels_id); `client` → `rehostFromUrl` with `kind:'client', lead_id` from the run, source `client_link`); writes `asset:{id}` into the doc slot with provenance `operator`; 422 with the reason when rehost refuses (non-image, oversized). A pexels rehost failure is a 502 with the error — the operator picks something else; nothing is stuck.
  - **POST `/runs/[id]/reroll`** — body `{ page_index, slot_id? , include_operator?: boolean }`; drives Task 6; 409 off-gate; the model call goes through `productionWriterCall` (the `content_write` task).
  - **POST `/runs/[id]/control`** — body `{ action: "pause" | "resume" | "cancel" }`. Pause/resume flip `paused` (only while non-terminal); cancel requires `canCancel(status)`, sets `cancelled` + event. 409 otherwise.
  - **GET `/runs/[id]/download`** — 409 unless `ready` with `zip_path`; returns a 10-minute signed URL for the zip.
  - **GET `/api/site-studio/assets`** — query `subject`, `kind`, `lead_id`, paginated; returns rows + signed thumb URLs. **POST** — multipart upload (same pattern as the template upload route): validates `image/*` + ≤15 MB, probes dimensions via a magic-bytes/header parse (jpeg/png/webp SOF — a tiny pure helper in `rehost.ts`, tested there in Task 4… add it there if not present), stores via the Task 4 service with `kind:'stock'`, `source:'upload'`.
  - **DELETE `/api/site-studio/assets/[id]`** — removes row + bucket object. 409 with a count if any ACTIVE run's doc references `asset:{id}` (scan active runs' `content_doc` — cheap at this scale; a deployed site is unaffected by deletion since its bytes were zipped).
  - **POST `/api/site-studio/advance`** — **no session guard**; guarded by header `x-studio-advance-secret` against `STUDIO_ADVANCE_SECRET`, failing closed when unset (exact `app/api/mail/poll/route.ts` idiom). Selects runs where `status in ('queued','preparing','approved','rendering')` (NEVER `reviewing` — the machine literally cannot cross the gate, but don't even select it) and `paused = false` and `updated_at < now() - interval '2 minutes'`, oldest first, limit 3; calls `runStep` once each with `productionWriterCall`; returns `{advanced: n}`. The 2-minute idle threshold means it only touches runs the browser has abandoned.
- [ ] **Step 2:** `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` clean. Commit: `feat(site-studio): gate, image, control, library and advancer routes`

---

### Task 10: The cockpit UI

**Files:** Create `components/site-studio/{RunLaunch,RunCockpit,RunPageCard,ImagePicker,StudioTabs}.tsx`, `app/(app)/ai-tools/site-studio/runs/page.tsx`, `app/(app)/ai-tools/site-studio/runs/[id]/page.tsx`; Modify `app/(app)/ai-tools/site-studio/page.tsx` (mount StudioTabs).

Follow Phase 2b's conventions exactly: client components, `useCallback` fetch + `useEffect` mount-load idiom, the repo's toast hook, Tailwind classes matching `SiteStudioBoard`, server pages gate on `studio.manage` like `site-studio/page.tsx` does.

- [ ] **Step 1: Build, to this behavioural contract:**
  - **StudioTabs** — `Templates | Runs | Library` links (pathname-aware active state); mounted on all three server pages.
  - **Runs list page** — table of runs (lead name, template, status pill, created, updated) from `GET /runs`; "New run" opens **RunLaunch**.
  - **RunLaunch** — (1) lead picker: client-side searchable list from `GET /api/leads` (filter to `status === "Not Ready"` and `deleted_at == null`, search on business_name); selecting shows the dossier facts (name/phone/email/services/areas — read-only). (2) template picker: certified templates only, from the existing templates list route. (3) pages: checkboxes derived from the lead's `specify_pages` mapped over the template manifest (reuse the server's semantics by just showing `specify_pages` values + the standard set; the server's `selectPages` remains the authority — the UI shows `skipped` honestly after prepare). (4) fan-out toggles showing the counts (`Service pages: 4`, from `services.length`). (5) auto-mode checkbox ("Skip content review — everything stays editable at the preview"). Submit → `POST /runs` → navigate to the cockpit; 409s (active run exists / not certified) surface as toasts verbatim.
  - **RunCockpit** — the one live page. Drives the run: while `!awaitingGate && !terminal && !paused`, calls `POST /step` in a loop (each response updates state; on `{claimed:false}` just refetch). Poll `GET /runs/[id]` every 3s as the fallback view refresh (two tabs / advancer racing is safe by design — CAS). Renders: status header with pause/resume/cancel buttons (control route), the event timeline (collapsible), and one **RunPageCard** per doc page.
  - **RunPageCard** — the write state for its page (`pending / writing / written / failed+error+Retry` from `steps.write.pages`), and at the gate: every text slot as click-to-edit (textarea, saves via the 3a `PATCH /content` route, 422s toasted verbatim), every image slot as an **ImagePicker** trigger showing the current pick/sample, per-slot ↻ re-roll button and a per-page "Re-roll page" (both confirm when they'd touch operator-edited fields, driving `include_operator`).
  - **ImagePicker** — dialog per slot key: tabs `Candidates` (from `GET /images`, grid of thumbs, pexels credit line), `Library` (search via assets route), `Client photos` (the run's `client_photos` URLs, hot-linked preview, pick → `{kind:'client'}`), `Upload` (posts to assets route then picks it). Pick → `POST /images` → optimistic close + card refresh. Shows the paired `{id}_alt` text slot beneath the image for editing.
  - **Gate footer** — when `status === "reviewing"`: sticky bar "Approve & render" (`POST /approve`) with a count of pages/slots still empty-ish (informational only — approval is allowed; the render refusal is the hard guard).
  - **Ready state** — download button (signed URL route), "Deploy comes in Phase 4" note.
  - **Failed state** — the run `error` verbatim + per-page errors; a `failed` run offers no resurrect button (create a new run — one-active-per-lead has cleared).
- [ ] **Step 2: Mount smoke tests** in `tests/siteStudioCockpit.test.tsx` (2b precedent, @testing-library/react): RunLaunch renders and filters leads; RunCockpit renders page cards from a canned run row at the gate (fetch mocked); ImagePicker renders candidate grids from canned state; the gate footer appears only for `reviewing`; the paused banner appears when `paused`. ~6 tests.
- [ ] **Step 3:** PASS + `tsc` clean. Commit: `feat(site-studio): the generation cockpit - launch, live page cards, gate 1 review`

---

### Task 11: Library management UI

**Files:** Create `components/site-studio/AssetLibrary.tsx`, `app/(app)/ai-tools/site-studio/library/page.tsx`

- [ ] **Step 1: Build:** searchable grid (subject search box, kind filter chips All/Stock/Client, thumbnails from signed URLs, subject + tags + use-count + dimensions on each card, pexels credit where applicable), upload button (same multipart flow as ImagePicker's upload tab), delete with confirm (409 toast verbatim when an active run holds it). Client-owned cards show the lead name and a "never offered to other clients" badge. Server page gates on `studio.manage`, mounts StudioTabs.
- [ ] **Step 2:** Add 2 mount smoke tests to `tests/siteStudioCockpit.test.tsx`. PASS. Commit: `feat(site-studio): asset library surface - search, upload, fenced client photos`

---

### Task 12: End-to-end proof, gates, migration

- [ ] **Step 1: Extend `tests/siteStudioGenerationE2E.test.ts`** with the 3b acceptance case (still no DB/network — fakes throughout): full pipeline with `options.auto: false` → run parks at `reviewing`; assert the machine refuses to advance; pick a (fake-rehosted) asset for one image slot + operator-edit one text slot; approve; render+finalize → the zip contains the picked image bytes at `img/studio/…`, the HTML references it with a depth-correct path, the operator's edit survived, and a whole-page re-roll before approval did NOT clobber the operator slot. Auto-mode case: same inputs, `auto: true` → never parks, reaches `ready` with zero gate events.
- [ ] **Step 2: Gates.** `npm test` (full), `tsc --noEmit`, `npm run build` (routes `/api/site-studio/{runs/[id]/{approve,images,reroll,control,download},assets,assets/[id],advance}` + the three pages in the manifest).
- [ ] **Step 3: Apply migration 0054** via the Supabase MCP `apply_migration` (project `ikuvbxjkoojtgekapbul` — pre-approved). FIRST verify the live CHECK constraint name (`select conname from pg_constraint where conrelid = 'public.studio_runs'::regclass`); adjust the migration file if it differs. ALSO pre-flight `select count(*) from studio_runs where status not in ('queued','preparing','reviewing','approved','rendering','ready','failed','cancelled')` and `select count(*) from studio_runs` — the migration's safety rests on "table is empty pre-cockpit"; verify rather than assume. THEN apply. Verify after: `studio_assets` exists with RLS on/zero policies + the client-needs-lead CHECK + the pexels partial unique; `studio_runs` CHECK now lists the 8 statuses; the partial index covers the new active set; `paused` exists; `studio-assets` bucket private.
- [ ] **Step 4:** `git status --short` clean. Commit anything from steps 1–2: `test(site-studio): gate 1 and image resolution end to end`

**Phase 3b is complete when** the E2E proves park→pick→approve→zip-with-real-image-bytes, all gates are green, migration 0054 is applied, and the cockpit/library mount tests pass. Live browser verification (real lead, real Pexels key, real picks) happens with the user after push, like 2b.

---

## Self-review notes

- **Spec §7 coverage:** launch (lead+template+pages+fan-out counts+auto) → Task 10; live per-page cards + retry → Task 10 on 3a's `steps.write.pages`; Gate 1 park + Approve → Tasks 2/7/9; auto mode → Tasks 7/9/12; Stop/Pause/Resume flags → Tasks 1/7/9/10; advancer cron that never crosses a gate → Task 9 (+ the machine itself makes crossing impossible, Task 2); granular re-roll honouring operator provenance → Task 6/9/10. **§8:** library-first + Pexels top-up + cheap filters → Task 5; picks feed the library + pexels dedupe → Task 4; client photos fenced → Tasks 1/4/9/10; alt text → already a `_alt` text slot (verified in-repo), surfaced in ImagePicker; library surface → Task 11; no vision → nowhere. **§10:** `studio_assets` + bucket → Task 1; step claims/idempotent double-execution → 3a CAS, re-asserted Task 7. Deferred with reasons: Gate 2/editable preview/deploy (Phase 4), async "AI rank" assist (spec: "may come later; never a blocker").
- **Type consistency check:** `ImageCandidate`/`PickChoice` (Task 3) are what Task 5 sources, Task 9's POST consumes, Task 10 renders; `SlotImageState.key` format `"${pageIndex}:${slotId}"` used consistently in Tasks 2/5/9/10; `asset:{uuid}` scheme written by Task 9, resolved by Task 8, asserted in Task 12; `awaitingGate` (Task 2) drives Task 7's park, Task 9's 409s, Task 10's footer.
- **Known risks named for the implementer:** the CHECK-constraint name (verify against the live catalog before applying), the stamped-page relative-path question (Task 8 probes it rather than assuming), and the 3a test files that legitimately change with the machine (`siteStudioRunTypes`, `siteStudioEngine`, the E2E's status expectations) — updating their expectations is in-scope; weakening their assertions is not.
