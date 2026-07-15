# Template Engine v2 — Phase 1: Engine Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 edit-ops customizer with a Gemini-backed content-model + whole-file regeneration engine whose verification gates make shipping an unchanged/leaky template impossible.

**Architecture:** `brief (full lead) → content plan (JSON, Gemini Pro) → whole-file regeneration of every content file (CSS never touched) → blocking verification gates → ready`. Reuses v1's queue, buckets, realtime step tracker, zip/manifest, preview and DirectAdmin deploy. Image curation (Phase 2) and the wizard UI (Phase 3) build on the `content_model` this phase introduces.

**Tech Stack:** Next 16 (App Router), TypeScript, Supabase (Postgres + Storage), Gemini via OpenAI-compatible endpoint, vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-template-engine-v2-design.md` (read §4-§9 before starting).

**Branch:** `template-engine-v2` (already created, spec committed).

**Ground rules for every task:** work only in `D:/sed-lms-v2`; never touch `D:/Old LMS Dashboard/sed-lms`. Gates per task: `npx tsc --noEmit` and `npx vitest run` green. Do NOT run `npm run build` per task (controller runs it once at the end). No emojis. Commit after each task; body ends `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Migrations are written to disk but applied by the controller via MCP — never apply them yourself.

---

## Task 1: Gemini provider + tolerant JSON parsing

**Files:**
- Modify: `lib/ai-tools/config.ts` (add the `gemini` provider)
- Create: `lib/ai/json.ts`
- Test: `tests/aiJson.test.ts`

Verified facts (do not re-probe): base `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, auth `Authorization: Bearer ${GEMINI_API_KEY}`, working models `gemini-3.1-pro-preview` (pro) and `gemini-3.5-flash` (flash); `gemini-3-pro-preview` 404s — do not use. Gemini fences JSON in ```` ```json ````.

- [ ] **Step 1: Write the failing test** — `tests/aiJson.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseJsonLoose } from "@/lib/ai/json";

describe("parseJsonLoose", () => {
  it("parses plain JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips ```json fences (Gemini's default shape)", () => {
    expect(parseJsonLoose('```json\n{"people":true}\n```')).toEqual({ people: true });
  });
  it("strips bare ``` fences", () => {
    expect(parseJsonLoose('```\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
  });
  it("extracts JSON embedded in prose", () => {
    expect(parseJsonLoose('Here you go:\n{"a":"b"}\nHope that helps!')).toEqual({ a: "b" });
  });
  it("returns null for unparseable input instead of throwing", () => {
    expect(parseJsonLoose("not json at all")).toBeNull();
    expect(parseJsonLoose("")).toBeNull();
  });
  it("prefers the outermost object", () => {
    expect(parseJsonLoose('{"outer":{"inner":1}}')).toEqual({ outer: { inner: 1 } });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /d/sed-lms-v2 && npx vitest run tests/aiJson.test.ts`
Expected: FAIL — cannot resolve `@/lib/ai/json`.

- [ ] **Step 3: Implement `lib/ai/json.ts`**

```ts
/**
 * Parse JSON from an LLM response. Gemini wraps JSON in ```json fences and
 * sometimes adds prose; never JSON.parse a raw completion.
 * Returns null instead of throwing so callers can fail loudly with context.
 */
export function parseJsonLoose<T = unknown>(raw: string): T | null {
  if (!raw) return null;
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    /* fall through to extraction */
  }
  const start = s.search(/[[{]/);
  if (start === -1) return null;
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  const end = s.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `npx vitest run tests/aiJson.test.ts` → 6 passed.

- [ ] **Step 5: Add the gemini provider to `lib/ai-tools/config.ts`**

READ the file first and mirror the existing provider entry shape exactly (`webcraft`/`deepseek` at `:23-59`). Add an entry keyed `gemini`:
- `endpoint`: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- `apiKeyEnv`: `GEMINI_API_KEY`
- `models`: `["gemini-3.1-pro-preview", "gemini-3.5-flash", "gemini-2.5-pro", "gemini-2.5-flash"]`, default `gemini-3.1-pro-preview`
- `maxOutputTokens`: `32000`
- Keep whatever `label`/`accent`/`perm` fields the existing entries carry (match their type; if a `perm` is required use `templates.generate`).

Then export named constants for the two roles so call sites never hard-code ids:
```ts
export const GEMINI_PRO_MODEL = "gemini-3.1-pro-preview";
export const GEMINI_FLASH_MODEL = "gemini-3.5-flash";
```

- [ ] **Step 6: Verify the provider resolves**

Run: `npx tsc --noEmit` → 0 errors. Confirm `callProvider` in `lib/ai-tools/run.ts:81` needs no change (it is OpenAI-compatible: `{model, max_tokens, temperature, stream:false, messages}` + `Authorization: Bearer <key>`). If `callProvider` reads the key via a helper that only knows the old providers, extend that lookup — quote what you changed in your report.

- [ ] **Step 7: Commit**

```bash
git -C "D:/sed-lms-v2" add -A && git -C "D:/sed-lms-v2" commit -m "feat: gemini provider + tolerant LLM JSON parsing"
```

---

## Task 2: Migration 0034 — v2 schema

**Files:**
- Create: `supabase/migrations/0034_template_engine_v2.sql`

Do NOT apply it. READ `supabase/migrations/0026_template_engine.sql` first for the existing `template_generations` shape + status check constraint name.

- [ ] **Step 1: Write the migration**

Contents (adapt the constraint name to what 0026 actually created):

```sql
-- 0034_template_engine_v2.sql — content-model engine + curation + gates

-- v2 pipeline state. v1 rows keep 'ready_for_review'/'deployed'.
alter table public.template_generations drop constraint if exists template_generations_status_check;
alter table public.template_generations add constraint template_generations_status_check
  check (status in ('queued','running','planning','curating','building','review','ready_for_review','deployed','failed'));

alter table public.template_generations
  add column if not exists brief jsonb,           -- frozen full-lead snapshot used for this run
  add column if not exists content_model jsonb,   -- the editable source of truth (§6)
  add column if not exists image_slots jsonb,     -- Phase 2 curation state
  add column if not exists options jsonb not null default '{"exclude_people": true}'::jsonb,
  add column if not exists gate_results jsonb;    -- verification report (§9)

-- Demo identity tokens auto-derived at template upload; the leak gate fails the
-- build if ANY of these survive into generated output.
alter table public.website_templates
  add column if not exists demo_tokens jsonb not null default '[]'::jsonb;

-- Reserved for the deferred image-preservation library (Phase 2+; unused for now).
create table if not exists public.curated_images (
  id uuid primary key default gen_random_uuid(),
  service_key text not null,
  business_type text,
  url text not null,
  thumb text,
  source text not null default 'pexels',
  vision jsonb,
  approved_by uuid references public.profiles(id) on delete set null,
  times_used int not null default 0,
  created_at timestamptz not null default now(),
  unique (service_key, url)
);
create index if not exists curated_images_lookup_idx on public.curated_images (service_key, business_type);
alter table public.curated_images enable row level security;
create policy "read curated images" on public.curated_images for select to authenticated
  using (public.has_permission('templates.generate') or public.has_permission('templates.manage'));
create policy "write curated images" on public.curated_images for all to authenticated
  using (public.has_permission('templates.manage')) with check (public.has_permission('templates.manage'));
```

- [ ] **Step 2: Sanity-check it parses**

No DB access. Re-read the file and confirm: every `add column` is `if not exists`; the status check lists BOTH v1 and v2 states (so existing rows stay valid); no `drop column`. Report the exact old constraint name you replaced.

- [ ] **Step 3: Commit**

```bash
git -C "D:/sed-lms-v2" add -A && git -C "D:/sed-lms-v2" commit -m "feat: migration 0034 — template engine v2 schema"
```

---

## Task 3: Brief builder — feed the whole lead

**Files:**
- Create: `lib/template-engine/brief.ts`
- Test: `tests/templateBrief.test.ts`

v1 sent only 6 fields (`runner.ts:264-272`) — the root cause of generic copy. READ `lib/leads/types.ts` `Lead` for exact field names.

- [ ] **Step 1: Write the failing test** — `tests/templateBrief.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { buildBrief } from "@/lib/template-engine/brief";

const lead = {
  id: "l1",
  business_name: "Inside Out Painting",
  business_phone: "(631) 334-4032",
  business_email: "hi@example.com",
  site_type: "Custom Website",
  services: ["Interior Painting", "Floor Install"],
  service_areas: ["Brentwood, NY"],
  client_experience: 20,
  comments: "Family run, very responsive",
  color_scheme: "navy and white",
  color_same_as_logo: false,
  logo_link: "https://x.com/logo.png",
  image_links: ["https://x.com/a.jpg", "https://x.com/b.jpg"],
  rating: 9,
  add_ons: [{ id: "a1", label: "Live Chat", price: 50 }],
  num_webpages: 6,
  specify_pages: ["Home", "About Us"],
  business_profile_link: "https://maps.google.com/x",
  map_embed_link: "<iframe src='https://maps'></iframe>",
  reference_link: null,
} as never;

describe("buildBrief", () => {
  it("carries the rich fields v1 dropped", () => {
    const b = buildBrief(lead);
    expect(b.business_name).toBe("Inside Out Painting");
    expect(b.years_experience).toBe(20);        // v1 dropped this
    expect(b.notes).toBe("Family run, very responsive"); // v1 dropped this
    expect(b.color_scheme).toBe("navy and white");        // v1 dropped this
    expect(b.logo_link).toBe("https://x.com/logo.png");   // v1 dropped this
    expect(b.client_photos).toEqual(["https://x.com/a.jpg", "https://x.com/b.jpg"]);
    expect(b.service_areas).toEqual(["Brentwood, NY"]);
    expect(b.services).toEqual(["Interior Painting", "Floor Install"]);
  });
  it("omits empty/null values rather than emitting nulls", () => {
    const b = buildBrief({ ...(lead as object), comments: null, logo_link: null } as never);
    expect(b.notes).toBeUndefined();
    expect(b.logo_link).toBeUndefined();
  });
  it("uses the logo as a client photo source when color_same_as_logo", () => {
    const b = buildBrief({ ...(lead as object), color_same_as_logo: true } as never);
    expect(b.color_scheme).toBe("match the logo");
  });
  it("is JSON-serialisable and stable", () => {
    expect(() => JSON.stringify(buildBrief(lead))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`@/lib/template-engine/brief` unresolved)

Run: `npx vitest run tests/templateBrief.test.ts`

- [ ] **Step 3: Implement `lib/template-engine/brief.ts`**

```ts
import type { Lead } from "@/lib/leads/types";

export interface GenerationBrief {
  business_name: string;
  phone?: string;
  email?: string;
  site_type?: string;
  services: string[];
  service_areas: string[];
  years_experience?: number;
  notes?: string;             // lead.comments — the sales team's real context
  color_scheme?: string;
  logo_link?: string;
  client_photos: string[];    // lead.image_links — real photos of THIS business
  rating?: number;
  add_ons: string[];
  page_count?: number;
  requested_pages: string[];
  profile_link?: string;
  map_embed?: string;
  reference_link?: string;
}

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
};
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];

/** Everything the sales team captured — v1 sent only 6 of these fields. */
export function buildBrief(lead: Lead): GenerationBrief {
  const sameAsLogo = (lead as { color_same_as_logo?: boolean }).color_same_as_logo === true;
  return {
    business_name: str(lead.business_name) ?? "",
    phone: str(lead.business_phone),
    email: str(lead.business_email),
    site_type: str(lead.site_type),
    services: arr(lead.services),
    service_areas: arr(lead.service_areas),
    years_experience:
      typeof lead.client_experience === "number" ? lead.client_experience : undefined,
    notes: str(lead.comments),
    color_scheme: sameAsLogo ? "match the logo" : str(lead.color_scheme),
    logo_link: str(lead.logo_link),
    client_photos: arr(lead.image_links),
    rating: typeof lead.rating === "number" ? lead.rating : undefined,
    add_ons: Array.isArray(lead.add_ons)
      ? lead.add_ons.map((a) => String((a as { label?: string })?.label ?? "")).filter(Boolean)
      : [],
    page_count: typeof lead.num_webpages === "number" ? lead.num_webpages : undefined,
    requested_pages: arr(lead.specify_pages),
    profile_link: str(lead.business_profile_link),
    map_embed: str(lead.map_embed_link),
    reference_link: str(lead.reference_link),
  };
}
```

If a field name differs in `Lead`, follow the real type and note it in your report.

- [ ] **Step 4: Run the test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git -C "D:/sed-lms-v2" add -A && git -C "D:/sed-lms-v2" commit -m "feat: generation brief from the full lead record"
```

---

## Task 4: Demo-token extraction (arms the leak gate)

**Files:**
- Create: `lib/template-engine/demoTokens.ts`
- Test: `tests/demoTokens.test.ts`
- Modify: `app/api/template-engine/templates/route.ts` (POST — persist tokens on upload)

The leak gate needs to know what the template's demo identity IS. Derive it once at upload, store on `website_templates.demo_tokens`.

- [ ] **Step 1: Write the failing test** — `tests/demoTokens.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { extractDemoTokens, findLeaks } from "@/lib/template-engine/demoTokens";

const html = `<html><head><title>Northpoint Remodeling - Denver Kitchens</title></head>
<body><h1>NORTHPOINT REMODELING</h1><p>Serving Cherry Creek and Denver.</p>
<a href="tel:+13035551234">(303) 555-1234</a>
<a href="mailto:hello@northpointremodel.com">email</a></body></html>`;
const js = `class NorthpointApp { } window.northpointApp = new NorthpointApp();`;

describe("extractDemoTokens", () => {
  it("finds the demo business name, city, phone, email and JS identifier", () => {
    const t = extractDemoTokens({ "index.html": html, "script.js": js });
    const lower = t.map((x) => x.toLowerCase());
    expect(lower).toContain("northpoint remodeling");
    expect(lower.some((x) => x.includes("cherry creek"))).toBe(true);
    expect(lower.some((x) => x.includes("denver"))).toBe(true);
    expect(t).toContain("(303) 555-1234");
    expect(t.some((x) => x.includes("northpointremodel.com"))).toBe(true);
    expect(t.some((x) => x.toLowerCase().includes("northpointapp"))).toBe(true);
  });
  it("does not emit trivially short or generic tokens", () => {
    const t = extractDemoTokens({ "index.html": html });
    expect(t.every((x) => x.length >= 4)).toBe(true);
    expect(t.map((s) => s.toLowerCase())).not.toContain("html");
  });
});

describe("findLeaks", () => {
  const tokens = ["Northpoint Remodeling", "Cherry Creek", "(303) 555-1234"];
  it("reports every file containing a demo token (case-insensitive)", () => {
    const leaks = findLeaks({ "a.html": "Welcome to northpoint remodeling!", "b.html": "clean" }, tokens);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].file).toBe("a.html");
    expect(leaks[0].token).toBe("Northpoint Remodeling");
  });
  it("returns [] when the output is clean (the pass condition)", () => {
    expect(findLeaks({ "a.html": "Inside Out Painting, Brentwood NY" }, tokens)).toEqual([]);
  });
  it("catches a leak in JS as well as HTML", () => {
    expect(findLeaks({ "script.js": "window.northpointApp" }, ["northpointApp"])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

- [ ] **Step 3: Implement `lib/template-engine/demoTokens.ts`**

Requirements (write the code to satisfy the tests):
- `extractDemoTokens(files: Record<string,string>): string[]` — from all text files gather: `<title>` text and its leading brand phrase; repeated Capitalised multi-word brand phrases; `tel:`/formatted phone numbers `\(\d{3}\)\s?\d{3}-\d{4}` and `+1\d{10}`; email addresses and their domains; place-like phrases appearing near "Serving/in/area"; JS identifiers matching `/\b([A-Z][a-zA-Z]*App)\b/` and `window\.([a-zA-Z]+App)`. Normalise, dedupe case-insensitively, drop tokens shorter than 4 chars and an HTML/JS stop-list (`html, head, body, span, div, class, const, window, function, script, style`).
- `findLeaks(files: Record<string,string>, tokens: string[]): {file:string; token:string; excerpt:string}[]` — case-insensitive substring scan; return one entry per (file, token) with a ±40-char excerpt; `[]` means clean.
- Keep both pure (no I/O) so they are unit-testable and reusable by the gate.

- [ ] **Step 4: Run the test — expect PASS**

- [ ] **Step 5: Persist tokens at template upload**

In `app/api/template-engine/templates/route.ts` POST, after `unzipToMap` + `buildManifest` and before/with the insert: build the text-file map (`/\.(html?|js|mjs)$/i`, skip binaries), call `extractDemoTokens`, and store the result in the new `demo_tokens` column on the `website_templates` insert. Also backfill on `PATCH` re-classify is NOT required.
Add a one-off note in your report: existing templates uploaded before this change have `demo_tokens = []` and must be re-uploaded (or backfilled) before the leak gate protects them.

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` → all green.
```bash
git -C "D:/sed-lms-v2" add -A && git -C "D:/sed-lms-v2" commit -m "feat: derive template demo tokens at upload to arm the leak gate"
```

---

## Task 5: Content model — schema + planner

**Files:**
- Create: `lib/template-engine/contentModel.ts` (zod schema + types)
- Create: `lib/template-engine/plan.ts` (the Gemini planning call)
- Test: `tests/contentModel.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/contentModel.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { contentModelSchema, emptyContentModel } from "@/lib/template-engine/contentModel";

const valid = {
  identity: { name: "Inside Out Painting", tagline: "Done once, done right",
    positioning: "Cost-effective professional painting", phone: "(631) 334-4032",
    email: "hi@x.com", areas: ["Brentwood, NY"], years: 20, license_line: "Licensed · Insured" },
  hero: { eyebrow: "NOW BOOKING", headline_parts: ["Beautifully", "painted", "interiors"],
    subcopy: "Professional painting for Brentwood.", cta_primary: "Get a free estimate",
    cta_secondary: "Call (631) 334-4032" },
  services: [{ key: "interior-painting", name: "Interior Painting", short: "Crisp lines",
    long: "Full interior repaints.", bullets: ["Walls", "Trim"], image_query: "freshly painted interior wall" }],
  stats: [{ value: "20+", label: "Years experience" }],
  testimonials: [{ quote: "Great work", name: "M. R.", meta: "Interior · Brentwood", initials: "MR" }],
  faq: [{ q: "Do you offer free estimates?", a: "Yes." }],
  about: { story: "Family run since 2005.", why_us: ["No subcontractors"] },
  pages: { "index.html": { title: "Inside Out Painting", meta_description: "Painting in Brentwood" } },
  image_briefs: [{ slot_id: "hero-1", kind: "hero", query: "freshly painted living room", must_show: "clean interior", avoid: "people" }],
};

describe("contentModelSchema", () => {
  it("accepts a complete model", () => {
    expect(contentModelSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects a model with no services (the site would be empty)", () => {
    expect(contentModelSchema.safeParse({ ...valid, services: [] }).success).toBe(false);
  });
  it("rejects a missing identity name", () => {
    const bad = { ...valid, identity: { ...valid.identity, name: "" } };
    expect(contentModelSchema.safeParse(bad).success).toBe(false);
  });
  it("requires each service to carry an image_query for slot building", () => {
    const bad = { ...valid, services: [{ ...valid.services[0], image_query: "" }] };
    expect(contentModelSchema.safeParse(bad).success).toBe(false);
  });
  it("emptyContentModel() is a valid starting shape for the editor", () => {
    expect(() => emptyContentModel("Acme")).not.toThrow();
    expect(emptyContentModel("Acme").identity.name).toBe("Acme");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

- [ ] **Step 3: Implement `lib/template-engine/contentModel.ts`**

Write a zod schema matching spec §6 exactly (`identity, hero, services[], stats[], testimonials[], faq[], about, pages, image_briefs[]`), with:
- `identity.name` min 1; `services` min 1; each service `key` (slug), `name`, `short`, `long`, `bullets: string[]`, `image_query` min 1.
- `pages` a `z.record(z.object({ title, meta_description, sections: z.record(z.unknown()).optional() }))`.
- Export `export type ContentModel = z.infer<typeof contentModelSchema>` and `emptyContentModel(name: string): ContentModel` returning a minimal valid skeleton (one placeholder service is acceptable for the editor's starting state).

- [ ] **Step 4: Run the test — expect PASS**

- [ ] **Step 5: Implement `lib/template-engine/plan.ts`**

```ts
import { callProvider } from "@/lib/ai-tools/run";
import { GEMINI_PRO_MODEL } from "@/lib/ai-tools/config";
import { parseJsonLoose } from "@/lib/ai/json";
import { contentModelSchema, type ContentModel } from "./contentModel";
import type { GenerationBrief } from "./brief";

export const PLAN_SYSTEM = `You are a senior web copywriter for home-service businesses. You produce ONLY strict JSON matching the requested schema. Never invent licenses, awards, certifications, or specific claims that were not provided. Testimonials must be plausible and set in the business's real service areas. Every service must come from the business's real service list.`;

export function planPrompt(brief: GenerationBrief, pages: string[]): string { /* see below */ }

export async function planContent(
  brief: GenerationBrief, pages: string[], model = GEMINI_PRO_MODEL
): Promise<{ model: ContentModel; raw: string }> {
  const raw = await callProvider("gemini", {
    model, system: PLAN_SYSTEM, user: planPrompt(brief, pages),
    maxTokens: 32000, temperature: 0.6,
  });
  const json = parseJsonLoose(raw);
  if (!json) throw new Error("Planner returned no parseable JSON");
  const parsed = contentModelSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Planner JSON failed schema: " + JSON.stringify(parsed.error.issues.slice(0, 5)));
  }
  return { model: parsed.data, raw };
}
```
`planPrompt` must embed `JSON.stringify(brief)` plus the page list, state the exact JSON schema from spec §6, and instruct: use the real services/areas/phone; localize testimonials to the real areas; write specific, non-generic copy; one `image_brief` per hero slot and per service, each with an `avoid` of `"people, text overlays, watermarks"`; never output prose.
Match `callProvider`'s real signature (READ `lib/ai-tools/run.ts:81`) — adapt the call shape if it differs; do not invent parameters.

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` → green.
```bash
git -C "D:/sed-lms-v2" add -A && git -C "D:/sed-lms-v2" commit -m "feat: content model schema + Gemini content planner"
```

---

## Task 6: File classification — stop shipping script.js untouched

**Files:**
- Create: `lib/template-engine/classify.ts`
- Test: `tests/templateClassify.test.ts`

v1's fatal omission: only manifest `pages` + `components.js` were editable; `script.js` shipped byte-identical, leaking the demo identity forever (`runner.ts:573-577`).

- [ ] **Step 1: Write the failing test** — `tests/templateClassify.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { classifyFiles } from "@/lib/template-engine/classify";

describe("classifyFiles", () => {
  const files = ["index.html","about.html","style.css","script.js","components.js",
                 "images/hero-1.jpg",".thumbnail","vendor/gsap.min.js"];
  it("treats EVERY html and content js as regenerable (v1 skipped script.js)", () => {
    const c = classifyFiles(files);
    expect(c.content).toContain("index.html");
    expect(c.content).toContain("about.html");
    expect(c.content).toContain("script.js");     // the v1 bug
    expect(c.content).toContain("components.js");
  });
  it("never regenerates CSS — the design is preserved by construction", () => {
    const c = classifyFiles(files);
    expect(c.content).not.toContain("style.css");
    expect(c.passthrough).toContain("style.css");
  });
  it("passes through binaries and minified vendor bundles", () => {
    const c = classifyFiles(files);
    expect(c.passthrough).toContain("images/hero-1.jpg");
    expect(c.passthrough).toContain("vendor/gsap.min.js"); // .min.js is vendor, not content
    expect(c.passthrough).toContain(".thumbnail");
  });
  it("classifies every input exactly once", () => {
    const c = classifyFiles(files);
    expect([...c.content, ...c.passthrough].sort()).toEqual([...files].sort());
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

- [ ] **Step 3: Implement `lib/template-engine/classify.ts`**

```ts
export interface FileClasses { content: string[]; passthrough: string[] }

const CONTENT_RE = /\.(html?|js|mjs)$/i;
const VENDOR_RE = /(^|\/)(vendor|lib|libs|dist)\//i;
const MIN_RE = /\.min\.(js|mjs)$/i;

/**
 * content     — regenerated wholesale by the AI (all HTML + all content JS).
 * passthrough — copied byte-for-byte: CSS (design preserved by construction),
 *               images/binaries, and minified vendor bundles.
 */
export function classifyFiles(files: string[]): FileClasses {
  const content: string[] = [];
  const passthrough: string[] = [];
  for (const f of files) {
    if (CONTENT_RE.test(f) && !MIN_RE.test(f) && !VENDOR_RE.test(f)) content.push(f);
    else passthrough.push(f);
  }
  return { content, passthrough };
}
```

- [ ] **Step 4: Run the test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git -C "D:/sed-lms-v2" add -A && git -C "D:/sed-lms-v2" commit -m "feat: file classification — regenerate all content files, never CSS"
```

---

## Task 7: Structure-preservation gate

**Files:**
- Create: `lib/template-engine/structure.ts`
- Test: `tests/templateStructure.test.ts`

Whole-file rewriting is powerful, so it must be policed: the AI may change words, never the skeleton.

- [ ] **Step 1: Write the failing test** — `tests/templateStructure.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { htmlSkeleton, compareSkeleton, jsIdentifiers, compareJs } from "@/lib/template-engine/structure";

const before = `<div class="hero grid"><h1 id="t" class="title">Northpoint</h1><img src="a.jpg" alt="x"></div>`;
const okAfter = `<div class="hero grid"><h1 id="t" class="title">Inside Out</h1><img src="b.jpg" alt="y"></div>`;
const badAfter = `<div class="hero"><h2 id="t" class="title">Inside Out</h2></div>`;

describe("html structure gate", () => {
  it("passes when only text/attribute VALUES changed", () => {
    expect(compareSkeleton(htmlSkeleton(before), htmlSkeleton(okAfter)).ok).toBe(true);
  });
  it("fails when a class is dropped", () => {
    const r = compareSkeleton(htmlSkeleton(before), htmlSkeleton(badAfter));
    expect(r.ok).toBe(false);
    expect(r.missingClasses).toContain("grid");
  });
  it("fails when a tag is changed or an element removed", () => {
    const r = compareSkeleton(htmlSkeleton(before), htmlSkeleton(badAfter));
    expect(r.ok).toBe(false);
  });
});

describe("js identifier gate", () => {
  it("passes when only string data changed", () => {
    const a = `class NorthpointApp { init(){ const q='Great kitchen'; } }`;
    const b = `class NorthpointApp { init(){ const q='Great paint job'; } }`;
    expect(compareJs(jsIdentifiers(a), jsIdentifiers(b)).ok).toBe(true);
  });
  it("fails when a method disappears", () => {
    const a = `class App { init(){} bindFaq(){} }`;
    const b = `class App { init(){} }`;
    const r = compareJs(jsIdentifiers(a), jsIdentifiers(b));
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("bindFaq");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

- [ ] **Step 3: Implement `lib/template-engine/structure.ts`**

Requirements (regex-based; no DOM/AST dependency):
- `htmlSkeleton(html)` → `{ tags: Record<string, number>; classes: Set<string>; ids: Set<string> }` — tag-name counts via `/<([a-zA-Z][\w-]*)\b/g`, all `class="..."` tokens, all `id="..."` values.
- `compareSkeleton(a, b)` → `{ ok, missingClasses[], missingIds[], tagDiff[] }` — `ok` only when b retains every class and id of a and no tag's count drops. Extra classes/ids in b are allowed (AI may add a modifier), a DROP is a failure.
- `jsIdentifiers(js)` → `Set<string>` of declared names: `class X`, `function X`, `const/let/var X =`, object-method `X(...) {` inside classes, and `window.X =`.
- `compareJs(a, b)` → `{ ok, missing[] }` — fails if any identifier in a is absent from b.
- Keep pure.

- [ ] **Step 4: Run the test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git -C "D:/sed-lms-v2" add -A && git -C "D:/sed-lms-v2" commit -m "feat: structure-preservation gate for whole-file regeneration"
```

---

## Task 8: Regeneration + gate runner

**Files:**
- Create: `lib/template-engine/regenerate.ts`
- Create: `lib/template-engine/gates.ts`
- Test: `tests/templateGates.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/templateGates.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { runGates } from "@/lib/template-engine/gates";

const template = { "index.html": `<div class="hero"><h1>Northpoint Remodeling</h1></div>` };
const clean = { "index.html": `<div class="hero"><h1>Inside Out Painting</h1></div>` };
const leaky = { "index.html": `<div class="hero"><h1>Northpoint Remodeling</h1></div>` };
const broken = { "index.html": `<section><h1>Inside Out Painting</h1></section>` };
const tokens = ["Northpoint Remodeling"];

describe("runGates", () => {
  it("passes clean, structurally-identical output", () => {
    const r = runGates({ template, output: clean, demoTokens: tokens });
    expect(r.ok).toBe(true);
    expect(r.leaks).toEqual([]);
  });
  it("FAILS an unchanged template — the exact v1 Warrior bug", () => {
    const r = runGates({ template, output: leaky, demoTokens: tokens });
    expect(r.ok).toBe(false);
    expect(r.leaks.length).toBeGreaterThan(0);
    expect(r.leaks[0].token).toBe("Northpoint Remodeling");
  });
  it("fails output that dropped the template's structure", () => {
    const r = runGates({ template, output: broken, demoTokens: tokens });
    expect(r.ok).toBe(false);
    expect(r.structure.some((s) => !s.ok)).toBe(true);
  });
  it("reports a machine-readable result for gate_results", () => {
    const r = runGates({ template, output: clean, demoTokens: tokens });
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(r).toHaveProperty("ok");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

- [ ] **Step 3: Implement `lib/template-engine/gates.ts`**

```ts
import { findLeaks } from "./demoTokens";
import { htmlSkeleton, compareSkeleton, jsIdentifiers, compareJs } from "./structure";

export interface GateResult {
  ok: boolean;
  leaks: { file: string; token: string; excerpt: string }[];
  structure: { file: string; ok: boolean; detail?: string }[];
  checkedAt: string;
}

/** Blocking verification. `ok:false` must prevent the generation reaching review. */
export function runGates(args: {
  template: Record<string, string>;
  output: Record<string, string>;
  demoTokens: string[];
  now?: string;
}): GateResult { /* leak scan across ALL output files + per-file structure compare */ }
```
Implement: `findLeaks(output, demoTokens)`; for each output file also present in `template`, compare skeleton (`.html`) or identifiers (`.js`); `ok = leaks.length === 0 && structure.every(s => s.ok)`; `checkedAt = args.now ?? new Date().toISOString()` (accept `now` so tests stay deterministic).

- [ ] **Step 4: Run the test — expect PASS**

- [ ] **Step 5: Implement `lib/template-engine/regenerate.ts`**

```ts
export const REGEN_SYSTEM = `You rewrite one file of a website template so it belongs to a specific real business, while preserving the template's design and code exactly.

ABSOLUTE RULES
- Output ONLY the complete file content. No prose, no markdown fences.
- Preserve EVERY css class, id, data-* attribute, inline handler, and tag structure. Never drop or rename any of them.
- In JavaScript: preserve every class/function/method/variable name and all control flow. The file must still parse and behave identically. Change ONLY string/data VALUES (e.g. testimonial text, service names, labels).
- Replace 100% of the template's demo business identity — name, city, areas, phone, email, people names, and any identifier-like branding in text. NOTHING of the demo business may remain.
- Use ONLY the supplied content model for facts. Never invent licenses, awards or certifications.
- Rewrite image src/srcset and alt text using the supplied image URLs. Never keep a template image path.`;

export function regenPrompt(args: {
  file: string; source: string; contentModel: unknown; imagesForFile: unknown; demoTokens: string[];
}): string { /* embed file name, the content model JSON, the resolved image list, the demo-token blacklist, then the FULL source */ }

export async function regenerateFile(args: {...}): Promise<string> {
  // callProvider("gemini", { model: GEMINI_PRO_MODEL, system: REGEN_SYSTEM, user: regenPrompt(args), maxTokens: 32000, temperature: 0.4 })
  // strip accidental fences (reuse the fence logic from parseJsonLoose's regex, or a small stripFence helper)
  // throw if the result is empty or byte-identical to `source` (that is the v1 failure — never allow it silently)
}
```
Key detail: **throw when the model returns the source unchanged.** v1's defining bug was treating "no change" as success.

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npx vitest run` → green.
```bash
git -C "D:/sed-lms-v2" add -A && git -C "D:/sed-lms-v2" commit -m "feat: whole-file regeneration + blocking verification gates"
```

---

## Task 9: Wire the v2 runner

**Files:**
- Create: `lib/template-engine/runnerV2.ts`
- Modify: `lib/template-engine/queue.ts` (point the processor at the v2 runner)

READ `lib/template-engine/runner.ts` fully first — reuse its proven scaffolding (storage listing/download, `beginStep`, zip packaging, uploads, status writes) and replace only the customization core. Do NOT delete `runner.ts` in this task.

- [ ] **Step 1: Implement `runTemplateGenerationV2(generationId)`**

Order:
1. Load generation + lead + template (+ `demo_tokens`); `brief = buildBrief(lead)`; persist `brief`.
2. Step `plan` → `planContent(brief, requestedPages)` → persist `content_model`. Status `planning`.
3. Step `images` → **Phase 1 interim**: resolve each `image_brief` with the existing `pexels.ts` `searchPexels`+`pickBest` (no curation yet — Phase 2 adds slots/vision/operator picks). Client photos (`brief.client_photos`) take precedence for hero/about slots. Use direct CDN URLs.
4. Step `prepare` → download template files; `classifyFiles(...)` → `content` vs `passthrough`.
5. Step `build:{file}` per content file → `regenerateFile(...)`. Run with a small concurrency cap (3) to keep wall-clock sane; on a file error, fail the generation (do NOT ship the source).
6. Step `verify` → `runGates({template: contentSources, output: rebuilt, demoTokens})`; persist `gate_results`. If `!ok`: one targeted repair pass re-regenerating only the offending files with the leak/structure detail appended to the prompt; re-run gates. Still failing → status `failed` with a clear `error` naming the leaked token/file.
7. Step `finalize` → package zip + explode to `template-sites` exactly as v1 (`runner.ts:591-630`); status **`review`**; keep `zip_path`, totals.

- [ ] **Step 2: Point the queue at v2**

In `lib/template-engine/queue.ts`, call `runTemplateGenerationV2` instead of `runTemplateGeneration`. Keep the claim RPC/serialization untouched.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run` → green. (No live run here — the controller does the real end-to-end run.)

- [ ] **Step 4: Commit**

```bash
git -C "D:/sed-lms-v2" add -A && git -C "D:/sed-lms-v2" commit -m "feat: v2 generation runner (plan -> regenerate -> verify)"
```

---

## Task 10: End-to-end verification (controller)

- [ ] **Step 1:** Controller applies migration 0034 via Supabase MCP.
- [ ] **Step 2:** `npm run build` → exit 0.
- [ ] **Step 3:** Re-upload the "1st template final" zip so `demo_tokens` is populated; confirm the tokens include `Northpoint Remodeling`, `Denver`, `Cherry Creek`, `NorthpointApp`.
- [ ] **Step 4:** Run a real generation against the Warrior Contracting lead. **Success criteria (spec §13):** status reaches `review`; `gate_results.ok === true`; downloaded zip contains **zero** occurrences of any demo token in any file; `style.css` byte-identical to the template; `script.js` **changed**; hero/service copy reflects the real lead.
- [ ] **Step 5:** Merge `template-engine-v2` → main, push.

---

## Self-review notes

- **Spec coverage:** §5 provider → T1; §4 schema → T2; §6 brief+plan → T3, T5; §8 regeneration → T6, T8; §9 gates → T4, T7, T8; §3 state machine → T9. §7 image curation and §10 UI are **deliberately out of scope** — they are Plans 2 and 3 and depend on the `content_model`/`image_slots` this plan lands.
- **Type consistency:** `ContentModel` (T5) is consumed by T8/T9; `GenerationBrief` (T3) by T5/T9; `FileClasses` (T6) by T9; `GateResult` (T8) persisted to `gate_results` (T2).
- **The v1 bug is regression-tested twice:** `runGates` fails an unchanged template (T8 test), and `regenerateFile` throws on unchanged output (T8 impl).
