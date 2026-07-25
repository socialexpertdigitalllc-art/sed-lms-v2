# Site Studio Phase 3a — Generation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a lead + a certified template into a rendered client website, headlessly. AI writes the text; everything else is deterministic. Provable end-to-end by a scripted run with a stubbed model — no UI required.

**Architecture:** A run is a row (`studio_runs`) holding one **Content Document** and a chain of **short idempotent steps**. `prepare` (deterministic: lead → identity + pages + theme + image defaults) → `write` (one AI call **per page, in parallel**) → `render` (pure) → `finalize` (zip + store). Each step claims itself, does ≤30s of work, persists, exits — so there is no long-lived process, nothing to orphan, and Stop/retry are flags. The operator's browser drives the chain in Phase 3b; a scripted driver proves it here.

**Tech Stack:** TypeScript, zod 4, Supabase (service-role), the Phase 1 core (`renderSite`, `manifestSchema`, `zipFromMap`), the Phase 2a service layer (`loadPackage`, guard), the AI task router (`callForTask`), vitest.

**Spec authority:** `docs/superpowers/specs/2026-07-23-site-studio-design.md` §6 (Content Document & Writer), §7 (run & step engine), §10 (data model). Phase 2a plan for route/service idiom: `docs/superpowers/plans/2026-07-25-site-studio-phase2a-compile-service.md`.

**Scope decisions (made from exploration, recorded so they aren't re-litigated):**
- **Images are Phase 3b, with the cockpit.** Curation is inherently a UI activity — the operator picks at Gate 1 — so building a headless picker before the picking screen is backwards. In 3a every image slot defaults to **the template's own sample image** (which already exists in the package's assets, so the site renders complete and correct), and any client photos on the lead (`image_links`) are attached to the run for 3b to offer first.
- **When images do land (3b), they get rehosted** into our own bucket rather than referenced as live Pexels URLs — v2's approach means a client site breaks when a URL rots and makes a reuse "library" just bookmarks.
- **No vision in the critical path.** v2 auto-rejected people-showing photos and left slots empty >50% of the time for home-service trades. 3b shows a wide net and lets the human choose.
- **Theme colour is derived deterministically in 3a** (hex parsed out of the lead's `color_scheme`); if no valid hex is present the template's own palette is kept. The spec's rule is "never guess a colour" — AI colour translation can come later, and empty is always safe.

**Hard rules:** never import from or modify `lib/template-engine/`; all new DB objects `studio_`-prefixed; targeted vitest runs (`npx vitest run tests/<file>`), full `npm test` only at the final gate; `NODE_OPTIONS=--max-old-space-size=6144` for tsc/build; **do not run the dev server**; commit per task with the exact message; do not push; **do not apply the migration** (final task, gated).

**File structure (new):**

```
supabase/migrations/0053_studio_runs.sql
lib/site-studio/run/types.ts          (run row, statuses, step names, transitions)
lib/site-studio/run/dossier.ts        (lead row → Dossier; pure)
lib/site-studio/run/pageSelect.ts     (specify_pages + manifest → pages to build; pure)
lib/site-studio/run/theme.ts          (color_scheme text → theme roles; pure)
lib/site-studio/run/seed.ts           (manifest + dossier → ContentDoc skeleton; pure)
lib/site-studio/run/writer.ts         (per-page prompt, parse, validate; injectable AI call)
lib/site-studio/run/applyWritten.ts   (merge written page into the ContentDoc; pure)
lib/site-studio/run/engine.ts         (step machine: what runs next, claim, persist)
lib/site-studio/run/finalize.ts       (render → zip → storage; service)
app/api/site-studio/runs/route.ts            (POST create from lead, GET list)
app/api/site-studio/runs/[id]/route.ts       (GET detail incl. content doc)
app/api/site-studio/runs/[id]/step/route.ts  (POST advance one step)
app/api/site-studio/runs/[id]/content/route.ts (PATCH operator edits to the doc)
tests/siteStudioRunTypes.test.ts
tests/siteStudioDossier.test.ts
tests/siteStudioPageSelect.test.ts
tests/siteStudioRunTheme.test.ts
tests/siteStudioSeed.test.ts
tests/siteStudioWriter.test.ts
tests/siteStudioApplyWritten.test.ts
tests/siteStudioEngine.test.ts
tests/siteStudioGenerationE2E.test.ts   (the proof: fixture template + fake lead + stub model → rendered site)
```

Everything testable is a pure function under `lib/site-studio/run/`; routes are thin adapters over them, matching Phase 2a.

---

## The Writer's content rules (non-negotiable — each cost a real v2 incident)

Put these in the Writer's system prompt and keep them intact:

1. **Never invent** licences, awards, certifications, insurance claims, years in business, prices, or guarantees. Years only if the dossier supplies them.
2. **Write for the CLIENT's trade, not the template's.** The template was built for a different business. Any sample text describing a service or trade the client doesn't offer must be rewritten from scratch, not lightly edited. (v2 shipped an auto-tinting client a site that still said "cabinetry" and "kitchen remodel" — it passed every identity gate, because a real remodeler's site is *supposed* to say that.)
3. **`about_business` is supplied facts, not licence to invent.** Anything it doesn't state stays off-limits; it never overrides explicit fields. Design-reference links inform look and feel only — never copy claims.
4. **Never emit markup, URLs, or tokens.** Plain strings only. Identity (name, phone, email, logo, map) is injected deterministically and must never be written by the model.
5. **Respect `max_chars`.** The sample text shows the intended length and tone; a headline slot is not a paragraph.
6. **Pricing never reaches a public site.** The dossier deliberately excludes `price_quoted`, `yearly_price`, `rating`, `comments`, `platform`.

---

### Task 1: Migration 0053 — `studio_runs` + `studio_run_events`

**Files:** Create `supabase/migrations/0053_studio_runs.sql`

- [ ] **Step 1: Write the migration** (file only — application is Task 11)

```sql
-- 0053_studio_runs.sql — Site Studio Phase 3a: generation runs.
--
-- A RUN turns one lead + one certified template into a rendered website.
-- Spec: docs/superpowers/specs/2026-07-23-site-studio-design.md §7, §10.
--
-- THE EXECUTION MODEL, and why the columns look like this. v2 ran a single
-- long-lived process per generation; when a deploy killed it the row sat in
-- `building` forever and needed a heartbeat column, an orphan reaper and a
-- force-resolve endpoint to dig out. A v3 run is instead a chain of SHORT
-- IDEMPOTENT STEPS: each claims itself, does <=30s of work, persists, exits.
-- Nothing long-lived exists, so nothing can be orphaned — a step that dies is
-- simply run again. That is why there is no heartbeat here.
--
--   status: queued -> preparing -> writing -> rendering -> ready -> (deployed, phase 4)
--           plus failed / cancelled, reachable from any active status.
--
-- `content_doc` is the single source of truth for the site's content (spec §6):
-- identity copied verbatim from the lead, per-page slot text written by AI,
-- provenance per field. It lives in-row because every step reads and writes it
-- and it is only strings — keeping it here makes each step's persistence one
-- UPDATE, which is what makes steps cheap enough to be idempotent.
--
-- `steps` records per-step state (including per-page write results and errors)
-- so the cockpit can show a live per-page view and retry ONE page.
--
-- RLS: enabled, no policies — service-role routes only, same as studio_templates.

create table public.studio_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete set null,
  template_id uuid references public.studio_templates (id) on delete restrict,
  -- the package version actually used; a later re-compile must not silently
  -- change what this run was built from
  template_version int not null,
  status text not null default 'queued'
    check (status in ('queued','preparing','writing','rendering','ready','failed','cancelled')),
  -- operator choices for this run (page selection, fan-out toggles, auto mode)
  options jsonb not null default '{}'::jsonb,
  -- the Content Document (spec §6). null until prepare completes.
  content_doc jsonb,
  -- per-step state: { prepare: {...}, write: { pages: { <page_id>: {...} } }, ... }
  steps jsonb not null default '{}'::jsonb,
  -- the lead's own photos, captured at prepare time so a later lead edit
  -- cannot change what this run was built from (phase 3b offers these first)
  client_photos text[] not null default '{}',
  site_slug text,
  -- set by finalize: storage key of the rendered site zip, ready for the
  -- phase-4 deploy handoff
  zip_path text,
  deployed_url text,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One ACTIVE run per lead. Partial unique index rather than a constraint so
-- finished runs (ready/failed/cancelled) accumulate freely as history — this
-- is the ONLY concurrency lock in the design; runs are otherwise independent
-- (v2's globally single-flight processor meant local testing fought prod).
create unique index studio_runs_one_active_per_lead
  on public.studio_runs (lead_id)
  where status in ('queued','preparing','writing','rendering');

create index studio_runs_template on public.studio_runs (template_id);
create index studio_runs_status_created on public.studio_runs (status, created_at desc);

alter table public.studio_runs enable row level security;

-- Append-only audit/progress log. Powers the cockpit timeline and post-mortems.
create table public.studio_run_events (
  id bigserial primary key,
  run_id uuid not null references public.studio_runs (id) on delete cascade,
  step text not null,
  level text not null default 'info' check (level in ('info','warn','error')),
  message text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index studio_run_events_run on public.studio_run_events (run_id, created_at);

alter table public.studio_run_events enable row level security;

-- private bucket for rendered site zips (phase 4 deploy reads from here)
insert into storage.buckets (id, name, public)
values ('studio-sites', 'studio-sites', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: Commit** — `git add supabase/migrations/0053_studio_runs.sql && git commit -m "feat(site-studio): migration 0053 - studio_runs, run events, sites bucket"`

**Do NOT apply it.** Task 11 applies it (the DB is shared production).

---

### Task 2: Run types + step machine

**Files:** Create `lib/site-studio/run/types.ts`; Test `tests/siteStudioRunTypes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { RUN_STATUSES, STEP_ORDER, nextStep, isTerminal, canCancel } from "@/lib/site-studio/run/types";

describe("run step machine", () => {
  it("declares the statuses and the step order", () => {
    expect(RUN_STATUSES).toEqual(["queued","preparing","writing","rendering","ready","failed","cancelled"]);
    expect(STEP_ORDER).toEqual(["prepare","write","render","finalize"]);
  });
  it("walks queued → prepare → write → render → finalize → done", () => {
    expect(nextStep("queued")).toBe("prepare");
    expect(nextStep("preparing")).toBe("write");
    expect(nextStep("writing")).toBe("render");
    expect(nextStep("rendering")).toBe("finalize");
    expect(nextStep("ready")).toBeNull();
  });
  it("has no next step once terminal", () => {
    for (const s of ["ready","failed","cancelled"] as const) {
      expect(nextStep(s)).toBeNull();
      expect(isTerminal(s)).toBe(true);
    }
    expect(isTerminal("writing")).toBe(false);
  });
  it("cancels only an active run", () => {
    expect(canCancel("queued")).toBe(true);
    expect(canCancel("writing")).toBe(true);
    expect(canCancel("ready")).toBe(false);
    expect(canCancel("cancelled")).toBe(false);
  });
});
```

Run it — FAIL (module not found).

- [ ] **Step 2: Implement**

```ts
import type { ContentDoc } from "../schema";

export const RUN_STATUSES = ["queued","preparing","writing","rendering","ready","failed","cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** The step chain. Each step is short and idempotent; re-running one is safe. */
export const STEP_ORDER = ["prepare","write","render","finalize"] as const;
export type RunStep = (typeof STEP_ORDER)[number];

const TERMINAL: RunStatus[] = ["ready","failed","cancelled"];
export const isTerminal = (s: RunStatus): boolean => TERMINAL.includes(s);

/** Which step a run in this status should execute next, or null when done. */
export function nextStep(status: RunStatus): RunStep | null {
  switch (status) {
    case "queued": return "prepare";
    case "preparing": return "write";
    case "writing": return "render";
    case "rendering": return "finalize";
    default: return null; // ready / failed / cancelled
  }
}

/** The status a run moves to while `step` is running. */
export const RUNNING_STATUS: Record<RunStep, RunStatus> = {
  prepare: "preparing",
  write: "writing",
  render: "rendering",
  finalize: "rendering",
};

export const canCancel = (s: RunStatus): boolean => !isTerminal(s);

export interface PageWriteState {
  status: "pending" | "written" | "failed";
  attempts: number;
  error?: string;
  model?: string;
}

export interface RunSteps {
  prepare?: { at: string; pages: number };
  write?: { pages: Record<string, PageWriteState> };
  render?: { at: string; files: number };
  finalize?: { at: string; zip_bytes: number };
}

export interface StudioRunRow {
  id: string;
  lead_id: string | null;
  template_id: string;
  template_version: number;
  status: RunStatus;
  options: { page_ids?: string[]; fan_out_services?: boolean; fan_out_areas?: boolean; auto?: boolean };
  content_doc: ContentDoc | null;
  steps: RunSteps;
  client_photos: string[];
  site_slug: string | null;
  zip_path: string | null;
  deployed_url: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3:** test PASSES. Commit: `feat(site-studio): run types and the short-step machine`

---

### Task 3: Lead → Dossier

The one place lead columns are read. Everything downstream sees a Dossier, never a raw lead — so the exclusion rules live in exactly one testable function.

**Files:** Create `lib/site-studio/run/dossier.ts`; Test `tests/siteStudioDossier.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildDossier, normalisePhone } from "@/lib/site-studio/run/dossier";

const lead = {
  id: "l1", business_name: "Acme Plumbing", business_phone: "(303) 555-1234",
  business_email: "hi@acme.com", no_email: false, business_profile_link: "https://g.page/acme",
  logo_link: "https://cdn/logo.png", map_embed_link: "https://maps/embed?q=Denver",
  site_type: "Custom Website", services: ["Drain Cleaning", " Water Heaters "],
  service_areas: ["Denver", ""], client_experience: 12, specify_pages: ["Home", "About Us"],
  color_scheme: "navy #0a2540 and orange", about_business: "Family run since 2012.",
  image_links: ["https://cdn/shop.jpg"], design_reference_links: ["https://ref.example"],
  add_ons: [{ id: "a", label: "SEO Boost", price: 100 }],
  price_quoted: 1500, yearly_price: "300", rating: 8, comments: "keen buyer", platform: "cold call",
};

describe("buildDossier", () => {
  const d = buildDossier(lead as never);

  it("carries the client-facing facts", () => {
    expect(d.business_name).toBe("Acme Plumbing");
    expect(d.phone).toBe("(303) 555-1234");
    expect(d.email).toBe("hi@acme.com");
    expect(d.services).toEqual(["Drain Cleaning", "Water Heaters"]); // trimmed
    expect(d.service_areas).toEqual(["Denver"]);                      // empties dropped
    expect(d.years_experience).toBe(12);
    expect(d.about_business).toBe("Family run since 2012.");
    expect(d.add_ons).toEqual(["SEO Boost"]);                         // labels only
    expect(d.client_photos).toEqual(["https://cdn/shop.jpg"]);
  });

  it("NEVER carries commercial or internal fields", () => {
    const json = JSON.stringify(d);
    expect(json).not.toContain("1500");
    expect(json).not.toContain("300");
    expect(json).not.toContain("keen buyer");
    expect(json).not.toContain("cold call");
    expect(d).not.toHaveProperty("rating");
    expect(d).not.toHaveProperty("price_quoted");
  });

  it("treats a missing email as unknown, not as 'no email'", () => {
    expect(buildDossier({ ...lead, business_email: null } as never).email).toBeUndefined();
    expect(buildDossier({ ...lead, business_email: null } as never).no_email).toBe(false);
    expect(buildDossier({ ...lead, business_email: null, no_email: true } as never).no_email).toBe(true);
  });

  it("tolerates a lead with nothing but a name", () => {
    const bare = buildDossier({ id: "l2", business_name: "Solo" } as never);
    expect(bare.business_name).toBe("Solo");
    expect(bare.services).toEqual([]);
    expect(bare.phone).toBeUndefined();
    expect(bare.client_photos).toEqual([]);
  });
});

describe("normalisePhone", () => {
  it("builds a tel: href from any format, keeping display text untouched", () => {
    expect(normalisePhone("(303) 555-1234")).toEqual({ display: "(303) 555-1234", href: "tel:3035551234" });
    expect(normalisePhone("+1 303.555.1234")).toEqual({ display: "+1 303.555.1234", href: "tel:+13035551234" });
    expect(normalisePhone(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
/** Everything a generated website may know about the client. Built ONCE from a
 *  lead row; nothing downstream reads the lead again. Commercial and internal
 *  fields (price_quoted, yearly_price, rating, comments, platform) are absent
 *  BY CONSTRUCTION — they must never reach a public page. */
export interface Dossier {
  lead_id: string;
  business_name: string;
  phone?: string;
  phone_href?: string;
  email?: string;
  /** True only when the lead explicitly says the business has no email. An
   *  absent email is "not captured yet", which is a different thing. */
  no_email: boolean;
  profile_link?: string;
  logo?: string;
  map_embed?: string;
  site_type?: string;
  services: string[];
  service_areas: string[];
  years_experience?: number;
  about_business?: string;
  color_scheme?: string;
  requested_pages: string[];
  design_references: string[];
  add_ons: string[];
  client_photos: string[];
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : undefined;
};

export function normalisePhone(raw: unknown): { display: string; href: string } | null {
  const display = str(raw);
  if (!display) return null;
  const digits = display.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? { display, href: `tel:${digits}` } : null;
}

/** Shape-loose on purpose: the caller passes a raw lead row. */
export function buildDossier(lead: Record<string, unknown>): Dossier {
  const phone = normalisePhone(lead.business_phone);
  const addOns = Array.isArray(lead.add_ons)
    ? (lead.add_ons as { label?: unknown }[]).map((a) => String(a?.label ?? "").trim()).filter(Boolean)
    : [];
  return {
    lead_id: String(lead.id),
    business_name: String(lead.business_name ?? "").trim(),
    phone: phone?.display,
    phone_href: phone?.href,
    email: str(lead.business_email),
    no_email: lead.no_email === true,
    profile_link: str(lead.business_profile_link),
    logo: str(lead.logo_link),
    map_embed: str(lead.map_embed_link),
    site_type: str(lead.site_type),
    services: arr(lead.services),
    service_areas: arr(lead.service_areas),
    years_experience: typeof lead.client_experience === "number" ? lead.client_experience : undefined,
    about_business: str(lead.about_business),
    color_scheme: str(lead.color_scheme),
    requested_pages: arr(lead.specify_pages),
    design_references: arr(lead.design_reference_links),
    add_ons: addOns,
    client_photos: arr(lead.image_links),
  };
}
```

- [ ] **Step 3:** PASS. Commit: `feat(site-studio): lead to dossier, with commercial fields excluded by construction`

---

### Task 4: Page selection

**Files:** Create `lib/site-studio/run/pageSelect.ts`; Test `tests/siteStudioPageSelect.test.ts`

Maps the lead's free-text `specify_pages` onto the template's actual page ids, and stamps fan-out pages (one per service / per area) from stampable page defs.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { selectPages, pageKindForName } from "@/lib/site-studio/run/pageSelect";
import type { TemplateManifest } from "@/lib/site-studio/schema";

const manifest = {
  engine: 3, name: "t", version: 1, identity: {}, theme: { mode: "none", roles: {} }, nav: [],
  pages: [
    { id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "", slots: [], repeats: [] },
    { id: "about", file: "about.html", kind: "about", stampable: false, title_sample: "", slots: [], repeats: [] },
    { id: "services", file: "services.html", kind: "services_hub", stampable: false, title_sample: "", slots: [], repeats: [] },
    { id: "contact", file: "contact.html", kind: "contact", stampable: false, title_sample: "", slots: [], repeats: [] },
    { id: "svc", file: "service.html", kind: "service", stampable: true, title_sample: "", slots: [], repeats: [] },
  ],
} as unknown as TemplateManifest;

describe("pageKindForName", () => {
  it("maps how sales actually types page names", () => {
    expect(pageKindForName("Home")).toBe("home");
    expect(pageKindForName("About Us")).toBe("about");
    expect(pageKindForName("our services")).toBe("services_hub");
    expect(pageKindForName("Service Areas")).toBe("areas_hub");
    expect(pageKindForName("Contact Us")).toBe("contact");
    expect(pageKindForName("Gallery")).toBe("gallery");
    expect(pageKindForName("Something Odd")).toBeNull();
  });
});

describe("selectPages", () => {
  it("uses the requested pages, always builds home first", () => {
    const r = selectPages(manifest, { requested: ["About Us", "Contact"], services: [], areas: [] });
    expect(r.pages.map((p) => p.page_id)).toEqual(["index", "about", "contact"]);
    expect(r.skipped).toEqual([]);
  });
  it("falls back to every non-stampable page when nothing was requested", () => {
    const r = selectPages(manifest, { requested: [], services: [], areas: [] });
    expect(r.pages.map((p) => p.page_id)).toEqual(["index", "about", "services", "contact"]);
  });
  it("reports requested pages the template cannot provide", () => {
    const r = selectPages(manifest, { requested: ["Home", "Blog"], services: [], areas: [] });
    expect(r.pages.map((p) => p.page_id)).toEqual(["index"]);
    expect(r.skipped).toEqual(["Blog"]);
  });
  it("stamps one page per service when fan-out is on", () => {
    const r = selectPages(manifest, {
      requested: ["Home"], services: ["Drain Cleaning", "Water Heaters"], areas: [],
      fanOutServices: true,
    });
    const stamped = r.pages.filter((p) => p.page_id === "svc");
    expect(stamped).toHaveLength(2);
    expect(stamped[0].output).toBe("services/drain-cleaning.html");
    expect(stamped[0].stamp_value).toBe("Drain Cleaning");
    expect(stamped[1].output).toBe("services/water-heaters.html");
  });
  it("does not stamp when fan-out is off, and never stamps without items", () => {
    expect(selectPages(manifest, { requested: ["Home"], services: ["A"], areas: [] })
      .pages.some((p) => p.page_id === "svc")).toBe(false);
    expect(selectPages(manifest, { requested: ["Home"], services: [], areas: [], fanOutServices: true })
      .pages.some((p) => p.page_id === "svc")).toBe(false);
  });
});
```

- [ ] **Step 2: Implement** — `slugify` (lowercase, non-alnum → `-`, collapse, trim, cap 60), a `PAGE_NAME_KINDS` synonym table covering the names sales actually types (home/homepage/landing; about/about us/our story; services/our services/what we do; areas/service areas/locations/cities we serve; gallery/portfolio/our work/projects; contact/contact us/get in touch/quote), normalise by lowercasing and stripping non-alphanumerics before an exact lookup, then a contains-fallback. `selectPages` returns `{ pages: SelectedPage[]; skipped: string[] }` where `SelectedPage = { page_id, output?, stamp_value?, nav_title? }`:
  - Start from requested names → kinds → the first manifest page of that kind that is **not stampable**. Deduplicate. Force the home page first if the template has one.
  - Empty request → every non-stampable page, manifest order, home first.
  - A requested name that maps to no kind, or to a kind the template lacks, goes into `skipped` (the cockpit shows this honestly — v2 silently dropped pages and then rendered nav links to them, producing 404s).
  - Fan-out: when `fanOutServices` and `services.length`, for each service emit one entry for the first `kind==="service"` stampable page with `output = "services/<slug>.html"`, `stamp_value = <service>`, `nav_title = <service>`. Same for `fanOutAreas` with `kind==="area"` → `areas/<slug>.html`.

- [ ] **Step 3:** PASS. Commit: `feat(site-studio): page selection from requested names, with fan-out stamping`

---

### Task 5: Theme derivation

**Files:** Create `lib/site-studio/run/theme.ts`; Test `tests/siteStudioRunTheme.test.ts`

- [ ] **Step 1: Test then implement.** `deriveTheme(colorScheme: string | undefined, manifestTheme: ThemeDef): Record<string,string>` returns a Content-Document `theme` map (role → hex):
  - Extract `#rgb`/`#rrggbb` hexes from the free text, in order, normalised to lowercase 6-digit.
  - Assign them to the manifest's roles in `brand, brand_deep, accent` order, only for roles the manifest actually declares, only as many as were found.
  - **No hexes found → return `{}`** (the renderer then keeps the template's own palette). Never guess from colour words: "navy" could be any of a hundred hexes, and v2's rule was explicit — never guess a colour.
  - Ignore anything that isn't a valid hex; the Content Document schema enforces the same regex, so an invalid value would be rejected downstream anyway.

Tests: `"navy #0a2540 and orange #ff7a1a"` → `{brand:"#0a2540", brand_deep:"#ff7a1a"}` when the manifest declares those two roles; `"up to us"` → `{}`; `"match the logo"` → `{}`; `"#fff"` → expands to `#ffffff`; more hexes than roles → extras dropped; a manifest with `mode:"none"` → `{}`.

Commit: `feat(site-studio): deterministic theme derivation, never guessing a colour`

---

### Task 6: Content Document seeding

**Files:** Create `lib/site-studio/run/seed.ts`; Test `tests/siteStudioSeed.test.ts`

Builds the skeleton the Writer fills: identity verbatim, theme derived, **image slots pre-filled with the template's own sample** (so the site renders complete before any curation exists), text slots left empty.

- [ ] **Step 1: Write the failing test** covering:
  - `seedContentDoc(manifest, dossier, selectedPages)` returns a doc whose `pages` mirror `selectedPages` (including stamped duplicates with their `output`/`nav_title`).
  - `identity` carries `business_name`, `phone`, `phone_href`, `email`, `logo`, `map_embed`, `profile_link`, `year` (current year as a string) — **verbatim from the dossier, never invented** — and omits keys the dossier lacks.
  - Every **image** slot value equals the manifest slot's `sample` (the template's own image path).
  - Every **text** slot value is `""` and appears in the returned `pending` list of `{page_id, slot_id}` for the Writer to fill; `title` is `""` too and is written per page.
  - A stamped page's entry repeats the same `page_id` but carries a distinct `output` (the renderer supports exactly this).
  - `contentDocSchema.parse` **fails** on the seed (empty strings are fine, but identity keys referenced by the skeleton may be missing) — so the test asserts the seed is explicitly *not* claimed to be a valid final doc; validity is asserted after the Writer fills it (Task 8). *(If parse actually succeeds, assert that instead — state which in the report.)*

- [ ] **Step 2: Implement**, then **Step 3:** PASS. Commit: `feat(site-studio): content document seeding with verbatim identity and template image defaults`

---

### Task 7: The Writer

One AI call per page. Input: the page's slots (id, semantic label, sample as tone/length guide, max_chars) plus the dossier. Output: strict JSON of slot id → string. Injectable call, so tests never touch the network.

**Files:** Create `lib/site-studio/run/writer.ts`; Test `tests/siteStudioWriter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { writePage, buildPagePrompt, WRITER_SYSTEM } from "@/lib/site-studio/run/writer";
import type { PageDef } from "@/lib/site-studio/schema";
import type { Dossier } from "@/lib/site-studio/run/dossier";

const page = {
  id: "index", file: "index.html", kind: "home", stampable: false,
  title_sample: "PlumberPro | Trusted Plumbing in Austin",
  slots: [
    { id: "index_s1", type: "text", sample: "Fast, Friendly Plumbing You Can Trust", html: false, max_chars: 60, semantic: "headline" },
    { id: "index_i1", type: "image", sample: "img/hero.jpg", html: false },
    { id: "index_s2", type: "text", sample: "We serve Austin homeowners.", html: false, max_chars: 90 },
  ],
  repeats: [{ id: "index_r1", fragment: "index_r1", min: 1, max: 12,
    slots: [{ id: "index_r1_s1", type: "text", sample: "Drain Cleaning", html: false, max_chars: 40 }],
    samples: [{ index_r1_s1: "Drain Cleaning" }, { index_r1_s1: "Water Heaters" }] }],
} as unknown as PageDef;

const dossier = {
  lead_id: "l1", business_name: "Acme Plumbing", phone: "(303) 555-1234", no_email: true,
  services: ["Sewer Repair", "Water Heaters"], service_areas: ["Denver"], years_experience: 12,
  about_business: "Family run since 2012.", requested_pages: [], design_references: [],
  add_ons: [], client_photos: [],
} as Dossier;

describe("buildPagePrompt", () => {
  const p = buildPagePrompt(page, dossier, { stampValue: undefined });
  it("sends the client's facts and the slots to fill", () => {
    expect(p).toContain("Acme Plumbing");
    expect(p).toContain("Sewer Repair");
    expect(p).toContain("index_s1");
    expect(p).toContain("60");                 // max_chars budget
    expect(p).toContain("headline");           // semantic label
  });
  it("never asks the model for image slots", () => {
    expect(p).not.toContain("index_i1");
  });
  it("includes repeat rows so cards get written", () => {
    expect(p).toContain("index_r1_s1");
  });
  it("passes the stamp value for a fan-out page", () => {
    expect(buildPagePrompt(page, dossier, { stampValue: "Sewer Repair" })).toContain("Sewer Repair");
  });
  it("the system prompt carries the non-negotiable rules", () => {
    expect(WRITER_SYSTEM).toMatch(/never invent/i);
    expect(WRITER_SYSTEM).toMatch(/plain text/i);
  });
});

describe("writePage", () => {
  it("parses a strict-JSON reply into slot values and a title", async () => {
    const call = async () => ({ text: JSON.stringify({
      title: "Acme Plumbing | Denver Plumbers",
      slots: { index_s1: "Denver Plumbing Done Right", index_s2: "We serve Denver homeowners." },
      repeats: { index_r1: [{ index_r1_s1: "Sewer Repair" }, { index_r1_s1: "Water Heaters" }] },
    }) });
    const r = await writePage(page, dossier, {}, call);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.title).toBe("Acme Plumbing | Denver Plumbers");
    expect(r.slots.index_s1).toBe("Denver Plumbing Done Right");
    expect(r.repeats.index_r1).toHaveLength(2);
  });
  it("tolerates fenced JSON", async () => {
    const call = async () => ({ text: "```json\n{\"title\":\"T\",\"slots\":{\"index_s1\":\"A\",\"index_s2\":\"B\"}}\n```" });
    expect((await writePage(page, dossier, {}, call)).ok).toBe(true);
  });
  it("fails loudly on unparseable output — never silently blank", async () => {
    const r = await writePage(page, dossier, {}, async () => ({ text: "sorry!" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/json/i);
  });
  it("rejects markup and token syntax in values", async () => {
    const bad = async () => ({ text: JSON.stringify({ title: "T", slots: { index_s1: "<b>hi</b>", index_s2: "ok" } }) });
    const r = await writePage(page, dossier, {}, bad);
    expect(r.ok).toBe(false);
  });
  it("truncates an over-long value rather than failing the page", async () => {
    const long = "x".repeat(500);
    const call = async () => ({ text: JSON.stringify({ title: "T", slots: { index_s1: long, index_s2: "ok" } }) });
    const r = await writePage(page, dossier, {}, call);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slots.index_s1.length).toBeLessThanOrEqual(60);
  });
  it("reports missing slots instead of inventing them", async () => {
    const call = async () => ({ text: JSON.stringify({ title: "T", slots: { index_s1: "only one" } }) });
    const r = await writePage(page, dossier, {}, call);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("index_s2");
  });
});
```

- [ ] **Step 2: Implement.** `WRITER_SYSTEM` carries the six rules from the top of this plan verbatim. `buildPagePrompt` emits: the client facts block (name, trade/site_type, services, areas, years, about, no-email note), the stamp value when present ("This page is specifically about: X"), then one line per **text** slot (`id | semantic | max N chars | sample: "…"`) and one block per repeat (`id`, how many rows the samples show, and its slots) — image slots are never mentioned. `writePage` calls, `parseJsonLoose`es, then validates: every text slot present (missing → `ok:false` naming them), no `<` or `{{` in any value (→ `ok:false`), values longer than `max_chars` are **truncated at a word boundary** (never a hard fail — a slightly long headline is not worth losing a page), repeat rows defaulted to the sample count when absent. Returns `{ok:true, title, slots, repeats} | {ok:false, error}`.

- [ ] **Step 3:** PASS. Commit: `feat(site-studio): the page writer - one strict-JSON call per page`

---

### Task 8: Apply written content

**Files:** Create `lib/site-studio/run/applyWritten.ts`; Test `tests/siteStudioApplyWritten.test.ts`

- [ ] Pure merge of one page's `WriteResult` into the run's Content Document, keyed by the doc-page index (so a stamped page updates only its own entry). Sets `title`, text slot values and repeat rows; leaves image slots untouched. Records provenance `written_by: "ai"` per field in a parallel `provenance` map the doc carries (spec §6) — operator edits later set `"operator"`, and re-roll only touches AI-written fields.

  Tests: merging fills exactly that page; a second page's merge doesn't disturb the first; image slots keep their seeded values; provenance is recorded; the function does not mutate its input; **after all pages are applied the doc passes `contentDocSchema.parse`** (this is the assertion that ties the Writer to the renderer's contract).

Commit: `feat(site-studio): apply written page content into the run's document`

---

### Task 9: Step engine + finalize

**Files:** Create `lib/site-studio/run/engine.ts`, `lib/site-studio/run/finalize.ts`; Test `tests/siteStudioEngine.test.ts`

- [ ] **`engine.ts`** exposes `runStep(admin, row, deps)` where `deps` supplies the AI call and (for tests) the clock — so the engine is testable without network. It:
  - Reads `nextStep(row.status)`; returns `{done:true}` when null.
  - **prepare**: load the template package's manifest, build the dossier from the lead, select pages, derive theme, seed the doc, compute `site_slug` (business slug + 6-char base36 suffix), persist `content_doc`, `client_photos`, `steps.prepare`, status → `writing`.
  - **write**: write **all pending pages in parallel** (`Promise.allSettled`), applying each result as it lands; per-page state recorded in `steps.write.pages`. A page that fails is marked `failed` with its error and does **not** fail the run — the cockpit offers a per-page retry. Status → `rendering` only when every page is `written`; if any failed, status stays `writing` and the step is re-runnable (it retries only the failed pages, bounded to 2 attempts each, then surfaces them).
  - **render**: `renderSite(package, content_doc)`. A refusal (missing slots) is a **run failure with the missing list** — never a silent partial site.
  - **finalize**: zip the rendered file map (`zipFromMap`), upload to `studio-sites/{run_id}/site.zip`, record `zip_path`, status → `ready`.
  - Every step appends a `studio_run_events` row. Every step is safe to re-run: it recomputes from the immutable inputs (template package + lead-derived dossier already stored in the doc) rather than from partial state.

- [ ] Tests use an in-memory fake `admin` (a small object recording `from().update()` calls and returning canned rows) plus the real fixture template compiled in-test, a fake lead, and a stub AI call — asserting: the chain advances one status per call; a failed page keeps the run in `writing` and records the error; re-running `write` retries only the failed page; a render refusal sets `failed` with the missing slot ids; a full happy path reaches `ready` with a non-empty zip.

Commit: `feat(site-studio): the step engine - parallel page writes, render and finalize`

---

### Task 10: Routes

**Files:** `app/api/site-studio/runs/route.ts`, `[id]/route.ts`, `[id]/step/route.ts`, `[id]/content/route.ts`

- [ ] Mirror the Phase 2a idiom exactly (`guard()`/`guardError()` from `lib/site-studio/service/guard`, `createAdminClient`, `runtime = "nodejs"`, `maxDuration = 300`, activity_log entries, async `params`).
  - **POST /runs** — body `{ lead_id, template_id, options }`. Refuses unless the template is `certified`; refuses if the lead already has an active run (the partial unique index is the real guard — catch its violation and return 409 with a clear message rather than a raw DB error). Creates the row `queued` and returns it.
  - **GET /runs** — list, newest first, with lead business name joined for display.
  - **GET /runs/[id]** — full row including `content_doc`.
  - **POST /runs/[id]/step** — advance exactly one step via `runStep`. Returns the updated row plus `{done}`. This is what the cockpit polls/drives.
  - **PATCH /runs/[id]/content** — operator edits: body `{ page_index, slots?, title? }`; validates against `contentDocSchema` after merging, sets provenance `operator`, refuses when the run is terminal.
- [ ] `tsc --noEmit` clean. Commit: `feat(site-studio): run routes - create, list, detail, step, content edits`

---

### Task 11: End-to-end proof, gates, migration

- [ ] **Step 1: `tests/siteStudioGenerationE2E.test.ts`** — the proof this phase works, with no DB and no network:
  compile the `plumberpro` fixture → build a dossier from a hand-written lead object → select pages → seed → write every page with a **stub model** that returns plausible client copy → apply → `renderSite` → assert: render `ok`, every page present, **the client's business name appears and "PlumberPro" appears nowhere**, the client's services appear, no `{{` tokens survive, and the template's own image paths are still referenced (the 3a image default). This is the phase's acceptance criterion in one test.
- [ ] **Step 2:** `npm test` (all green), `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` (zero errors), `NODE_OPTIONS=--max-old-space-size=6144 npm run build` (succeeds, new routes in the manifest).
- [ ] **Step 3: Apply migration 0053** via the Supabase MCP `apply_migration` tool (the user has pre-approved migration application for this project), then verify with a read-only query: `studio_runs` and `studio_run_events` exist with RLS enabled and zero policies, the partial unique index exists, and the `studio-sites` bucket exists and is private.
- [ ] **Step 4:** `git status --short` clean.

**Phase 3a is complete when** the E2E test renders a real client site from the fixture template with AI-written text, all gates are green, and the migration is applied. Phase 3b (cockpit + image curation) gets its own plan.

---

## Self-review notes

- **Spec coverage:** §6 Content Document (identity verbatim, per-page slots, provenance) and the Writer (per-page, parallel, plain strings, no invented facts); §7 the short-idempotent-step engine, per-page failure isolation, one-active-run-per-lead as the only lock; §10 `studio_runs`/`studio_run_events` + bucket. Deferred with reasons: images/curation and the cockpit (3b), deploy handoff (4).
- **Every v2 lesson that applies is encoded** rather than described: commercial fields excluded by construction in the Dossier type; category-drift and never-invent rules in the Writer system prompt; skipped pages surfaced instead of silently dropped (v2's 404 cause); render refusal instead of a silent partial site; no heartbeat column because nothing is long-lived.
- **Names are consistent across tasks:** `Dossier`/`buildDossier`, `selectPages`/`SelectedPage`, `deriveTheme`, `seedContentDoc`, `writePage`/`WriteResult`, `applyWritten`, `runStep`, `nextStep`/`RUN_STATUSES`/`STEP_ORDER`.
- **Testability:** every task's logic is a pure function or takes an injectable call; the only untested surfaces are the four thin routes, matching the repo's convention and Phase 2a's precedent.
