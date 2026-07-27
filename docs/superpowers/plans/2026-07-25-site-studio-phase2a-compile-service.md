# Site Studio Phase 2a — Compile Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Phase 1 deterministic core into a working template *service*: upload a zip → compile → AI-enrich (identity + semantics) → certify, all via `studio.manage`-guarded API routes, with a `studio_templates` table and `studio-templates` bucket. No UI yet (Phase 2b builds the Templates board on these endpoints).

**Architecture:** Client-driven short steps — upload stores the zip and returns; compile (deterministic, seconds), enrich-identity (1 AI call), enrich-semantics (1 AI call), and certify are each their own idempotent POST the operator's browser drives in sequence. No queue, no cron, no long-lived process. **Every AI-driven mutation is applied by a pure applier and then re-verified with `verifyTemplate`; if the round-trip breaks, the mutation is reverted and a warning diagnostic recorded — AI can propose, but it can never corrupt a certified-able package.**

**Tech Stack:** Next.js app-router route handlers (this repo's fork — see conventions below), Supabase (service-role via `createAdminClient`), the Phase 1 `lib/site-studio` core, the existing AI task router (`callForTask`), vitest.

**Spec authority:** `docs/superpowers/specs/2026-07-23-site-studio-design.md` §4 (compiler & certification), §10 (data model). Phase map: this is Phase 2a of the Phase-1 plan's 4-phase ladder; Phase 2b (board UI + review drawer + sidebar entry) follows.

**Deferred out of 2a (recorded, not forgotten):** JS compile-time baking (browser-side iframe-snapshot design — Phase 2b/2c; `js_renders_dom` warns already surface the need), preview thumbnails for board cards (2b renders live previews via the preview route), `niche_tags` editing UI (column exists, 2b).

---

## Repo conventions (from live code — follow these exactly)

**Route handler idiom** (mirror `app/api/template-engine/templates/route.ts`):
- Plain `Request` param, `NextResponse.json(...)` responses, `export const runtime = "nodejs"; export const maxDuration = 300;` on heavy routes.
- Auth guard: `createClient()` from `@/lib/supabase/server` (async!) → `supabase.auth.getUser()` → `getUserPermissions(user.id)` from `@/lib/permissions/resolver` → check the perm set. 401/403 JSON errors.
- DB + storage through `createAdminClient()` from `@/lib/supabase/admin` (service role — RLS stays policy-less on new tables).
- Upload: `await req.formData()`, `form.get("file") instanceof File`, size cap, `new Uint8Array(await file.arrayBuffer())`.
- Storage: `admin.storage.from(BUCKET).upload(path, data, { contentType, upsert: true })`, batched 8-at-a-time with rollback via `.remove(paths)` on failure.
- Log notable actions to `activity_log` (`user_id, action, entity_type, entity_id, new_value`).
- Dynamic segments: `{ params }: { params: Promise<{ id: string }> }` then `const { id } = await params;` — **this Next fork uses async request APIs**. If anything about handler shape is uncertain, read `node_modules/next/dist/docs/` (AGENTS.md requirement) and mirror an existing `[id]` route under `app/api/template-engine/`.

**Permissions:** one new catalog entry in `lib/permissions/constants.ts` makes a key grantable in the admin Permissions UI (runtime grants live in `department_permissions` / `user_permission_overrides` — no seed needed).

**AI calls:** `callForTask(taskKey, systemPrompt, userPrompt, { maxTokens, temperature, signal? })` from `@/lib/ai-tools/providers/run` → `{ text, tokens, providerKey, model }`, with assignment resolution + one default-fallback retry built in. JSON parsing: `parseJsonLoose` from `@/lib/ai/json`. New task types are registered in `lib/ai-tools/providers/registry.ts` (union + descriptor + registry array).

**Hard rules (unchanged from Phase 1):** never import from `lib/template-engine/`; only `studio_`-prefixed DB objects; targeted vitest runs (`npx vitest run tests/<file>`); full `npm test` only at the final gate; `npx tsc --noEmit` needs `NODE_OPTIONS=--max-old-space-size=6144` if it OOMs; do NOT run the dev server or builds during execution; commit per task with the exact message; do not push.

**File structure (new):**

```
supabase/migrations/0051_studio_templates.sql
lib/ai-tools/providers/registry.ts            (modified: template_compile task)
lib/permissions/constants.ts                  (modified: studio.manage key)
lib/site-studio/service/types.ts              (row type, statuses, transitions)
lib/site-studio/service/templates.ts          (storage layout: save/load package, source)
lib/site-studio/service/contentType.ts        (ext → mime)
lib/site-studio/compiler/ai/applyIdentity.ts  (pure applier)
lib/site-studio/compiler/ai/identityAi.ts     (AI wrapper, injectable call)
lib/site-studio/compiler/ai/semantics.ts      (pure applier + AI wrapper)
app/api/site-studio/templates/route.ts                    (GET list, POST upload)
app/api/site-studio/templates/[id]/route.ts               (GET detail, PATCH rename, DELETE)
app/api/site-studio/templates/[id]/compile/route.ts       (POST deterministic compile)
app/api/site-studio/templates/[id]/enrich-identity/route.ts   (POST AI pass 1)
app/api/site-studio/templates/[id]/enrich-semantics/route.ts  (POST AI pass 2)
app/api/site-studio/templates/[id]/certify/route.ts       (POST)
app/api/site-studio/templates/[id]/status/route.ts        (POST guarded transitions)
app/api/site-studio/templates/[id]/preview/[[...path]]/route.ts   (GET rendered sample preview)
app/api/site-studio/templates/[id]/original/[[...path]]/route.ts  (GET source file)
tests/siteStudioServiceTypes.test.ts
tests/siteStudioApplyIdentity.test.ts
tests/siteStudioIdentityAi.test.ts
tests/siteStudioSemantics.test.ts
tests/siteStudioStoragePaths.test.ts
tests/siteStudioContentType.test.ts
```

Routes are THIN — every piece of logic that can be pure lives in `lib/site-studio/` with unit tests (this repo has no route-test infra; routes are acceptance-tested when Phase 2b's UI drives them, and via the final-gate manual smoke).

---

### Task 1: Migration 0051 — `studio_templates` + bucket

**Files:**
- Create: `supabase/migrations/0051_studio_templates.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0051_studio_templates.sql — Site Studio (template engine v3) Phase 2a.
--
-- The v3 rebuild's first table. Coexists with the old engine's
-- website_templates: zero shared objects, studio_ prefix throughout, so the
-- eventual old-engine teardown is a grep. Spec:
-- docs/superpowers/specs/2026-07-23-site-studio-design.md §10.
--
-- A row is a TEMPLATE PACKAGE in one of six states:
--   uploaded      source.zip stored; not yet compiled (or last compile hit
--                 blocker diagnostics — the diagnostics column says which)
--   needs_review  compiled clean; awaiting human review / AI enrichment
--   certified     human pressed Certify; usable for generation (Phase 3)
--   rejected      human rejected the template outright
--   disabled      certified but withheld from new runs
--
-- The compiled package's MANIFEST lives here (jsonb — it is the contract the
-- board and the renderer read constantly); the package's page/fragment/asset
-- FILES live in the studio-templates bucket under {id}/package/*, with the
-- original upload immutable at {id}/source.zip (re-compile anytime).
--
-- RLS: enabled with NO policies — service-role routes only, same posture as
-- the rest of the app's server-owned tables.

create table public.studio_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded','needs_review','certified','rejected','disabled')),
  -- bumped on every re-compile; generations (Phase 3) record the version used
  version int not null default 1,
  storage_prefix text not null,
  niche_tags text[] not null default '{}',
  -- the compiled TemplateManifest (lib/site-studio/schema.ts) — null until
  -- the first successful compile
  manifest jsonb,
  -- full Diagnostic[] from the last compile + enrichments, newest run replaces
  diagnostics jsonb not null default '[]'::jsonb,
  compiled_at timestamptz,
  identity_enriched_at timestamptz,
  semantics_enriched_at timestamptz,
  certified_by uuid references auth.users (id) on delete set null,
  certified_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.studio_templates enable row level security;

-- private bucket for source zips + compiled packages
insert into storage.buckets (id, name, public)
values ('studio-templates', 'studio-templates', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: Commit (file only — application is gated)**

```bash
git add supabase/migrations/0051_studio_templates.sql
git commit -m "feat(site-studio): migration 0051 - studio_templates table + bucket"
```

**IMPORTANT:** Do NOT apply this migration to the database during this task. The DB is the SHARED PRODUCTION Supabase project. Application happens at Task 14, and only after asking the user (or with their standing approval in that task's context).

---

### Task 2: `template_compile` task type in the AI registry

**Files:**
- Modify: `lib/ai-tools/providers/registry.ts`
- Tests: run `tests/aiProviderRegistry.test.ts` + `tests/aiTaskRouting.test.ts`; extend ONLY if they enumerate task keys and now fail.

- [ ] **Step 1: Extend the union**

In `registry.ts`, change:

```ts
export type AiTaskKey = "content_plan" | "file_regen" | "image_vision" | "legacy_v1";
```
to:
```ts
export type AiTaskKey = "content_plan" | "file_regen" | "image_vision" | "legacy_v1" | "template_compile";
```

- [ ] **Step 2: Add the descriptor** (after `legacyV1`, before `AI_TASK_REGISTRY`):

```ts
const templateCompile: AiTaskDescriptor = {
  key: "template_compile",
  label: "Template compile (Site Studio)",
  description:
    "One or two short calls per template upload: finds residual demo identity (person names, addresses, places) the deterministic pass cannot, and labels pages/slots semantically. Strict JSON out; a model that drifts into prose is rejected and the template simply stays un-enriched.",
  where: "lib/site-studio/compiler/ai/*",
  requires: { vision: false, minOutputTokens: 8000 },
  defaultProvider: "gemini",
  defaultModel: "gemini-3.1-pro-preview",
  routable: true,
};
```

and register it:

```ts
export const AI_TASK_REGISTRY: AiTaskDescriptor[] = [contentPlan, fileRegen, imageVision, legacyV1, templateCompile];
```

- [ ] **Step 3: Verify existing tests**

Run: `npx vitest run tests/aiProviderRegistry.test.ts tests/aiTaskRouting.test.ts tests/aiTools.test.ts`
Expected: PASS. If a test asserts the exact task list, extend its expectation to include `template_compile` (do not weaken any other assertion). The admin AI-models page reads the registry, so the new task appears there automatically with its default assignment.

- [ ] **Step 4: Commit**

```bash
git add lib/ai-tools/providers/registry.ts tests/aiProviderRegistry.test.ts tests/aiTaskRouting.test.ts
git commit -m "feat(site-studio): template_compile task type in the AI registry"
```

(Include the test files in the add only if you modified them.)

---

### Task 3: Service types — statuses and transitions

**Files:**
- Create: `lib/site-studio/service/types.ts`
- Test: `tests/siteStudioServiceTypes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { STUDIO_STATUSES, canTransition } from "@/lib/site-studio/service/types";

describe("studio template status transitions", () => {
  it("declares the six statuses", () => {
    expect(STUDIO_STATUSES).toEqual(["uploaded", "needs_review", "certified", "rejected", "disabled"]);
  });
  it("allows the operator transitions and nothing else", () => {
    expect(canTransition("needs_review", "rejected")).toBe(true);
    expect(canTransition("certified", "disabled")).toBe(true);
    expect(canTransition("disabled", "certified")).toBe(true);
    expect(canTransition("rejected", "needs_review")).toBe(true);
    // certification is NOT a generic transition — it has its own route with
    // preconditions (zero blockers), so the generic map refuses it:
    expect(canTransition("needs_review", "certified")).toBe(false);
    // compile owns uploaded→needs_review:
    expect(canTransition("uploaded", "needs_review")).toBe(false);
    expect(canTransition("certified", "rejected")).toBe(false);
  });
});
```

Run: `npx vitest run tests/siteStudioServiceTypes.test.ts` — FAIL (module not found).

- [ ] **Step 2: Implement `lib/site-studio/service/types.ts`**

```ts
import type { Diagnostic, TemplateManifest } from "../schema";

export const STUDIO_STATUSES = ["uploaded", "needs_review", "certified", "rejected", "disabled"] as const;
export type StudioTemplateStatus = (typeof STUDIO_STATUSES)[number];

/** What the generic /status route may do. Compile owns uploaded→needs_review;
 *  the certify route owns needs_review→certified (it checks blockers first). */
const ALLOWED: Record<string, StudioTemplateStatus[]> = {
  needs_review: ["rejected"],
  certified: ["disabled"],
  disabled: ["certified"],
  rejected: ["needs_review"],
};

export function canTransition(from: string, to: string): boolean {
  return (ALLOWED[from] ?? []).includes(to as StudioTemplateStatus);
}

/** The studio_templates row as routes read/write it. */
export interface StudioTemplateRow {
  id: string;
  name: string;
  status: StudioTemplateStatus;
  version: number;
  storage_prefix: string;
  niche_tags: string[];
  manifest: TemplateManifest | null;
  diagnostics: Diagnostic[];
  compiled_at: string | null;
  identity_enriched_at: string | null;
  semantics_enriched_at: string | null;
  certified_by: string | null;
  certified_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Run test — PASS. Commit**

```bash
git add lib/site-studio/service/types.ts tests/siteStudioServiceTypes.test.ts
git commit -m "feat(site-studio): service types - statuses and guarded transitions"
```

---

### Task 4: Pure identity applier

The AI proposes; this pure function applies — word-bounded tokenization of ADDITIONAL identity (person names, addresses, places) across the compiled package: page skeletons, fragments, and every manifest sample (titles, slots, repeat rows, repeat slot samples, nav item labels). The service layer (Task 12's routes) re-verifies the round-trip afterward and reverts on any blocker.

**Files:**
- Create: `lib/site-studio/compiler/ai/applyIdentity.ts`
- Test: `tests/siteStudioApplyIdentity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { applyIdentityAdditions } from "@/lib/site-studio/compiler/ai/applyIdentity";
import type { CompiledTemplate } from "@/lib/site-studio/schema";

const tpl = (): CompiledTemplate => ({
  manifest: {
    engine: 3, name: "t", version: 1,
    identity: { business_name: "Demo Co", phone: "(111) 111-1111" },
    theme: { mode: "none", roles: {} },
    nav: [{ id: "n", fragment: "n", location: "header", items: [{ page_id: "index", href: "index.html", label: "Meet John Carpenter" }] }],
    pages: [{
      id: "index", file: "index.html", kind: "home", stampable: false,
      title_sample: "Demo Co | Denver's finest",
      slots: [{ id: "s1", type: "text", sample: "Founded by John Carpenter in Denver.", html: false, max_chars: 60 }],
      repeats: [{ id: "r1", fragment: "r1", min: 1, max: 12,
        slots: [{ id: "r1_s1", type: "text", sample: "John Carpenter approves", html: false, max_chars: 40 }],
        samples: [{ r1_s1: "John Carpenter approves" }] }],
    }],
  },
  pages: { "index.html": `<p>{{slot:s1}}</p><p>Call John Carpenter — serving Denver since 1999.</p>` },
  fragments: { r1: `<div>{{slot:r1_s1}}</div>`, n: `<li><a href="{{nav:href}}">{{nav:title}}</a></li>` },
  assets: {},
});

describe("applyIdentityAdditions", () => {
  it("tokenizes a person name everywhere: skeleton, samples, repeat rows, nav labels", () => {
    const r = applyIdentityAdditions(tpl(), [
      { key: "owner_name", value: "John Carpenter" },
      { key: "city", value: "Denver" },
    ]);
    expect(r.applied.map((a) => a.key).sort()).toEqual(["city", "owner_name"]);
    expect(r.template.manifest.identity.owner_name).toBe("John Carpenter");
    const skel = r.template.pages["index.html"];
    expect(skel).not.toContain("John Carpenter");
    expect(skel).toContain("{{id:owner_name}}");
    expect(skel).toContain("{{id:city}}");
    const page = r.template.manifest.pages[0];
    expect(page.slots[0].sample).toBe("Founded by {{id:owner_name}} in {{id:city}}.");
    expect(page.repeats[0].samples[0].r1_s1).toBe("{{id:owner_name}} approves");
    expect(page.title_sample).toContain("{{id:city}}");
    expect(r.template.manifest.nav[0].items![0].label).toBe("Meet {{id:owner_name}}");
  });
  it("does not mutate the input template", () => {
    const input = tpl();
    applyIdentityAdditions(input, [{ key: "owner_name", value: "John Carpenter" }]);
    expect(input.pages["index.html"]).toContain("John Carpenter");
  });
  it("skips: existing key, short value, token-bearing value, all-lowercase value, not-found value", () => {
    const r = applyIdentityAdditions(tpl(), [
      { key: "business_name", value: "Someone Else" },
      { key: "x", value: "Jo" },
      { key: "bad", value: "has {{id:phone}} inside" },
      { key: "generic", value: "denver" },
      { key: "ghost", value: "Nobody Here" },
    ]);
    expect(r.applied).toEqual([]);
    expect(r.skipped.map((s) => s.key).sort()).toEqual(["bad", "business_name", "generic", "ghost", "x"]);
  });
  it("word-bounds: 'Denver' must not match inside 'Denverite'", () => {
    const t = tpl();
    t.pages["index.html"] = `<p>A true Denverite in Denver.</p>`;
    const r = applyIdentityAdditions(t, [{ key: "city", value: "Denver" }]);
    expect(r.template.pages["index.html"]).toBe(`<p>A true Denverite in {{id:city}}.</p>`);
  });
});
```

Run: `npx vitest run tests/siteStudioApplyIdentity.test.ts` — FAIL (module not found).

- [ ] **Step 2: Implement `lib/site-studio/compiler/ai/applyIdentity.ts`**

```ts
import type { CompiledTemplate } from "../../schema";
import { idToken } from "../../tokens";

export interface IdentityAddition { key: string; value: string }
export interface ApplyIdentityResult {
  template: CompiledTemplate;
  applied: IdentityAddition[];
  skipped: { key: string; value: string; reason: string }[];
}

const KEY_RE = /^[a-z][a-z0-9_]{1,30}$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Word-bounded global replace on a plain string (same lookaround rule the
 *  deterministic identity pass uses — boundaries judged on what surrounds the
 *  match, so names ending in punctuation still work). */
const replaceBounded = (text: string, value: string, token: string): { text: string; hits: number } => {
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(value)}(?![A-Za-z0-9])`, "g");
  let hits = 0;
  const out = text.replace(re, () => { hits++; return token; });
  return { text: out, hits };
};

/**
 * Apply AI-proposed identity additions to a compiled package. PURE — deep
 * clones, never mutates the input. The caller re-runs verifyTemplate on the
 * result and reverts if the round-trip breaks; this function's own guards are
 * the cheap, obvious ones.
 */
export function applyIdentityAdditions(
  input: CompiledTemplate,
  additions: IdentityAddition[],
): ApplyIdentityResult {
  const template = structuredClone(input);
  const applied: IdentityAddition[] = [];
  const skipped: ApplyIdentityResult["skipped"] = [];

  for (const raw of additions) {
    const key = (raw.key ?? "").trim();
    const value = (raw.value ?? "").trim();
    const skip = (reason: string) => skipped.push({ key, value, reason });

    if (!KEY_RE.test(key)) { skip("invalid key"); continue; }
    if (key in template.manifest.identity) { skip("key already exists"); continue; }
    if (value.length < 3) { skip("value too short"); continue; }
    if (value.includes("{{") || value.includes("<!--")) { skip("value contains token syntax"); continue; }
    // an all-lowercase single word ("denver", "roofing") is far likelier to be
    // vocabulary or a path segment than identity — real names/places carry a
    // capital, a space, or a digit. AI must quote the VERBATIM casing.
    if (/^[a-z]+$/.test(value)) { skip("value too generic (all-lowercase word)"); continue; }
    if (Object.values(template.manifest.identity).some((v) => v === value)) { skip("value already tokenized"); continue; }

    const token = idToken(key);
    let hits = 0;
    const sub = (s: string): string => {
      const r = replaceBounded(s, value, token);
      hits += r.hits;
      return r.text;
    };

    // hold results until we know the addition lands (hits > 0)
    const pages: Record<string, string> = {};
    for (const [f, html] of Object.entries(template.pages)) pages[f] = sub(html);
    const fragments: Record<string, string> = {};
    for (const [f, html] of Object.entries(template.fragments)) fragments[f] = sub(html);
    const manifest = structuredClone(template.manifest);
    for (const page of manifest.pages) {
      page.title_sample = sub(page.title_sample);
      for (const s of page.slots) s.sample = sub(s.sample);
      for (const rep of page.repeats) {
        for (const s of rep.slots) s.sample = sub(s.sample);
        rep.samples = rep.samples.map((row) =>
          Object.fromEntries(Object.entries(row).map(([k, v]) => [k, sub(v)])));
      }
    }
    for (const region of manifest.nav) {
      if (region.items) for (const it of region.items) it.label = sub(it.label);
    }

    if (hits === 0) { skip("value not found in package"); continue; }

    template.pages = pages;
    template.fragments = fragments;
    template.manifest = manifest;
    template.manifest.identity[key] = value;
    applied.push({ key, value });
  }

  return { template, applied, skipped };
}
```

- [ ] **Step 3: Run test — PASS. Commit**

```bash
git add lib/site-studio/compiler/ai/applyIdentity.ts tests/siteStudioApplyIdentity.test.ts
git commit -m "feat(site-studio): pure applier for AI-proposed identity additions"
```

---

### Task 5: Identity AI wrapper (injectable model call)

**Files:**
- Create: `lib/site-studio/compiler/ai/identityAi.ts`
- Test: `tests/siteStudioIdentityAi.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { proposeIdentityAdditions, identityCorpus } from "@/lib/site-studio/compiler/ai/identityAi";
import type { CompiledTemplate } from "@/lib/site-studio/schema";

const tpl: CompiledTemplate = {
  manifest: {
    engine: 3, name: "t", version: 1,
    identity: { business_name: "Demo Co" },
    theme: { mode: "none", roles: {} },
    nav: [],
    pages: [{
      id: "index", file: "index.html", kind: "home", stampable: false,
      title_sample: "Demo Co",
      slots: [{ id: "s1", type: "text", sample: "Founded by John Carpenter at 42 Elm Street.", html: false, max_chars: 80 }],
      repeats: [],
    }],
  },
  pages: {}, fragments: {}, assets: {},
});

describe("identityCorpus", () => {
  it("collects samples and existing identity, capped", () => {
    const c = identityCorpus(tpl);
    expect(c).toContain("John Carpenter");
    expect(c).toContain("Demo Co");
    expect(c.length).toBeLessThanOrEqual(8000);
  });
});

describe("proposeIdentityAdditions", () => {
  it("parses a strict-JSON reply into additions", async () => {
    const call = async () => ({ text: `{"additions":[{"key":"owner_name","value":"John Carpenter"},{"key":"street","value":"42 Elm Street"}]}` });
    const { additions, diagnostics } = await proposeIdentityAdditions(tpl, call);
    expect(additions).toEqual([
      { key: "owner_name", value: "John Carpenter" },
      { key: "street", value: "42 Elm Street" },
    ]);
    expect(diagnostics).toEqual([]);
  });
  it("tolerates fenced JSON and junk around it", async () => {
    const call = async () => ({ text: "Sure! ```json\n{\"additions\":[{\"key\":\"owner_name\",\"value\":\"John Carpenter\"}]}\n```" });
    const { additions } = await proposeIdentityAdditions(tpl, call);
    expect(additions).toHaveLength(1);
  });
  it("unparseable reply → empty additions + warn diagnostic, never a throw", async () => {
    const call = async () => ({ text: "I could not find anything." });
    const { additions, diagnostics } = await proposeIdentityAdditions(tpl, call);
    expect(additions).toEqual([]);
    expect(diagnostics.some((d) => d.code === "ai_identity_unparseable" && d.level === "warn")).toBe(true);
  });
  it("caps at 20 and drops malformed entries", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `k_${i}`, value: `Value Number ${i}` }));
    const call = async () => ({ text: JSON.stringify({ additions: [...many, { key: 5 }, "junk"] }) });
    const { additions } = await proposeIdentityAdditions(tpl, call);
    expect(additions).toHaveLength(20);
  });
});
```

Run: `npx vitest run tests/siteStudioIdentityAi.test.ts` — FAIL.

- [ ] **Step 2: Implement `lib/site-studio/compiler/ai/identityAi.ts`**

```ts
import { parseJsonLoose } from "@/lib/ai/json";
import type { CompiledTemplate, Diagnostic } from "../../schema";
import type { IdentityAddition } from "./applyIdentity";

/** The model-call seam. Production passes callForTask("template_compile", ...);
 *  tests pass a stub. Kept minimal so no route/network types leak in here. */
export type AiCall = (system: string, user: string) => Promise<{ text: string }>;

const MAX_CORPUS = 8000;
const MAX_ADDITIONS = 20;

/** Unique human-visible strings of the package, for the model to hunt in. */
export function identityCorpus(tpl: CompiledTemplate): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t.length >= 3 && !seen.has(t)) { seen.add(t); parts.push(t); }
  };
  add(`EXISTING IDENTITY: ${JSON.stringify(tpl.manifest.identity)}`);
  for (const page of tpl.manifest.pages) {
    add(page.title_sample);
    for (const s of page.slots) add(s.sample);
    for (const rep of page.repeats) {
      for (const row of rep.samples) for (const v of Object.values(row)) add(v);
    }
  }
  for (const region of tpl.manifest.nav) {
    if (region.items) for (const it of region.items) add(it.label);
  }
  return parts.join("\n").slice(0, MAX_CORPUS);
}

const SYSTEM = `You audit website template text for RESIDUAL demo-business identity that a deterministic pass already missed. The deterministic pass has already tokenized: phone numbers, email addresses, map embeds, the business name, and copyright years — those appear as {{id:*}} tokens and are NOT your job.

You hunt ONLY for: person names, street addresses, city/region/neighborhood names, and social-media handles that identify the DEMO business. Every value you return MUST appear VERBATIM (exact casing) in the provided text. Never propose trade vocabulary ("roofing", "kitchen remodel"), never propose generic words, never invent anything.

Reply with STRICT JSON only, no prose, no fences:
{"additions":[{"key":"<snake_case_key>","value":"<verbatim text>"}]}
Keys: short snake_case like owner_name, street_address, city_2, instagram_handle. Empty findings: {"additions":[]}`;

export async function proposeIdentityAdditions(
  tpl: CompiledTemplate,
  call: AiCall,
): Promise<{ additions: IdentityAddition[]; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const { text } = await call(SYSTEM, `TEMPLATE TEXT:\n${identityCorpus(tpl)}`);
  const json = parseJsonLoose<{ additions?: unknown }>(text);
  const rawList = Array.isArray((json as { additions?: unknown } | null)?.additions)
    ? ((json as { additions: unknown[] }).additions)
    : null;
  if (!rawList) {
    diagnostics.push({
      level: "warn", code: "ai_identity_unparseable",
      message: "The identity-enrichment model did not return usable JSON; the template stays un-enriched (re-run to retry).",
    });
    return { additions: [], diagnostics };
  }
  const additions: IdentityAddition[] = [];
  for (const entry of rawList) {
    if (additions.length >= MAX_ADDITIONS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { key, value } = entry as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || typeof value !== "string") continue;
    additions.push({ key, value });
  }
  return { additions, diagnostics };
}
```

- [ ] **Step 3: Run test — PASS. Commit**

```bash
git add lib/site-studio/compiler/ai/identityAi.ts tests/siteStudioIdentityAi.test.ts
git commit -m "feat(site-studio): identity enrichment AI wrapper with injectable call"
```

---

### Task 6: Semantics — pure applier + AI wrapper

Page-kind classification is what finally makes `stampable` (fan-out) live: a page the AI labels singular `service`/`area` becomes stampable. Slot semantic labels feed Phase 3's Writer prompts.

**Files:**
- Create: `lib/site-studio/compiler/ai/semantics.ts`
- Test: `tests/siteStudioSemantics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { applySemantics, proposeSemantics, SEMANTIC_LABELS } from "@/lib/site-studio/compiler/ai/semantics";
import type { CompiledTemplate } from "@/lib/site-studio/schema";

const tpl = (): CompiledTemplate => ({
  manifest: {
    engine: 3, name: "t", version: 1,
    identity: {}, theme: { mode: "none", roles: {} }, nav: [],
    pages: [
      { id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home",
        slots: [{ id: "s1", type: "text", sample: "Big headline here", html: false, max_chars: 40 }],
        repeats: [{ id: "r1", fragment: "r1", min: 1, max: 12,
          slots: [{ id: "r1_s1", type: "text", sample: "Card", html: false, max_chars: 40 }], samples: [{ r1_s1: "Card" }] }] },
      { id: "drain", file: "drain.html", kind: "generic", stampable: false, title_sample: "Drain Cleaning",
        slots: [], repeats: [] },
    ],
  },
  pages: {}, fragments: {}, assets: {},
});

describe("applySemantics", () => {
  it("sets page kinds, recomputes stampable, labels slots (incl. repeat slots)", () => {
    const { template, diagnostics } = applySemantics(tpl(), {
      pages: [{ id: "drain", kind: "service" }],
      slots: [{ id: "s1", semantic: "headline" }, { id: "r1_s1", semantic: "label" }],
    });
    const drain = template.manifest.pages.find((p) => p.id === "drain")!;
    expect(drain.kind).toBe("service");
    expect(drain.stampable).toBe(true);
    expect(template.manifest.pages[0].slots[0].semantic).toBe("headline");
    expect(template.manifest.pages[0].repeats[0].slots[0].semantic).toBe("label");
    expect(diagnostics).toEqual([]);
  });
  it("rejects unknown kinds/labels/ids with warn diagnostics, applies the rest", () => {
    const { template, diagnostics } = applySemantics(tpl(), {
      pages: [{ id: "drain", kind: "landing" }, { id: "ghost", kind: "service" }],
      slots: [{ id: "s1", semantic: "sparkly" }, { id: "nope", semantic: "headline" }],
    });
    expect(template.manifest.pages.find((p) => p.id === "drain")!.kind).toBe("generic");
    expect(diagnostics.filter((d) => d.code === "ai_semantics_rejected")).toHaveLength(4);
  });
  it("does not mutate the input", () => {
    const input = tpl();
    applySemantics(input, { pages: [{ id: "drain", kind: "service" }], slots: [] });
    expect(input.manifest.pages.find((p) => p.id === "drain")!.kind).toBe("generic");
  });
});

describe("proposeSemantics", () => {
  it("parses strict JSON", async () => {
    const call = async () => ({ text: `{"pages":[{"id":"drain","kind":"service"}],"slots":[{"id":"s1","semantic":"headline"}]}` });
    const { proposal, diagnostics } = await proposeSemantics(tpl(), call);
    expect(proposal.pages).toEqual([{ id: "drain", kind: "service" }]);
    expect(diagnostics).toEqual([]);
  });
  it("unparseable → empty proposal + warn", async () => {
    const call = async () => ({ text: "nah" });
    const { proposal, diagnostics } = await proposeSemantics(tpl(), call);
    expect(proposal).toEqual({ pages: [], slots: [] });
    expect(diagnostics.some((d) => d.code === "ai_semantics_unparseable")).toBe(true);
  });
  it("SEMANTIC_LABELS is the closed vocabulary", () => {
    expect(SEMANTIC_LABELS).toContain("headline");
    expect(SEMANTIC_LABELS).toContain("cta");
  });
});
```

Run: `npx vitest run tests/siteStudioSemantics.test.ts` — FAIL (module not found).

- [ ] **Step 2: Implement `lib/site-studio/compiler/ai/semantics.ts`**

```ts
import { parseJsonLoose } from "@/lib/ai/json";
import { PAGE_KINDS, type CompiledTemplate, type Diagnostic, type PageKind } from "../../schema";
import type { AiCall } from "./identityAi";

export const SEMANTIC_LABELS = ["headline", "subheadline", "body", "cta", "quote", "list_item", "label", "other"] as const;
export type SemanticLabel = (typeof SEMANTIC_LABELS)[number];

export interface SemanticsProposal {
  pages: { id: string; kind: string }[];
  slots: { id: string; semantic: string }[];
}

/** Apply a proposal. PURE (clones). Unknown ids/kinds/labels are individually
 *  rejected with warn diagnostics; valid entries still apply. */
export function applySemantics(
  input: CompiledTemplate,
  proposal: SemanticsProposal,
): { template: CompiledTemplate; diagnostics: Diagnostic[] } {
  const template = structuredClone(input);
  const diagnostics: Diagnostic[] = [];
  const reject = (what: string) =>
    diagnostics.push({ level: "warn", code: "ai_semantics_rejected", message: `Semantics proposal rejected: ${what}` });

  const byId = new Map(template.manifest.pages.map((p) => [p.id, p]));
  for (const { id, kind } of proposal.pages) {
    const page = byId.get(id);
    if (!page) { reject(`unknown page "${id}"`); continue; }
    if (!(PAGE_KINDS as readonly string[]).includes(kind)) { reject(`unknown kind "${kind}" for page "${id}"`); continue; }
    page.kind = kind as PageKind;
    page.stampable = kind === "service" || kind === "area";
  }

  // slot ids are unique across the whole manifest (page-scoped prefixes)
  const slotById = new Map<string, { semantic?: string }>();
  for (const page of template.manifest.pages) {
    for (const s of page.slots) slotById.set(s.id, s);
    for (const rep of page.repeats) for (const s of rep.slots) slotById.set(s.id, s);
  }
  for (const { id, semantic } of proposal.slots) {
    const slot = slotById.get(id);
    if (!slot) { reject(`unknown slot "${id}"`); continue; }
    if (!(SEMANTIC_LABELS as readonly string[]).includes(semantic)) { reject(`unknown label "${semantic}" for slot "${id}"`); continue; }
    slot.semantic = semantic;
  }

  return { template, diagnostics };
}

const SYSTEM = `You classify website template structure. Given a list of PAGES (id, filename, title, sample text) and SLOTS (id, sample text), reply with STRICT JSON only:
{"pages":[{"id":"...","kind":"<one of: ${PAGE_KINDS.join(" | ")}>"}],"slots":[{"id":"...","semantic":"<one of: ${SEMANTIC_LABELS.join(" | ")}>"}]}
Rules: "service" = a page about ONE specific service (stampable per-service); "services_hub" = the overview listing many. Same distinction for "area"/"areas_hub". Only include pages whose current kind is wrong and slots worth labeling. No prose, no fences.`;

export async function proposeSemantics(
  tpl: CompiledTemplate,
  call: AiCall,
): Promise<{ proposal: SemanticsProposal; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const lines: string[] = ["PAGES:"];
  for (const p of tpl.manifest.pages) {
    const preview = p.slots.slice(0, 3).map((s) => s.sample).join(" | ").slice(0, 200);
    lines.push(`- id=${p.id} file=${p.file} current_kind=${p.kind} title=${JSON.stringify(p.title_sample)} text=${JSON.stringify(preview)}`);
  }
  lines.push("SLOTS:");
  for (const p of tpl.manifest.pages) {
    for (const s of p.slots) lines.push(`- id=${s.id} sample=${JSON.stringify(s.sample.slice(0, 120))}`);
    for (const rep of p.repeats) for (const s of rep.slots) lines.push(`- id=${s.id} sample=${JSON.stringify(s.sample.slice(0, 120))}`);
  }
  const { text } = await call(SYSTEM, lines.join("\n").slice(0, 8000));
  const json = parseJsonLoose<Partial<SemanticsProposal>>(text);
  const pages = Array.isArray(json?.pages) ? json!.pages!.filter((e) => e && typeof e.id === "string" && typeof e.kind === "string") : null;
  const slots = Array.isArray(json?.slots) ? json!.slots!.filter((e) => e && typeof e.id === "string" && typeof e.semantic === "string") : null;
  if (pages === null && slots === null) {
    diagnostics.push({
      level: "warn", code: "ai_semantics_unparseable",
      message: "The semantics model did not return usable JSON; page kinds/labels unchanged (re-run to retry).",
    });
    return { proposal: { pages: [], slots: [] }, diagnostics };
  }
  return { proposal: { pages: pages ?? [], slots: slots ?? [] }, diagnostics };
}
```

- [ ] **Step 3: Run test — PASS. Commit**

```bash
git add lib/site-studio/compiler/ai/semantics.ts tests/siteStudioSemantics.test.ts
git commit -m "feat(site-studio): semantics AI pass - page kinds and slot labels"
```

---

### Task 7: Storage service + content types

**Files:**
- Create: `lib/site-studio/service/templates.ts`
- Create: `lib/site-studio/service/contentType.ts`
- Test: `tests/siteStudioStoragePaths.test.ts`, `tests/siteStudioContentType.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/siteStudioContentType.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { contentTypeFor } from "@/lib/site-studio/service/contentType";

describe("contentTypeFor", () => {
  it("maps common web types", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("css/style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("img/a.jpg")).toBe("image/jpeg");
    expect(contentTypeFor("img/a.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("font.woff2")).toBe("font/woff2");
    expect(contentTypeFor("data.json")).toBe("application/json");
    expect(contentTypeFor("unknown.xyz")).toBe("application/octet-stream");
  });
});
```

`tests/siteStudioStoragePaths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sourcePath, packageFilePath, packageIndex, INDEX_PATH } from "@/lib/site-studio/service/templates";
import type { CompiledTemplate } from "@/lib/site-studio/schema";

const tpl: CompiledTemplate = {
  manifest: { engine: 3, name: "t", version: 1, identity: {}, theme: { mode: "none", roles: {} }, nav: [], pages: [
    { id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "", slots: [], repeats: [] },
  ] },
  pages: { "index.html": "<html></html>" },
  fragments: { nav_header: "<li></li>" },
  assets: { "css/style.css": new TextEncoder().encode("body{}") },
};

describe("storage layout", () => {
  it("builds spec §3 paths", () => {
    expect(sourcePath("abc")).toBe("abc/source.zip");
    expect(INDEX_PATH("abc")).toBe("abc/package/index.json");
    expect(packageFilePath("abc", "pages", "index.html")).toBe("abc/package/pages/index.html");
    expect(packageFilePath("abc", "assets", "css/style.css")).toBe("abc/package/assets/css/style.css");
  });
  it("indexes every package file", () => {
    expect(packageIndex(tpl)).toEqual({
      pages: ["index.html"],
      fragments: ["nav_header"],
      assets: ["css/style.css"],
    });
  });
});
```

Run both — FAIL.

- [ ] **Step 2: Implement**

`lib/site-studio/service/contentType.ts`:

```ts
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  json: "application/json", xml: "application/xml", txt: "text/plain; charset=utf-8",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  pdf: "application/pdf", mp4: "video/mp4", webm: "video/webm",
};

export function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return TYPES[ext] ?? "application/octet-stream";
}
```

`lib/site-studio/service/templates.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompiledTemplate, FileMap, TemplateManifest } from "../schema";
import { unzipToMap } from "../zip";
import { contentTypeFor } from "./contentType";

export const STUDIO_BUCKET = "studio-templates";

export const sourcePath = (id: string) => `${id}/source.zip`;
export const INDEX_PATH = (id: string) => `${id}/package/index.json`;
export const packageFilePath = (id: string, kind: "pages" | "fragments" | "assets", file: string) =>
  `${id}/package/${kind}/${file}`;

export interface PackageIndex { pages: string[]; fragments: string[]; assets: string[] }

export function packageIndex(tpl: CompiledTemplate): PackageIndex {
  return {
    pages: Object.keys(tpl.pages),
    fragments: Object.keys(tpl.fragments),
    assets: Object.keys(tpl.assets),
  };
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: ArrayBuffer | Uint8Array) => new TextDecoder().decode(b instanceof Uint8Array ? b : new Uint8Array(b));

async function uploadBatch(admin: SupabaseClient, entries: [string, Uint8Array][]): Promise<void> {
  for (let i = 0; i < entries.length; i += 8) {
    const results = await Promise.all(
      entries.slice(i, i + 8).map(([path, data]) =>
        admin.storage.from(STUDIO_BUCKET).upload(path, data, { contentType: contentTypeFor(path), upsert: true })),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) throw new Error(`Package upload failed: ${failed.error.message}`);
  }
}

/** Persist a compiled package's FILES (manifest goes to the DB row, not here). */
export async function savePackage(admin: SupabaseClient, id: string, tpl: CompiledTemplate): Promise<void> {
  const entries: [string, Uint8Array][] = [
    [INDEX_PATH(id), enc(JSON.stringify(packageIndex(tpl)))],
    ...Object.entries(tpl.pages).map(([f, html]): [string, Uint8Array] => [packageFilePath(id, "pages", f), enc(html)]),
    ...Object.entries(tpl.fragments).map(([f, html]): [string, Uint8Array] => [packageFilePath(id, "fragments", f), enc(html)]),
    ...Object.entries(tpl.assets).map(([f, bytes]): [string, Uint8Array] => [packageFilePath(id, "assets", f), bytes]),
  ];
  await uploadBatch(admin, entries);
}

async function download(admin: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(STUDIO_BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed for ${path}: ${error?.message ?? "no data"}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** Rehydrate a CompiledTemplate from storage + the DB row's manifest. */
export async function loadPackage(admin: SupabaseClient, id: string, manifest: TemplateManifest): Promise<CompiledTemplate> {
  const index = JSON.parse(dec(await download(admin, INDEX_PATH(id)))) as PackageIndex;
  const pages: Record<string, string> = {};
  const fragments: Record<string, string> = {};
  const assets: FileMap = {};
  for (const f of index.pages) pages[f] = dec(await download(admin, packageFilePath(id, "pages", f)));
  for (const f of index.fragments) fragments[f] = dec(await download(admin, packageFilePath(id, "fragments", f)));
  for (const f of index.assets) assets[f] = await download(admin, packageFilePath(id, "assets", f));
  return { manifest, pages, fragments, assets };
}

/** The original upload, as a FileMap (for verifyTemplate and /original serving). */
export async function loadSourceMap(admin: SupabaseClient, id: string): Promise<FileMap> {
  return unzipToMap(await download(admin, sourcePath(id)));
}

/** Remove everything this template owns in storage (delete/replace flows). */
export async function removeAllFiles(admin: SupabaseClient, id: string): Promise<void> {
  // Storage list() is folder-scoped. A template package is dozens of files,
  // not thousands, so a two-level walk with a high limit is enough.
  const paths: string[] = [sourcePath(id), INDEX_PATH(id)];
  for (const kind of ["pages", "fragments", "assets"] as const) {
    const base = `${id}/package/${kind}`;
    const { data } = await admin.storage.from(STUDIO_BUCKET).list(base, { limit: 1000 });
    for (const f of data ?? []) {
      if (f.id === null) {
        // folder entry (e.g. css/, img/) — list one level down
        const { data: sub } = await admin.storage.from(STUDIO_BUCKET).list(`${base}/${f.name}`, { limit: 1000 });
        for (const s of sub ?? []) paths.push(`${base}/${f.name}/${s.name}`);
      } else {
        paths.push(`${base}/${f.name}`);
      }
    }
  }
  await admin.storage.from(STUDIO_BUCKET).remove(paths);
}
```

Note: `assets`/`pages` keys may contain slashes (`css/style.css`, `sub/page.html`) — Supabase storage treats them as folders transparently on upload/download; only `removeAllFiles` needs the walk. Folder detection via `f.id === null` is the storage API's convention (folders have no object id); verify against the installed client at execution and adapt minimally if the shape differs — the TEST for this module covers only the pure helpers, so verify removeAllFiles by hand at the final gate.

- [ ] **Step 3: Run tests — PASS. Commit**

```bash
git add lib/site-studio/service/templates.ts lib/site-studio/service/contentType.ts tests/siteStudioStoragePaths.test.ts tests/siteStudioContentType.test.ts
git commit -m "feat(site-studio): storage service - package save/load + content types"
```

---

### Task 8: `studio.manage` permission key + route guard helper

**Files:**
- Modify: `lib/permissions/constants.ts`
- Create: `lib/site-studio/service/guard.ts`

- [ ] **Step 1: Add the catalog entry**

In the `PERMISSIONS` array in `lib/permissions/constants.ts`, directly after the `analytics.view_templates` entry (keeps the templates grouping together):

```ts
  { key: "studio.manage", name: "Manage Site Studio (Template Engine v3)", category: "templates", is_sensitive: true },
```

- [ ] **Step 2: Create the shared route guard** — `lib/site-studio/service/guard.ts` (route files may only export HTTP methods, so the guard lives here and every Site Studio route imports it):

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";

/** Auth + permission gate for every Site Studio route. */
export async function guard(): Promise<{ error: 401 | 403 } | { userId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("studio.manage")) return { error: 403 };
  return { userId: user.id };
}

export function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}
```

- [ ] **Step 3: Verify + commit**

If any test enumerates the permission catalog (`grep -rln "PERMISSIONS" tests/`), run it and extend expectations. Then:

```bash
git add lib/permissions/constants.ts lib/site-studio/service/guard.ts
git commit -m "feat(site-studio): studio.manage permission key + shared route guard"
```

(Granting the key to a department/user happens in the admin Permissions UI at acceptance time — no seed required.)

---

### Task 9: Routes — list + upload

**Files:**
- Create: `app/api/site-studio/templates/route.ts`

Before writing: read `app/api/template-engine/templates/route.ts` (the idiom source) and, for any handler-shape doubt on this Next fork, the guides under `node_modules/next/dist/docs/` (AGENTS.md requirement).

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { STUDIO_BUCKET, sourcePath } from "@/lib/site-studio/service/templates";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ZIP_BYTES = 25 * 1024 * 1024;

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("studio_templates")
    .select("id,name,status,version,niche_tags,diagnostics,compiled_at,identity_enriched_at,semantics_enriched_at,certified_at,created_at,updated_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const form = await req.formData();
  const file = form.get("file");
  const name = String(form.get("name") ?? "").trim();
  if (!(file instanceof File)) return NextResponse.json({ error: "A template zip file is required" }, { status: 422 });
  if (!name) return NextResponse.json({ error: "A template name is required" }, { status: 422 });
  if (file.size > MAX_ZIP_BYTES) return NextResponse.json({ error: "Template zip must be 25MB or smaller" }, { status: 422 });

  const bytes = new Uint8Array(await file.arrayBuffer());

  const admin = createAdminClient();
  const id = crypto.randomUUID();
  const { error: upErr } = await admin.storage
    .from(STUDIO_BUCKET)
    .upload(sourcePath(id), bytes, { contentType: "application/zip", upsert: false });
  if (upErr) return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });

  const { data: row, error: insErr } = await admin
    .from("studio_templates")
    .insert({ id, name, storage_prefix: id, status: "uploaded", created_by: auth.userId })
    .select("*")
    .single();
  if (insErr || !row) {
    await admin.storage.from(STUDIO_BUCKET).remove([sourcePath(id)]);
    return NextResponse.json({ error: insErr?.message ?? "Create failed" }, { status: 400 });
  }

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.template.uploaded",
    entity_type: "studio_template",
    entity_id: id,
    new_value: { name, bytes: file.size },
  });

  return NextResponse.json({ template: row }, { status: 201 });
}
```

- [ ] **Step 2: `npx tsc --noEmit` clean** (route files aren't unit-tested here; Phase 2b acceptance + the final-gate smoke cover them).

- [ ] **Step 3: Commit**

```bash
git add app/api/site-studio/templates/route.ts
git commit -m "feat(site-studio): routes - template list + zip upload"
```

---

### Task 10: Routes — detail, rename, delete

**Files:**
- Create: `app/api/site-studio/templates/[id]/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { removeAllFiles } from "@/lib/site-studio/service/templates";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data, error } = await admin.from("studio_templates").select("*").eq("id", id).single();
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ template: data });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { name?: string; niche_tags?: string[] } | null;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body?.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (Array.isArray(body?.niche_tags)) patch.niche_tags = body.niche_tags.filter((t) => typeof t === "string" && t.trim()).slice(0, 20);
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "Nothing to update" }, { status: 422 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("studio_templates").update(patch).eq("id", id).select("*").single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
  return NextResponse.json({ template: data });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,name").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Phase 2: no generations exist yet, so delete is unconditional. Phase 3
  // adds the "block while any run uses it" guard (the proven v2 rule).
  await removeAllFiles(admin, id).catch(() => {}); // storage cleanup is best-effort
  const { error } = await admin.from("studio_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.template.deleted",
    entity_type: "studio_template",
    entity_id: id,
    new_value: { name: row.name },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: `npx tsc --noEmit` clean. Commit**

```bash
git add "app/api/site-studio/templates/[id]/route.ts"
git commit -m "feat(site-studio): routes - template detail, rename, delete"
```

---

### Task 11: Route — deterministic compile

**Files:**
- Create: `app/api/site-studio/templates/[id]/compile/route.ts`

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { STUDIO_BUCKET, sourcePath, savePackage } from "@/lib/site-studio/service/templates";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Deterministic compile (idempotent; re-compiling bumps version). The zip is
 *  the immutable source of truth, so a re-run always starts from it. */
export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,name,status,version,compiled_at").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status === "certified") {
    return NextResponse.json({ error: "Disable the template before re-compiling a certified package" }, { status: 409 });
  }

  const { data: zip, error: dlErr } = await admin.storage.from(STUDIO_BUCKET).download(sourcePath(id));
  if (dlErr || !zip) return NextResponse.json({ error: "Source zip missing" }, { status: 500 });

  let result;
  try {
    // compileTemplate throws on malformed/unsafe zips (see its @throws note)
    result = compileTemplate(new Uint8Array(await zip.arrayBuffer()), row.name);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Compile failed";
    await admin.from("studio_templates").update({
      status: "uploaded",
      diagnostics: [{ level: "blocker", code: "zip_invalid", message }],
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const version = row.compiled_at ? row.version + 1 : row.version;
  if (result.ok) {
    result.template.manifest.version = version;
    await savePackage(admin, id, result.template);
  }

  const { data: updated, error: upErr } = await admin.from("studio_templates").update({
    status: result.ok ? "needs_review" : "uploaded",
    version,
    manifest: result.ok ? result.template.manifest : null,
    diagnostics: result.diagnostics,
    compiled_at: new Date().toISOString(),
    // a re-compile invalidates prior enrichment — the package was rebuilt
    identity_enriched_at: null,
    semantics_enriched_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (upErr || !updated) return NextResponse.json({ error: upErr?.message ?? "Update failed" }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.template.compiled",
    entity_type: "studio_template",
    entity_id: id,
    new_value: { ok: result.ok, version, blockers: result.diagnostics.filter((d) => d.level === "blocker").length },
  });

  return NextResponse.json({ template: updated, ok: result.ok });
}
```

- [ ] **Step 2: `npx tsc --noEmit` clean. Commit**

```bash
git add "app/api/site-studio/templates/[id]/compile/route.ts"
git commit -m "feat(site-studio): route - deterministic compile with version bump"
```

---

### Task 12: Routes — AI enrichment (identity + semantics), verify-or-revert

Both routes share the same shape: load package → propose (1 `callForTask("template_compile", ...)` call) → apply (pure) → **re-verify the round-trip against the source zip** → save only if still clean, else revert with a warn diagnostic. Extract the shared plumbing into the service layer so both route files stay thin.

**Files:**
- Create: `lib/site-studio/service/enrich.ts`
- Create: `app/api/site-studio/templates/[id]/enrich-identity/route.ts`
- Create: `app/api/site-studio/templates/[id]/enrich-semantics/route.ts`

- [ ] **Step 1: Implement `lib/site-studio/service/enrich.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { callForTask } from "@/lib/ai-tools/providers/run";
import type { CompiledTemplate, Diagnostic } from "../schema";
import { manifestSchema } from "../schema";
import { verifyTemplate } from "../compiler/verify";
import type { AiCall } from "../compiler/ai/identityAi";
import { loadPackage, loadSourceMap, savePackage } from "./templates";
import type { StudioTemplateRow } from "./types";

/** Production AiCall: routes template_compile through the task router. */
export const aiCall: AiCall = async (system, user) => {
  const { text } = await callForTask("template_compile", system, user, { maxTokens: 8000, temperature: 0.2 });
  return { text };
};

export interface EnrichOutcome {
  ok: boolean;
  reverted: boolean;
  template: CompiledTemplate;
  diagnostics: Diagnostic[];
}

/**
 * Shared enrichment engine: load → transform → verify round-trip → save or
 * revert. `transform` returns the candidate template plus its own diagnostics
 * (proposal parse warnings, rejected entries, ...).
 */
export async function runEnrichment(
  admin: SupabaseClient,
  row: Pick<StudioTemplateRow, "id" | "manifest">,
  transform: (tpl: CompiledTemplate) => Promise<{ template: CompiledTemplate; diagnostics: Diagnostic[] }>,
): Promise<EnrichOutcome> {
  if (!row.manifest) throw new Error("Template has no compiled package");
  const manifest = manifestSchema.parse(row.manifest);
  const tpl = await loadPackage(admin, row.id, manifest);
  const { template: candidate, diagnostics } = await transform(tpl);

  const source = await loadSourceMap(admin, row.id);
  const verify = verifyTemplate(candidate, source);
  const blockers = verify.filter((d) => d.level === "blocker");
  if (blockers.length > 0) {
    // The AI's change broke reproduce-the-original. Discard it entirely.
    return {
      ok: false,
      reverted: true,
      template: tpl,
      diagnostics: [
        ...diagnostics,
        {
          level: "warn",
          code: "ai_enrichment_reverted",
          message: `AI enrichment was reverted: it broke the round-trip verification (${blockers[0].message}).`,
        },
      ],
    };
  }

  await savePackage(admin, row.id, candidate);
  return { ok: true, reverted: false, template: candidate, diagnostics: [...diagnostics, ...verify] };
}

/** Merge new diagnostics into a row's list, replacing prior entries of the same codes. */
export function mergeDiagnostics(existing: Diagnostic[], fresh: Diagnostic[], codes: string[]): Diagnostic[] {
  const drop = new Set(codes);
  return [...existing.filter((d) => !drop.has(d.code)), ...fresh];
}
```

- [ ] **Step 2: Implement `app/api/site-studio/templates/[id]/enrich-identity/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { proposeIdentityAdditions } from "@/lib/site-studio/compiler/ai/identityAi";
import { applyIdentityAdditions } from "@/lib/site-studio/compiler/ai/applyIdentity";
import { aiCall, mergeDiagnostics, runEnrichment } from "@/lib/site-studio/service/enrich";
import type { Diagnostic } from "@/lib/site-studio/schema";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const OWNED_CODES = ["ai_identity_unparseable", "ai_enrichment_reverted"];

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,status,manifest,diagnostics").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "needs_review") {
    return NextResponse.json({ error: "Only a compiled, un-certified template can be enriched" }, { status: 409 });
  }

  let applied = 0;
  const outcome = await runEnrichment(admin, row, async (tpl) => {
    const { additions, diagnostics } = await proposeIdentityAdditions(tpl, aiCall);
    const result = applyIdentityAdditions(tpl, additions);
    applied = result.applied.length;
    const skips: Diagnostic[] = result.skipped
      .filter((s) => s.reason !== "value not found in package")
      .map((s) => ({
        level: "info" as const,
        code: "ai_identity_skipped",
        message: `Identity suggestion "${s.key}"="${s.value}" skipped: ${s.reason}`,
      }));
    return { template: result.template, diagnostics: [...diagnostics, ...skips] };
  });

  // outcome.template's manifest carries the new identity keys (or the old
  // manifest when reverted) — persist manifest + diagnostics + timestamp
  const { data: updated, error } = await admin.from("studio_templates").update({
    manifest: outcome.template.manifest,
    diagnostics: mergeDiagnostics((row.diagnostics ?? []) as Diagnostic[], outcome.diagnostics, [...OWNED_CODES, "ai_identity_skipped"]),
    identity_enriched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (error || !updated) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });

  return NextResponse.json({ template: updated, applied, reverted: outcome.reverted });
}
```

- [ ] **Step 3: Implement `app/api/site-studio/templates/[id]/enrich-semantics/route.ts`** (same skeleton; differences shown in full):

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { applySemantics, proposeSemantics } from "@/lib/site-studio/compiler/ai/semantics";
import { aiCall, mergeDiagnostics, runEnrichment } from "@/lib/site-studio/service/enrich";
import type { Diagnostic } from "@/lib/site-studio/schema";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const OWNED_CODES = ["ai_semantics_unparseable", "ai_semantics_rejected", "ai_enrichment_reverted"];

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,status,manifest,diagnostics").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "needs_review") {
    return NextResponse.json({ error: "Only a compiled, un-certified template can be enriched" }, { status: 409 });
  }

  const outcome = await runEnrichment(admin, row, async (tpl) => {
    const { proposal, diagnostics } = await proposeSemantics(tpl, aiCall);
    const result = applySemantics(tpl, proposal);
    return { template: result.template, diagnostics: [...diagnostics, ...result.diagnostics] };
  });

  const { data: updated, error } = await admin.from("studio_templates").update({
    manifest: outcome.template.manifest,
    diagnostics: mergeDiagnostics((row.diagnostics ?? []) as Diagnostic[], outcome.diagnostics, OWNED_CODES),
    semantics_enriched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (error || !updated) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });

  return NextResponse.json({ template: updated, reverted: outcome.reverted });
}
```

Semantics note: `applySemantics` only touches manifest fields (kinds, stampable, labels) — package FILES are unchanged, and kind changes cannot break the round-trip (the verification render builds every manifest page from its own samples regardless of kind; nav regions render from `region.items`). The verify-or-revert guard still runs — it is cheap and future-proofs the transform.

- [ ] **Step 4: `npx tsc --noEmit` clean. Commit**

```bash
git add lib/site-studio/service/enrich.ts "app/api/site-studio/templates/[id]/enrich-identity/route.ts" "app/api/site-studio/templates/[id]/enrich-semantics/route.ts"
git commit -m "feat(site-studio): AI enrichment routes with verify-or-revert guard"
```

---

### Task 13: Routes — certify, status transitions, preview, original

**Files:**
- Create: `app/api/site-studio/templates/[id]/certify/route.ts`
- Create: `app/api/site-studio/templates/[id]/status/route.ts`
- Create: `app/api/site-studio/templates/[id]/preview/[[...path]]/route.ts`
- Create: `app/api/site-studio/templates/[id]/original/[[...path]]/route.ts`

- [ ] **Step 1: certify**

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import type { Diagnostic } from "@/lib/site-studio/schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,name,status,diagnostics,manifest").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "needs_review") return NextResponse.json({ error: "Only a reviewed template can be certified" }, { status: 409 });
  if (!row.manifest) return NextResponse.json({ error: "Template has no compiled package" }, { status: 409 });
  const blockers = ((row.diagnostics ?? []) as Diagnostic[]).filter((d) => d.level === "blocker");
  if (blockers.length > 0) {
    return NextResponse.json({ error: `Cannot certify with ${blockers.length} blocking diagnostic(s)`, blockers }, { status: 409 });
  }

  const { data: updated, error } = await admin.from("studio_templates").update({
    status: "certified",
    certified_by: auth.userId,
    certified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (error || !updated) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.template.certified",
    entity_type: "studio_template",
    entity_id: id,
    new_value: { name: row.name },
  });
  return NextResponse.json({ template: updated });
}
```

- [ ] **Step 2: status** (generic guarded transitions — certification deliberately NOT reachable here):

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { canTransition, STUDIO_STATUSES } from "@/lib/site-studio/service/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => null)) as { status?: string } | null;
  const to = body?.status ?? "";
  if (!(STUDIO_STATUSES as readonly string[]).includes(to)) {
    return NextResponse.json({ error: "Unknown status" }, { status: 422 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,status").eq("id", id).single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canTransition(row.status, to)) {
    return NextResponse.json({ error: `Cannot move a ${row.status} template to ${to}` }, { status: 409 });
  }

  const { data: updated, error } = await admin.from("studio_templates").update({
    status: to,
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (error || !updated) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "studio.template.status",
    entity_type: "studio_template",
    entity_id: id,
    new_value: { from: row.status, to },
  });
  return NextResponse.json({ template: updated });
}
```

- [ ] **Step 3: preview** — renders the package with its OWN sample content on the fly (milliseconds; this is what the 2b review drawer iframes):

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { manifestSchema } from "@/lib/site-studio/schema";
import { sampleContentDoc } from "@/lib/site-studio/sample";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { loadPackage } from "@/lib/site-studio/service/templates";
import { contentTypeFor } from "@/lib/site-studio/service/contentType";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; path?: string[] }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id, path } = await ctx.params;
  const file = (path ?? []).join("/") || "index.html";

  const admin = createAdminClient();
  const { data: row } = await admin.from("studio_templates").select("id,manifest").eq("id", id).single();
  if (!row?.manifest) return NextResponse.json({ error: "No compiled package" }, { status: 404 });

  const manifest = manifestSchema.parse(row.manifest);
  const tpl = await loadPackage(admin, id, manifest);
  const rendered = renderSite(tpl, sampleContentDoc(manifest));
  if (!rendered.ok) {
    return NextResponse.json({ error: "Sample render refused", missing: rendered.missing }, { status: 500 });
  }
  const bytes = rendered.files[file];
  if (!bytes) return NextResponse.json({ error: "File not in rendered package" }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentTypeFor(file),
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
```

- [ ] **Step 4: original** — serves the raw uploaded file (the drawer's side-by-side left pane):

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, guardError } from "@/lib/site-studio/service/guard";
import { loadSourceMap } from "@/lib/site-studio/service/templates";
import { contentTypeFor } from "@/lib/site-studio/service/contentType";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string; path?: string[] }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const { id, path } = await ctx.params;
  const file = (path ?? []).join("/") || "index.html";

  const admin = createAdminClient();
  const source = await loadSourceMap(admin, id).catch(() => null);
  if (!source) return NextResponse.json({ error: "Source zip missing" }, { status: 404 });
  const bytes = source[file];
  if (!bytes) return NextResponse.json({ error: "File not in source" }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentTypeFor(file),
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
```

Performance note (accepted for 2a): preview re-loads and re-renders the package per request — fine for a review drawer (a package is a handful of files, render is milliseconds; storage download dominates at maybe a second). If 2b finds it sluggish, the fix is an in-memory LRU keyed on `(id, updated_at)` in the service layer — do NOT build it speculatively now.

- [ ] **Step 5: `npx tsc --noEmit` clean. Commit**

```bash
git add "app/api/site-studio/templates/[id]/certify/route.ts" "app/api/site-studio/templates/[id]/status/route.ts" "app/api/site-studio/templates/[id]/preview/[[...path]]/route.ts" "app/api/site-studio/templates/[id]/original/[[...path]]/route.ts"
git commit -m "feat(site-studio): routes - certify, status transitions, preview + original serving"
```

---

### Task 14: Full gates + migration application

- [ ] **Step 1: Full test suite** — `npm test` → every pre-existing test green plus all new `siteStudio*` files. Old engine untouched.

- [ ] **Step 2: Typecheck** — `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` → zero errors.

- [ ] **Step 3: Production build check** — `NODE_OPTIONS=--max-old-space-size=6144 npm run build` → must succeed (this is the FIRST phase with app/ routes, so the build gate matters now; make sure the dev server is not running). Fix any route-shape errors the build surfaces (then re-run tests).

- [ ] **Step 4: Apply migration 0051 — GATED.** The database is the shared PRODUCTION Supabase project. **Ask the user for explicit approval before applying** (or apply directly only if the user has already given standing approval in this execution's context). Apply via the Supabase MCP `apply_migration` tool with the file's SQL, then verify: `select * from public.studio_templates limit 1;` (empty result, no error) and confirm the `studio-templates` bucket exists.

- [ ] **Step 5: Manual smoke (after migration + user grants themselves `studio.manage`)** — optional if 2b follows immediately; otherwise: with the dev server running locally, upload `tests/fixtures/site-studio/plumberpro` zipped via the API, POST compile, GET preview/index.html, and confirm the sample preview renders. Stop the dev server afterward.

- [ ] **Step 6: Clean tree check** — `git status --short` → clean; everything committed per-task.

**Phase 2a is complete when:** all gates green; migration applied (user-approved); a fixture template can go upload → compile → needs_review with zero blockers via the API. Phase 2b (Templates board UI + review drawer + sidebar entry + enrichment buttons) gets its own plan next — do not start it without one.

---

## Self-review notes (already applied)

- **Spec coverage (2a slice):** §4 compile+certify lifecycle (statuses, blockers gate certification, re-compile bumps version + invalidates enrichment), §4 AI passes as PROPOSE→APPLY(pure)→VERIFY-OR-REVERT, §10 `studio_templates` + bucket + service-role RLS posture + `studio.manage` key. Review UI, SOP panel, sidebar = 2b by design.
- **Type consistency:** `AiCall(system, user)` seam shared by both wrappers; `IdentityAddition`/`ApplyIdentityResult`; `SemanticsProposal`/`SEMANTIC_LABELS`; `StudioTemplateRow`/`STUDIO_STATUSES`/`canTransition`; storage helpers (`sourcePath`, `INDEX_PATH`, `packageFilePath`, `savePackage`, `loadPackage`, `loadSourceMap`, `removeAllFiles`); `guard`/`guardError` — names match across every task.
- **Enrichment safety invariant** stated in the header is enforced in ONE place (`runEnrichment`) used by both AI routes; appliers are pure and clone.
- **No placeholders:** every step carries complete code or an exact command with expected output. The two judgment seams left to execution (storage `list()` folder-detection shape; any registry-test enumeration) are explicitly flagged with instructions, not hidden.
- **Route/lib split:** all testable logic is lib-level with unit tests; routes are thin adapters (this repo has no route-test infra — consistent with the existing codebase).
