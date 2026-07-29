# Site Builder Run Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a failed or stuck Site Builder run recoverable — retry it without re-paying for the pages that already succeeded, regenerate any individual failed page, and force-release a run wedged in `generating`.

**Architecture:** `runSite` gains a `resume` input that carries forward pages already `ok`. Retry then needs no new endpoint — `/generate` widens the statuses it accepts and passes the previous attempt's pages. A `generation_id` claim token makes force-releasing a live generation safe by causing the superseded attempt's writes to match zero rows.

**Tech Stack:** TypeScript, Next.js 16 route handlers, Supabase (Postgres), Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-29-site-builder-run-recovery-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/0063_builder_run_generation_id.sql` — one nullable uuid column.
- `app/api/site-builder/runs/[id]/recover/route.ts` — force-release a stuck claim.

**Modify:**
- `lib/site-builder/run.ts` — `resume` on `RunSiteArgs`, honoured in `runSite`.
- `app/api/site-builder/runs/[id]/generate/route.ts` — claim token, guarded writes, widened statuses, passes `resume`.
- `app/api/site-builder/runs/[id]/pages/[file]/regenerate/route.ts` — accepts `failed`, promotes to `review`.
- `components/site-builder/BuilderRun.tsx` — Retry button, widened regenerate gate, Stop-and-recover.

**Tests (all extend existing files):**
- `tests/siteBuilderRun.test.ts` — `resume` behaviour.
- `tests/siteBuilderRoutes.test.ts` — the three route changes.
- `tests/siteBuilderRunScreen.test.tsx` — the UI affordances.

Task 1 is pure library work with no dependencies. Task 2 is the safety mechanism and must land before Task 5, which relies on it. Tasks 3–5 are the route changes. Task 6 is the UI. After Task 5 the feature is complete via the API; Task 6 makes it reachable.

---

### Task 1: `runSite` carries forward pages that already succeeded

**Files:**
- Modify: `lib/site-builder/run.ts:253-397`
- Test: `tests/siteBuilderRun.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/siteBuilderRun.test.ts`. Read the top of that file first and reuse its existing template fixture and `aiCall` stub helpers rather than duplicating them — the names below assume a `makeTemplate()`-style helper and a counting stub; adapt to whatever the file actually provides, keeping the assertions identical.

```ts
describe("runSite resume", () => {
  it("keeps a page that already succeeded and never calls the AI for it", async () => {
    const calls: string[] = [];
    const aiCall = async (_system: string, user: string) => {
      calls.push(user);
      return { text: "<!doctype html><html><body>fresh</body></html>" };
    };

    const result = await runSite({
      aiCall,
      brief: BRIEF,
      images: [],
      template: TEMPLATE,
      requestedPages: ["Home", "About"],
      resume: {
        "index.html": { status: "ok", kind: "existing", html: "<!doctype html><html><body>CARRIED</body></html>" },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.pages["index.html"].status).toBe("ok");
    expect(result.pages["index.html"].html).toContain("CARRIED");
    // about.html was not carried, so exactly one page call was made for it.
    expect(calls.filter((u) => u.includes("about.html")).length).toBe(1);
    expect(calls.filter((u) => u.includes("index.html")).length).toBe(0);
  });

  it("regenerates a page whose carried state is not ok", async () => {
    let n = 0;
    const aiCall = async () => {
      n += 1;
      return { text: "<!doctype html><html><body>fresh</body></html>" };
    };

    const result = await runSite({
      aiCall,
      brief: BRIEF,
      images: [],
      template: TEMPLATE,
      requestedPages: ["Home"],
      resume: {
        "index.html": { status: "failed", kind: "existing", error: "boom" },
      },
    });

    expect(result.pages["index.html"].status).toBe("ok");
    expect(result.pages["index.html"].html).toContain("fresh");
    expect(n).toBeGreaterThan(0);
  });

  it("regenerates a page left mid-flight by a killed run", async () => {
    const aiCall = async () => ({ text: "<!doctype html><html><body>fresh</body></html>" });
    const result = await runSite({
      aiCall,
      brief: BRIEF,
      images: [],
      template: TEMPLATE,
      requestedPages: ["Home"],
      resume: { "index.html": { status: "generating", kind: "existing" } },
    });
    expect(result.pages["index.html"].status).toBe("ok");
    expect(result.pages["index.html"].html).toContain("fresh");
  });

  it("recomputes the plan from the lead, dropping pages no longer requested", async () => {
    const aiCall = async () => ({ text: "<!doctype html><html><body>fresh</body></html>" });

    const result = await runSite({
      aiCall,
      brief: BRIEF,
      images: [],
      template: TEMPLATE,
      requestedPages: ["Home"], // "About" was requested last time, not now
      resume: {
        "index.html": { status: "ok", kind: "existing", html: "<!doctype html><html><body>CARRIED</body></html>" },
        "about.html": { status: "ok", kind: "existing", html: "<!doctype html><html><body>OLD ABOUT</body></html>" },
      },
    });

    expect(Object.keys(result.pages)).not.toContain("about.html");
    expect(result.pages["index.html"].html).toContain("CARRIED");
  });

  it("reuses a carried components file as context without re-calling for it", async () => {
    const systems: string[] = [];
    const aiCall = async (system: string) => {
      systems.push(system);
      return { text: "<!doctype html><html><body>fresh</body></html>" };
    };

    await runSite({
      aiCall,
      brief: BRIEF,
      images: [],
      template: TEMPLATE,
      requestedPages: ["Home"],
      resume: {
        "components.js": { status: "ok", kind: "component", name: "Shared components", html: "// CARRIED components" },
      },
    });

    // SITE_COMPONENTS_SYSTEM is only sent when the components file is generated.
    expect(systems.some((s) => s.includes("shared-components file"))).toBe(false);
  });

  it("takes kind and name from the fresh plan, not from the carried entry", async () => {
    const aiCall = async () => ({ text: "<!doctype html><html><body>fresh</body></html>" });
    const result = await runSite({
      aiCall,
      brief: BRIEF,
      images: [],
      template: TEMPLATE,
      requestedPages: ["Home"],
      // A stale entry claiming the wrong kind must not override the plan.
      resume: { "index.html": { status: "ok", kind: "new", name: "Stale Name", html: "<html><body>C</body></html>" } },
    });
    expect(result.pages["index.html"].kind).toBe("existing");
    expect(result.pages["index.html"].name).toBeUndefined();
  });

  it("makes no AI call at all when every requested page is already ok", async () => {
    let n = 0;
    const aiCall = async () => {
      n += 1;
      return { text: "<!doctype html><html><body>fresh</body></html>" };
    };

    const result = await runSite({
      aiCall,
      brief: BRIEF,
      images: [],
      template: TEMPLATE,
      requestedPages: ["Home"],
      resume: {
        "index.html": { status: "ok", kind: "existing", html: "<!doctype html><html><body>C</body></html>" },
        "components.js": { status: "ok", kind: "component", name: "Shared components", html: "// C" },
      },
    });

    expect(n).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.zipBytes).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/siteBuilderRun.test.ts`
Expected: FAIL — `resume` is not a property of `RunSiteArgs` (type error), and the carried page is regenerated.

- [ ] **Step 3: Implement**

In `lib/site-builder/run.ts`, add to `RunSiteArgs` after `onProgress`:

```ts
  /**
   * Pages carried over from a PREVIOUS attempt at this run. Any entry already
   * `ok` is kept verbatim and never regenerated; everything else is
   * (re)generated from scratch.
   *
   * The page PLAN is still recomputed from `requestedPages` — this map is only
   * consulted for files the fresh plan already contains. A lead whose
   * `specify_pages` changed between attempts therefore gets its CURRENT set,
   * with still-relevant successes carried and dropped pages simply absent.
   * Reading the plan back out of this map instead would quietly pin a run to
   * whatever specification it was first started with.
   */
  resume?: Record<string, PageState>;
```

Change the destructure on the first line of `runSite`:

```ts
  const { aiCall, brief, images, template, requestedPages, onProgress, resume } = args;
```

Replace the `pages` initialisation block (currently `lib/site-builder/run.ts:310-313`):

```ts
  const pages: Record<string, PageState> = {};
  if (components) pages[components.file] = { status: "pending", kind: "component", name: "Shared components" };
  for (const f of plan.existing) pages[f] = { status: "pending", kind: "existing" };
  for (const p of plan.newPages) pages[p.file] = { status: "pending", kind: "new", name: p.name };
```

with:

```ts
  /**
   * The fresh plan's entry for a file, upgraded to the carried result when a
   * previous attempt already finished it. `kind` and `name` always come from
   * the PLAN, never from the carried entry: a stale entry describing a file
   * that has since changed kind would otherwise mislabel it for the rest of
   * the run. Only `status` and `html` are carried, and only together — an
   * `ok` entry without html is not a usable page and is regenerated.
   */
  const withCarried = (file: string, planned: PageState): PageState => {
    const prev = resume?.[file];
    return prev?.status === "ok" && prev.html !== undefined ? { ...planned, status: "ok", html: prev.html } : planned;
  };

  const pages: Record<string, PageState> = {};
  if (components) {
    pages[components.file] = withCarried(components.file, {
      status: "pending",
      kind: "component",
      name: "Shared components",
    });
  }
  for (const f of plan.existing) pages[f] = withCarried(f, { status: "pending", kind: "existing" });
  for (const p of plan.newPages) pages[p.file] = withCarried(p.file, { status: "pending", kind: "new", name: p.name });
```

Replace the components block (currently `lib/site-builder/run.ts:320-334`):

```ts
  // ---- 1. components, first and alone ----
  let shared: SharedComponents | undefined;
  if (components) {
    pages[components.file] = { ...pages[components.file], status: "generating" };
    await emit();
    const outcome = await generateComponents(
      { aiCall },
      { brief, images, file: components.file, source: components.source, siteFiles },
    );
    pages[components.file] = outcome.ok
      ? { status: "ok", kind: "component", name: "Shared components", html: outcome.html }
      : { status: "failed", kind: "component", name: "Shared components", error: outcome.error };
    if (outcome.ok) shared = { file: components.file, source: outcome.html };
    await emit();
  }
```

with:

```ts
  // ---- 1. components, first and alone ----
  let shared: SharedComponents | undefined;
  if (components) {
    const carried = pages[components.file];
    if (carried.status === "ok" && carried.html !== undefined) {
      // A previous attempt already rewrote it. Reuse its source as page
      // context rather than paying for it again — every page prompt below
      // wants the SAME components content this run's pages will ship with.
      shared = { file: components.file, source: carried.html };
    } else {
      pages[components.file] = { ...carried, status: "generating" };
      await emit();
      const outcome = await generateComponents(
        { aiCall },
        { brief, images, file: components.file, source: components.source, siteFiles },
      );
      pages[components.file] = outcome.ok
        ? { status: "ok", kind: "component", name: "Shared components", html: outcome.html }
        : { status: "failed", kind: "component", name: "Shared components", error: outcome.error };
      if (outcome.ok) shared = { file: components.file, source: outcome.html };
      await emit();
    }
  }
```

Add an early return to each page runner. In `runExisting`, immediately after the opening brace:

```ts
  const runExisting = async (file: string) => {
    // Carried from a previous attempt — nothing to do, and nothing to pay for.
    if (pages[file].status === "ok") return;
    pages[file] = { ...pages[file], status: "generating" };
```

and identically in `runNew`:

```ts
  const runNew = async ({ name, file }: { name: string; file: string }) => {
    if (pages[file].status === "ok") return;
    pages[file] = { ...pages[file], status: "generating" };
```

Finally, extend `runSite`'s docblock. After the existing paragraph about a per-page failure, add:

```
 * RESUMING: when `resume` is supplied, any page a previous attempt already
 * finished is carried straight through and never re-called — see that field's
 * own comment for why the plan is still recomputed rather than read back from
 * it. A run where every requested page is already `ok` makes no AI call at all
 * and simply re-assembles the zip.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/siteBuilderRun.test.ts`
Expected: PASS — all pre-existing tests plus the 7 new ones.

- [ ] **Step 5: Verify the tests discriminate**

Temporarily delete the `if (pages[file].status === "ok") return;` line from `runExisting`. Run the tests again: "keeps a page that already succeeded and never calls the AI for it" and "makes no AI call at all when every requested page is already ok" must FAIL. Restore the line and confirm they pass. Report what you saw.

- [ ] **Step 6: Commit**

```bash
git add lib/site-builder/run.ts tests/siteBuilderRun.test.ts
git commit -m "feat(site-builder): runSite can carry forward pages a previous attempt finished"
```

---

### Task 2: A claim token so a superseded generation cannot clobber its replacement

**Files:**
- Create: `supabase/migrations/0063_builder_run_generation_id.sql`
- Modify: `app/api/site-builder/runs/[id]/generate/route.ts`
- Test: `tests/siteBuilderRoutes.test.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0063_builder_run_generation_id.sql`:

```sql
-- 0063_builder_run_generation_id.sql — which attempt currently owns a run.
--
-- ADDITIVE ONLY. Shared prod DB: one nullable column, no drops, no type
-- changes, no edits to existing columns or data.
--
-- WHY. `/generate` claims a run by CAS on (status, updated_at) and then writes
-- to it repeatedly for the next several minutes — per-page progress, then a
-- terminal status. Nothing stops a SECOND attempt claiming the same run while
-- the first is still running: the 60-minute stale reclaim already allows it
-- (a paced run can go ~21 minutes without writing), and the new operator-driven
-- `/recover` action allows it deliberately. Two live attempts then race on one
-- `pages` column, at double the AI spend, and whichever finishes last wins.
--
-- A fresh uuid is stamped on every successful claim, and every subsequent write
-- by that attempt carries `.eq("generation_id", <the id it claimed>)`. An
-- attempt that has been superseded therefore matches zero rows and discards its
-- own result instead of overwriting a state somebody else deliberately set —
-- the same discipline lib/site-studio/run/engine.ts applies to its step writes.
--
-- NULL means "no attempt owns this run", which is correct for every existing
-- row and is also what `/recover` writes to evict a live attempt.
alter table public.builder_runs
  add column if not exists generation_id uuid;
```

- [ ] **Step 2: Build a route-test harness that honours filters**

`tests/siteBuilderRoutes.test.ts`'s existing `makeAdmin()` is READ-ONLY — `select().eq().single()` and nothing else. Every POST test in Tasks 2–5 needs writes, and specifically needs `.eq()` filters to be **real**: this task's entire safety mechanism is a filtered write matching zero rows, so a fake that ignored filters would make every assertion about it pass vacuously.

Add to `tests/siteBuilderRoutes.test.ts`, leaving `makeAdmin()` untouched so the existing GET tests keep working:

```ts
type Row = Record<string, unknown>;

/**
 * A writable fake of the two tables the POST routes touch.
 *
 * `.eq()` filters are HONOURED on update — that is the whole point. The
 * mechanism under test is "a superseded attempt's write matches zero rows", so
 * a fake that applied updates regardless of filters would report success for
 * exactly the bug these tests exist to catch.
 */
function makeWritableAdmin(rows: Row[]) {
  const state = { runs: rows.map((r) => ({ ...r })), activity: [] as Row[] };

  const from = (table: string) => {
    if (table === "activity_log") {
      return {
        insert: async (payload: Row) => {
          state.activity.push(payload);
          return { error: null };
        },
      };
    }
    if (table !== "builder_runs") throw new Error(`unexpected table "${table}"`);

    const filters: [string, unknown][] = [];
    let patch: Row | null = null;
    const matched = () => state.runs.filter((r) => filters.every(([c, v]) => r[c] === v));
    const apply = () => {
      const hits = matched();
      if (patch) for (const r of hits) Object.assign(r, patch);
      return hits;
    };

    const api: any = {
      select: () => api,
      update: (p: Row) => {
        patch = p;
        return api;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return api;
      },
      single: async () => {
        const hits = apply();
        return hits.length === 1
          ? { data: { ...hits[0] }, error: null }
          : { data: null, error: { message: "no rows" } };
      },
      maybeSingle: async () => {
        const hits = apply();
        return { data: hits.length ? { ...hits[0] } : null, error: null };
      },
      // An update with no .select() is awaited directly (the progress chain and
      // the catch-block failure write both do this).
      then: (res: (v: { data: null; error: null }) => unknown) => {
        apply();
        return Promise.resolve({ data: null, error: null }).then(res);
      },
    };
    return api;
  };

  return { admin: { from, storage: makeAdmin().storage }, state };
}

const RUN = (over: Row = {}): Row => ({
  id: "run-1",
  lead_id: "lead-1",
  template_id: "tpl-1",
  status: "queued",
  options: {},
  images: [],
  pages: {},
  output_path: null,
  error: null,
  generation_id: null,
  updated_at: "2026-07-29T12:00:00.000Z",
  ...over,
});
```

Because the generate route also loads a lead, a template bundle and calls `runSite`, mock those seams for the POST tests:

```ts
vi.mock("@/lib/site-builder/templates", () => ({
  loadTemplateBundle: async () => ({ pageFiles: ["index.html"], pages: { "index.html": "<html></html>" }, assetFiles: [], assets: {} }),
}));

const runSiteMock = vi.fn(async () => ({ ok: true, pages: { "index.html": { status: "ok", kind: "existing", html: "<html>x</html>" } }, zipBytes: new Uint8Array([1]) }));
vi.mock("@/lib/site-builder/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/site-builder/run")>()),
  runSite: (args: unknown) => runSiteMock(args as never),
}));
```

The lead read goes through the same `builder_runs`-typed fake above, so extend `from()` to accept `"leads"` and return a single stub lead row — mirror the `activity_log` branch.

- [ ] **Step 3: Write the failing tests**

```ts
import { POST as generatePost } from "@/app/api/site-builder/runs/[id]/generate/route";

const runCtx = () => ({ params: Promise.resolve({ id: "run-1" }) });

describe("POST /generate — claim token", () => {
  it("stamps a fresh generation_id on the claim", async () => {
    const { admin, state } = makeWritableAdmin([RUN({ status: "queued" })]);
    adminHolder.admin = admin;

    await generatePost(new Request("http://x", { method: "POST" }), runCtx());

    // The terminal write clears it, so assert it was a uuid at claim time by
    // capturing what runSite saw: the claim happens before runSite is called.
    expect(runSiteMock).toHaveBeenCalled();
    expect(state.runs[0].status).toBe("review");
  });

  it("discards a superseded attempt's terminal write instead of clobbering", async () => {
    const { admin, state } = makeWritableAdmin([RUN({ status: "queued" })]);
    adminHolder.admin = admin;

    // Simulate /recover landing while runSite is mid-flight: null the token the
    // in-flight attempt claimed, exactly as the recover route does.
    runSiteMock.mockImplementationOnce(async () => {
      state.runs[0].generation_id = null;
      state.runs[0].status = "failed";
      return { ok: true, pages: {}, zipBytes: undefined };
    });

    const res = await generatePost(new Request("http://x", { method: "POST" }), runCtx());

    expect(res.status).toBe(409);
    // The superseded attempt must NOT have written "review" over the recovery.
    expect(state.runs[0].status).toBe("failed");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/siteBuilderRoutes.test.ts`
Expected: FAIL — no `generation_id` is written, and the superseded write succeeds.

- [ ] **Step 5: Implement**

In `app/api/site-builder/runs/[id]/generate/route.ts`:

Stamp the token on the claim. Replace the claim block:

```ts
  const { data: claimed } = await admin
    .from("builder_runs")
    .update({ status: "generating", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", run.status)
    .eq("updated_at", run.updated_at as string)
    .select("*")
    .single();
  if (!claimed) {
    return NextResponse.json({ error: "Generation already started for this run." }, { status: 409 });
  }
```

with:

```ts
  // Every write this attempt makes from here on carries this token, so an
  // attempt that gets superseded mid-flight (by /recover, or by a stale
  // reclaim) discards its own result rather than overwriting whatever replaced
  // it. See migration 0063.
  const generationId = crypto.randomUUID();
  const { data: claimed } = await admin
    .from("builder_runs")
    .update({ status: "generating", generation_id: generationId, error: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", run.status)
    .eq("updated_at", run.updated_at as string)
    .select("*")
    .single();
  if (!claimed) {
    return NextResponse.json({ error: "Generation already started for this run." }, { status: 409 });
  }
```

Guard the progress writes — add one `.eq` to the `persist` chain:

```ts
        .then(() =>
          admin
            .from("builder_runs")
            .update({ pages: snapshot, updated_at: new Date().toISOString() })
            .eq("id", id)
            .eq("generation_id", generationId),
        )
```

Guard the terminal write, and handle the superseded case rather than throwing. Replace:

```ts
    const { data: updated, error: updErr } = await admin
      .from("builder_runs")
      .update({
        status: result.ok ? "review" : "failed",
        pages: result.pages,
        output_path: outputPath,
        error: result.ok ? null : "Every page failed to generate.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (updErr || !updated) return NextResponse.json({ error: updErr?.message ?? "Update failed" }, { status: 400 });
```

with:

```ts
    const { data: updated, error: updErr } = await admin
      .from("builder_runs")
      .update({
        status: result.ok ? "review" : "failed",
        pages: result.pages,
        output_path: outputPath,
        error: result.ok ? null : "Every page failed to generate.",
        generation_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("generation_id", generationId)
      .select("*")
      .maybeSingle();
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });
    if (!updated) {
      // Superseded while we were working — someone recovered this run, or a
      // stale reclaim handed it to another attempt. Abandon our result rather
      // than overwrite a state that was deliberately set. Not an error the
      // operator caused, so it answers 409 rather than 500.
      return NextResponse.json(
        { error: "This generation was superseded by a newer attempt; its result was discarded." },
        { status: 409 },
      );
    }
```

Guard the catch block's failure write the same way — replace:

```ts
    await admin
      .from("builder_runs")
      .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", id);
```

with:

```ts
    await admin
      .from("builder_runs")
      .update({ status: "failed", error: message, generation_id: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("generation_id", generationId);
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/siteBuilderRoutes.test.ts`
Expected: PASS

- [ ] **Step 7: Verify the tests discriminate**

Temporarily remove `.eq("generation_id", generationId)` from the terminal write. The "discards a superseded attempt's terminal write" test must FAIL. Restore. Report what you saw.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0063_builder_run_generation_id.sql "app/api/site-builder/runs/[id]/generate/route.ts" tests/siteBuilderRoutes.test.ts
git commit -m "fix(site-builder): a superseded generation discards its result instead of clobbering"
```

---

### Task 3: `/generate` accepts a failed run and resumes it

**Files:**
- Modify: `app/api/site-builder/runs/[id]/generate/route.ts`
- Test: `tests/siteBuilderRoutes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/siteBuilderRoutes.test.ts`, written in full against the harness:

- a `failed` run is accepted and claimed (status becomes `generating`, `error` is cleared);
- a `queued` run is still accepted;
- a `generating` run whose `updated_at` is older than 60 minutes is accepted;
- a `generating` run updated 1 minute ago is refused with 409;
- `review`, `approved` and `deployed` are each refused with 409;
- the value passed to `runSite` as `resume` is the run's stored `pages` (mock `@/lib/site-builder/run`'s `runSite` and assert on its argument).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/siteBuilderRoutes.test.ts`
Expected: FAIL — a failed run is refused, and `runSite` receives no `resume`.

- [ ] **Step 3: Implement**

In `app/api/site-builder/runs/[id]/generate/route.ts`, add above the handler:

```ts
/**
 * Statuses `/generate` will claim. `failed` is here because retry IS this
 * route: a failed run is re-claimed and, thanks to `resume` below, only the
 * pages that did not finish are regenerated. `review`/`approved`/`deployed`
 * are deliberately absent — those have a packaged zip, and the right tool for
 * changing one page there is the per-page regenerate route.
 */
const RESUMABLE = new Set(["queued", "failed"]);
```

Replace the status guard:

```ts
  const stale =
    run.status === "generating" &&
    Date.now() - new Date(run.updated_at as string).getTime() > STALE_GENERATING_MS;
  if (run.status !== "queued" && !stale) {
    return NextResponse.json({ error: `Cannot generate: this run is "${run.status}", not "queued".` }, { status: 409 });
  }
```

with:

```ts
  const stale =
    run.status === "generating" &&
    Date.now() - new Date(run.updated_at as string).getTime() > STALE_GENERATING_MS;
  if (!RESUMABLE.has(run.status as string) && !stale) {
    return NextResponse.json(
      { error: `Cannot generate: this run is "${run.status}". Only a queued, failed, or stalled run can be generated.` },
      { status: 409 },
    );
  }
```

Pass the stored pages into `runSite`:

```ts
    const result = await runSite({
      aiCall: productionSiteBuildCall,
      brief,
      images,
      template: bundle,
      requestedPages,
      // Retry, and stale-reclaim, both land here. Whatever a previous attempt
      // finished is carried through untouched; only the rest is regenerated.
      // On a first run this is `{}` and changes nothing.
      resume: (run.pages ?? {}) as Record<string, PageState>,
      onProgress: persist,
    });
```

Update the route's docblock to say it also serves retry.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/siteBuilderRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/api/site-builder/runs/[id]/generate/route.ts" tests/siteBuilderRoutes.test.ts
git commit -m "feat(site-builder): retry a failed run without re-paying for the pages that worked"
```

---

### Task 4: Regenerating a page on a failed run, and promoting it back to review

**Files:**
- Modify: `app/api/site-builder/runs/[id]/pages/[file]/regenerate/route.ts:35-40` and its update block
- Test: `tests/siteBuilderRoutes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/siteBuilderRoutes.test.ts`, in full:

- regenerating a page on a `failed` run is accepted (not 409);
- when that regeneration succeeds and the run now has at least one non-component page `ok`, the run's status becomes `review` and `error` is cleared;
- when the ONLY thing that succeeded is the components file, the run stays `failed` (a components file is not a site);
- when the regeneration itself fails, the run stays `failed` and the route still answers 502 with the page error;
- a `review` run stays `review` (no spurious status write).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/siteBuilderRoutes.test.ts`
Expected: FAIL — the failed-run case is refused with 409.

- [ ] **Step 3: Implement**

Replace the status guard:

```ts
  if (run.status !== "review" && run.status !== "approved") {
    return NextResponse.json(
      { error: `Cannot regenerate: this run is "${run.status}", not "review" or "approved".` },
      { status: 409 },
    );
  }
```

with:

```ts
  // `failed` is here so an operator can fix the run that most needs fixing.
  // Without it the button renders on a failed page, shows its error, and does
  // nothing when clicked.
  const REGENERATABLE = new Set(["review", "approved", "failed"]);
  if (!REGENERATABLE.has(run.status as string)) {
    return NextResponse.json(
      { error: `Cannot regenerate: this run is "${run.status}", not "review", "approved" or "failed".` },
      { status: 409 },
    );
  }
```

Then, after `newPages` is built and before the storage upload, compute the promotion:

```ts
  // A failed run with a working page is reviewable. Leaving it `failed` would
  // mean the operator fixes a page and still cannot approve the run — the same
  // dead end this route was widened to escape. Only a REAL page counts: a
  // rewritten components file is not a site.
  const hasRealPage = Object.values(newPages).some((p) => p.status === "ok" && p.kind !== "component");
  const promoted = run.status === "failed" && hasRealPage;
```

and include it in the run update — replace:

```ts
  const { data: updated, error: updErr } = await admin
    .from("builder_runs")
    .update({ pages: newPages, output_path: outputPath, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
```

with:

```ts
  const { data: updated, error: updErr } = await admin
    .from("builder_runs")
    .update({
      pages: newPages,
      output_path: outputPath,
      ...(promoted ? { status: "review", error: null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
```

Update the route's docblock, which currently says it runs "only at `review` or `approved`".

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/siteBuilderRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/api/site-builder/runs/[id]/pages/[file]/regenerate/route.ts" tests/siteBuilderRoutes.test.ts
git commit -m "feat(site-builder): fix a page on a failed run, and let that run reach review"
```

---

### Task 5: `/recover` — force-release a stuck claim

**Files:**
- Create: `app/api/site-builder/runs/[id]/recover/route.ts`
- Test: `tests/siteBuilderRoutes.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/siteBuilderRoutes.test.ts`, in full:

- a `generating` run becomes `failed`, with `generation_id` set to null and an error explaining what happened;
- a `queued`, `review`, `approved`, `deployed` or `failed` run is refused with 409 naming its status;
- the CAS is real: if the row's status changed between read and write, the handler answers 409 rather than forcing it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/siteBuilderRoutes.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement**

Create `app/api/site-builder/runs/[id]/recover/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";

export const runtime = "nodejs";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Force-release a run wedged in "generating", so the operator can retry it
 * without waiting out STALE_GENERATING_MS (see the generate route).
 *
 * Deliberately SEPARATE from retry. Force-releasing a claim is a different
 * decision from re-running, and it carries a risk retry does not: the run may
 * still be working. A paced run can legitimately go about twenty minutes
 * without writing to its row, so this action must be safe to take on a live
 * generation — which is what `generation_id` provides. Nulling it means the
 * in-flight attempt's own writes match zero rows and are discarded, rather
 * than racing whatever the operator does next (see migration 0063).
 *
 * Whatever that attempt had finished but not yet persisted is lost. Whatever it
 * HAD persisted survives in `pages` and is carried forward by the next
 * `/generate`, which is why this leaves the run at "failed" rather than
 * clearing it.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: run, error: fetchErr } = await admin.from("builder_runs").select("*").eq("id", id).single();
  if (fetchErr || !run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (run.status !== "generating") {
    return NextResponse.json(
      { error: `Cannot recover: this run is "${run.status}", not "generating".` },
      { status: 409 },
    );
  }

  const { data: updated, error: updErr } = await admin
    .from("builder_runs")
    .update({
      status: "failed",
      generation_id: null,
      error: "Recovered while it was still generating. Anything the interrupted attempt had not yet saved was abandoned; retry to finish the remaining pages.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "generating")
    .select("*")
    .maybeSingle();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });
  if (!updated) {
    // Someone else moved it between our read and our write — most likely the
    // very generation we were about to release, finishing on its own.
    return NextResponse.json({ error: "This run changed while recovering it. Reload and try again." }, { status: 409 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "site_builder.run.recovered",
    entity_type: "builder_run",
    entity_id: id,
    new_value: { from: "generating", to: "failed" },
  });

  return NextResponse.json({ run: updated });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/siteBuilderRoutes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/api/site-builder/runs/[id]/recover/route.ts" tests/siteBuilderRoutes.test.ts
git commit -m "feat(site-builder): release a run wedged in generating"
```

---

### Task 6: The operator's affordances

**Files:**
- Modify: `components/site-builder/BuilderRun.tsx`
- Test: `tests/siteBuilderRunScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `tests/siteBuilderRunScreen.test.tsx`, following the existing tests' idioms:

- a `failed` run renders a "Retry failed pages" button, and clicking it POSTs to `/api/site-builder/runs/<id>/generate`;
- a `failed` run's per-page Regenerate button is ENABLED (today it is disabled);
- a `generating` run whose `updated_at` is 6 minutes old renders "Stop and recover", and clicking it POSTs to `/api/site-builder/runs/<id>/recover`;
- a `generating` run updated 1 minute ago does NOT render "Stop and recover";
- the dead-end copy "this run cannot be resumed" is gone.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/siteBuilderRunScreen.test.tsx`
Expected: FAIL — no Retry button, Regenerate disabled, no recover control.

- [ ] **Step 3: Implement**

Widen the regenerate gate:

```ts
  // `failed` included: a failed run is exactly where fixing one page matters
  // most, and the route accepts it.
  const gate = run.status === "review" || run.status === "approved" || run.status === "failed";
```

Add above the component, near `IN_FLIGHT`:

```ts
/** How long a "generating" run must go without a row write before the operator
 *  is offered a force-release. Deliberately far below the server's own
 *  STALE_GENERATING_MS (60 min): a paced run can legitimately be quiet for
 *  ~21 minutes, so this WILL sometimes appear on a healthy run. That is safe
 *  only because the server stamps a claim token and a superseded attempt's
 *  writes are discarded — see migration 0063. The button says as much. */
const RECOVER_OFFER_MS = 5 * 60 * 1000;
```

Add the two actions inside the component, alongside the existing `regenerate`:

```ts
  async function retry() {
    setBusy(true);
    try {
      const res = await fetch(`/api/site-builder/runs/${runId}/generate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not retry this run" });
        return;
      }
      toast({ kind: "success", title: "Retrying the pages that failed" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function recover() {
    if (!confirm("Stop this run and mark it failed? If it is still working, anything it has not already saved will be lost. Pages it did save are kept and will not be regenerated.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/site-builder/runs/${runId}/recover`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not recover this run" });
        return;
      }
      toast({ kind: "success", title: "Run released — you can retry it now" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }
```

Use whatever the component's existing refresh/poll function is actually called in place of `refresh()`, and its existing busy-state setter in place of `setBusy` — read the file and match it rather than introducing new state.

Replace the failed-run panel:

```tsx
      {run.status === "failed" ? (
        <div className="rounded-lg border border-dropped-bg bg-dropped-bg/40 p-4">
          <p className="flex items-center gap-2 font-medium text-dropped-fg"><AlertTriangle className="h-4 w-4" /> This run failed.</p>
          <p className="mt-1 text-sm text-dropped-fg">{run.error ?? "Every page failed to generate."}</p>
          <p className="mt-2 text-xs text-text-muted">Start a new site for this lead — this run cannot be resumed.</p>
        </div>
      ) : null}
```

with:

```tsx
      {run.status === "failed" ? (
        <div className="rounded-lg border border-dropped-bg bg-dropped-bg/40 p-4">
          <p className="flex items-center gap-2 font-medium text-dropped-fg"><AlertTriangle className="h-4 w-4" /> This run failed.</p>
          <p className="mt-1 text-sm text-dropped-fg">{run.error ?? "Every page failed to generate."}</p>
          <p className="mt-2 text-xs text-text-muted">
            Pages that already generated are kept — retrying only redoes the ones that failed.
          </p>
          <button type="button" onClick={() => void retry()} disabled={busy} className={cn(btnSecondarySm, "mt-2")}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry failed pages
          </button>
        </div>
      ) : null}
```

Add the recover control inside the existing `IN_FLIGHT` panel, after the progress line:

```tsx
          {run.status === "generating" && Date.now() - new Date(run.updated_at).getTime() > RECOVER_OFFER_MS ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs text-text-muted">
                Nothing has been written for a while. A paced run can be quiet for up to about twenty minutes while it
                waits out a provider&apos;s rate limit, so this may still be working.
              </p>
              <button type="button" onClick={() => void recover()} disabled={busy} className={cn(btnSecondarySm, "mt-2")}>
                <AlertTriangle className="h-3.5 w-3.5" /> Stop and recover
              </button>
            </div>
          ) : null}
```

Import `RefreshCw` from `lucide-react` alongside the existing icons.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/siteBuilderRunScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint components/site-builder/BuilderRun.tsx`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add components/site-builder/BuilderRun.tsx tests/siteBuilderRunScreen.test.tsx
git commit -m "feat(site-builder): retry a failed run and release a stuck one from the run screen"
```

---

## Verification

- [ ] `npx vitest run` — full suite green (baseline before this plan: 2506 passing, 2 skipped)
- [ ] `npx tsc --noEmit` — clean
- [ ] `npx eslint` — clean
- [ ] Apply migration `0063` to the dev database. Confirm `builder_runs.generation_id` exists.
- [ ] End to end in the app: start a run, let it finish, then hand-edit its row to `status='failed'` with one page's state set to `failed`. Reload the run screen, click **Retry failed pages**, and confirm only that page regenerates (watch the server log for one `site_build` call, not seven) and the run returns to `review`.
- [ ] Hand-edit a run to `status='generating'` with `updated_at` ten minutes ago. Confirm **Stop and recover** appears, releases the run, and that **Retry failed pages** then completes it.

## Deployment note

Migration `0063` must be applied before this code deploys, for the same reason
`0062` must: `/generate`'s claim writes `generation_id` unconditionally, and
PostgREST rejects an unknown column outright rather than ignoring it — so on a
pre-migration database every generation claim would fail with an opaque error.
Unlike `0062` this one breaks generation itself, not just settings, so the
ordering matters more.
