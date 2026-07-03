# WGE Control (WGE-1, control layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the website-generation prompt, lead→form field mapping, and engine settings fully editable from an admin UI (`/ai-tools/wge`), persisted in a `wge_config` DB row, with the generators reading their behavior from that config instead of hardcoded code.

**Architecture:** A singleton `wge_config` row stores the system prompt, a `{{key|fallback}}` user-prompt template, variable/mapping definitions, and engine settings. A pure template engine renders the prompt; `buildPrompt`/`mapLeadToInput` become thin config-driven wrappers. The seeded default config reproduces today's prompt byte-for-byte, so the refactor is behavior-preserving. A new dependent permission `wge.manage` (requires `ai_tools.*`) gates the control UI.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + RLS), Zod, Vitest, Tailwind v4. Migrations applied via the Supabase MCP `apply_migration` tool (project id `ikuvbxjkoojtgekapbul`).

**Note on a small coherence change vs. the spec:** the interactive generator stays per-tool, so `settings` does NOT carry a standalone generator `provider`/`model` (those remain `TOOLS[tool]` defaults). The configurable engine for headless runs is `settings.auto_engine` (consumed in WGE-2). `settings` holds generator-relevant globals (`max_tokens`, `temperature`, `default_pages`, `auto_download`) plus the WGE-2 automation block (`auto_generate`, `auto_engine`, `ready_required`).

---

## File Structure

**Create:**
- `lib/ai-tools/wge-types.ts` — `WgeVariable`, `WgeSettings`, `WgeConfig` types.
- `lib/ai-tools/template.ts` — pure template engine (`renderTemplate`, `listTemplateVars`).
- `lib/ai-tools/wge-defaults.ts` — `DEFAULT_SYSTEM_PROMPT`, `DEFAULT_PROMPT_TEMPLATE`, `DEFAULT_VARIABLES`, `DEFAULT_SETTINGS`, `DEFAULT_WGE_CONFIG`.
- `lib/ai-tools/wge-schema.ts` — Zod `wgeConfigSchema`.
- `lib/ai-tools/wge.ts` — server config loader (`getWgeConfig`, `assertWgeAccess`).
- `app/api/ai-tools/wge/route.ts` — `GET` + `PUT` config.
- `app/api/ai-tools/wge/reset/route.ts` — `POST` reset to defaults.
- `app/(app)/ai-tools/wge/page.tsx` — server-guarded WGE page.
- `components/ai-tools/wge/WgeControl.tsx` — client tabbed control panel.
- `supabase/migrations/0007_wge.sql` — `wge_config` table + RLS + `wge.manage` permission + dept grant.
- `tests/wgeTemplate.test.ts`, `tests/wgeConfig.test.ts` — unit tests.

**Modify:**
- `lib/ai-tools/prompt.ts` — `buildPrompt(values, template?)` via `renderTemplate` + `buildContext`; keep `GenInput`, `EMPTY_INPUT`, `defaultPages`. Re-export defaults.
- `lib/ai-tools/leadPrefill.ts` — `mapLeadToInput(lead, variables?)` config-driven.
- `lib/permissions/constants.ts` — add `wge.manage`.
- `supabase/seed.sql` — add `wge.manage` permission + `tech` grant (for fresh installs).
- `components/ai-tools/Generator.tsx` — render fields & build prompt from config; honor settings + auto_download.
- `app/(app)/ai-tools/webcraft/page.tsx`, `app/(app)/ai-tools/deepseek/page.tsx` — load config, pass to `Generator`, config-driven prefill.
- `app/api/ai-tools/[tool]/generate/route.ts` — read system prompt from config instead of the `SYSTEM_PROMPT` constant.
- `components/layout/Sidebar.tsx` — add WGE nav with the dependency rule.
- `tests/aiTools.test.ts` — extend `buildPrompt`/mapping assertions for parity.

---

## Task 1: WGE types

**Files:**
- Create: `lib/ai-tools/wge-types.ts`

- [ ] **Step 1: Create the types module**

```typescript
import type { ToolId } from "./config";

export type WgeVarType = "text" | "textarea" | "number" | "list";

export interface WgeVariable {
  key: string;          // referenced in the template as {{key}}
  label: string;        // shown in the generator form + WGE editor
  type: WgeVarType;
  fallback: string;     // used when empty (inline {{key|...}} overrides this)
  lead_column: string | null; // source column on `leads`, or null (no auto-map)
  join: string;         // for list types from array columns: ", " or "\n"
}

export interface WgeSettings {
  max_tokens: number;
  temperature: number;
  default_pages: number;
  auto_download: boolean;
  // --- stored now, consumed by WGE-2 ---
  auto_generate: boolean;
  auto_engine: { provider: ToolId; model: string } | null;
  ready_required: string[]; // variable keys required before auto-queue
}

export interface WgeConfig {
  system_prompt: string;
  prompt_template: string;
  variables: WgeVariable[];
  settings: WgeSettings;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/ai-tools/wge-types.ts
git commit -m "feat(wge): config types"
```

---

## Task 2: Pure template engine

**Files:**
- Create: `lib/ai-tools/template.ts`
- Test: `tests/wgeTemplate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { renderTemplate, listTemplateVars } from "@/lib/ai-tools/template";

describe("renderTemplate", () => {
  it("substitutes a present value", () => {
    expect(renderTemplate("Hi {{name}}", { name: "Acme" })).toBe("Hi Acme");
  });
  it("uses inline fallback when the value is empty or missing", () => {
    expect(renderTemplate("{{name|(none)}}", { name: "" })).toBe("(none)");
    expect(renderTemplate("{{name|(none)}}", {})).toBe("(none)");
  });
  it("prefers the value over the fallback when present", () => {
    expect(renderTemplate("{{name|(none)}}", { name: "Acme" })).toBe("Acme");
  });
  it("renders empty for a missing key with no fallback", () => {
    expect(renderTemplate("[{{x}}]", {})).toBe("[]");
  });
  it("replaces every occurrence", () => {
    expect(renderTemplate("{{p}}/{{p}}", { p: "2" })).toBe("2/2");
  });
  it("keeps only the part before the first pipe as the key", () => {
    expect(renderTemplate("{{a|x|y}}", {})).toBe("x|y");
  });
  it("leaves text without placeholders untouched (incl. CSS braces)", () => {
    expect(renderTemplate(":root { --x: 1 }", {})).toBe(":root { --x: 1 }");
  });
});

describe("listTemplateVars", () => {
  it("returns the unique set of placeholder keys", () => {
    expect(listTemplateVars("{{a}} {{b|f}} {{a}}").sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- wgeTemplate`
Expected: FAIL (module not found / functions undefined).

- [ ] **Step 3: Implement the engine**

```typescript
// Pure {{key}} / {{key|fallback}} template engine. No domain imports.
const TOKEN = /\{\{\s*([^}|]+?)\s*(?:\|([^}]*))?\}\}/g;

export function renderTemplate(template: string, context: Record<string, string>): string {
  return template.replace(TOKEN, (_m, rawKey: string, fallback?: string) => {
    const key = rawKey.trim();
    const value = context[key];
    if (value !== undefined && value !== "") return value;
    return fallback ?? "";
  });
}

export function listTemplateVars(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(TOKEN)) out.add(m[1].trim());
  return [...out];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- wgeTemplate`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools/template.ts tests/wgeTemplate.test.ts
git commit -m "feat(wge): pure {{key|fallback}} template engine"
```

---

## Task 3: Default config (prompt → template conversion)

**Files:**
- Create: `lib/ai-tools/wge-defaults.ts`

This is the behavior-preserving core: the current `buildPrompt` template literal becomes a static template string with placeholders.

- [ ] **Step 1: Create `wge-defaults.ts` with the system prompt and settings**

```typescript
import type { WgeConfig, WgeVariable, WgeSettings } from "./wge-types";

export const DEFAULT_SYSTEM_PROMPT = `You are an elite web developer and designer specialising in premium, production-grade websites.
You output ONLY raw HTML code — never any explanations, markdown fences, commentary, or preamble.
Your output MUST begin with exactly:
<!DOCTYPE html>
It must be a single, complete, 100% functional HTML file.`;

export const DEFAULT_SETTINGS: WgeSettings = {
  max_tokens: 8192,
  temperature: 0.7,
  default_pages: 5,
  auto_download: false,
  auto_generate: false,
  auto_engine: null,
  ready_required: ["name", "services", "pages"],
};

export const DEFAULT_VARIABLES: WgeVariable[] = [
  { key: "name", label: "Business name", type: "text", fallback: "(not provided)", lead_column: "business_name", join: ", " },
  { key: "phone", label: "Phone", type: "text", fallback: "(not provided)", lead_column: "business_phone", join: ", " },
  { key: "email", label: "Email", type: "text", fallback: "(not provided)", lead_column: "business_email", join: ", " },
  { key: "services", label: "Services", type: "text", fallback: "(not provided)", lead_column: "services", join: ", " },
  { key: "exp", label: "Years of experience", type: "number", fallback: "", lead_column: "client_experience", join: ", " },
  { key: "color", label: "Color scheme", type: "text", fallback: "(not provided — use a modern, professional palette relevant to the industry)", lead_column: "color_scheme", join: ", " },
  { key: "profile", label: "Profile / about", type: "textarea", fallback: "(not provided)", lead_column: "comments", join: ", " },
  { key: "pages", label: "Number of pages", type: "number", fallback: "5", lead_column: "num_webpages", join: ", " },
  { key: "pageNames", label: "Specific page names", type: "text", fallback: "", lead_column: "specify_pages", join: ", " },
  { key: "google", label: "Google business profile link", type: "text", fallback: "(not provided)", lead_column: "business_profile_link", join: ", " },
  { key: "map", label: "Map embed link", type: "text", fallback: "(not provided — use a placeholder or omit)", lead_column: "map_embed_link", join: ", " },
  { key: "hero", label: "Hero image links", type: "textarea", fallback: "(not provided — source high-quality Unsplash images relevant to the business)", lead_column: null, join: "\n" },
  { key: "serviceImgs", label: "Service image links", type: "textarea", fallback: "(not provided — source relevant stock images)", lead_column: null, join: "\n" },
  { key: "logo", label: "Logo link", type: "text", fallback: "(not provided — search for a professional logo or generate a text-based logo)", lead_column: "logo_link", join: ", " },
  { key: "imgs", label: "Additional image links", type: "textarea", fallback: "(not provided — source relevant stock images)", lead_column: "image_links", join: "\n" },
  { key: "r1", label: "Reference site 1", type: "text", fallback: "", lead_column: "reference_link", join: ", " },
  { key: "r2", label: "Reference site 2", type: "text", fallback: "", lead_column: null, join: ", " },
  { key: "r3", label: "Reference site 3", type: "text", fallback: "", lead_column: null, join: ", " },
  { key: "r4", label: "Reference site 4", type: "text", fallback: "", lead_column: null, join: ", " },
  { key: "extra", label: "Extra notes / instructions", type: "textarea", fallback: "", lead_column: null, join: ", " },
];
```

- [ ] **Step 2: Add `DEFAULT_PROMPT_TEMPLATE`** — copy the entire template-literal body of the current `buildPrompt` in `lib/ai-tools/prompt.ts` (everything between the opening backtick after `return` and the closing `` `; ``), paste it as a new exported `const DEFAULT_PROMPT_TEMPLATE = \`...\`;` in `wge-defaults.ts`, then apply EXACTLY these find/replace substitutions inside it (the rest — the whole CSS design system, Parts 4–7 — is copied verbatim):

| Find (current interpolation) | Replace with |
|---|---|
| `${refs.length \|\| 4}` | `{{ref_count}}` |
| `${refsStr}` | `{{references}}` |
| `${d.name \|\| '(not provided)'}` | `{{name\|(not provided)}}` |
| `${d.phone \|\| '(not provided)'}` | `{{phone\|(not provided)}}` |
| `${d.email \|\| '(not provided)'}` | `{{email\|(not provided)}}` |
| `${d.services \|\| '(not provided)'}` | `{{services\|(not provided)}}` |
| `${d.exp ? d.exp + ' Years' : '(not provided)'}` | `{{experience}}` |
| `${d.color \|\| '(not provided — use a modern, professional palette relevant to the industry)'}` | `{{color\|(not provided — use a modern, professional palette relevant to the industry)}}` |
| `${d.profile \|\| '(not provided)'}` | `{{profile\|(not provided)}}` |
| `${d.google \|\| '(not provided)'}` | `{{google\|(not provided)}}` |
| `${d.hero \|\| '(not provided — source high-quality Unsplash images relevant to the business)'}` | `{{hero\|(not provided — source high-quality Unsplash images relevant to the business)}}` |
| `${d.serviceImgs \|\| '(not provided — source relevant stock images)'}` | `{{serviceImgs\|(not provided — source relevant stock images)}}` |
| `${d.logo \|\| '(not provided — search for a professional logo or generate a text-based logo)'}` | `{{logo\|(not provided — search for a professional logo or generate a text-based logo)}}` |
| `${d.imgs \|\| '(not provided — source relevant stock images)'}` | `{{imgs\|(not provided — source relevant stock images)}}` |
| `${d.pages}` (both occurrences) | `{{pages}}` |
| `${pnames}` | `{{page_names}}` |
| `${d.map \|\| '(not provided — use a placeholder or omit)'}` | `{{map\|(not provided — use a placeholder or omit)}}` |

Keep it a backtick template literal (the embedded `` \`\`\`html `` stays escaped as in the source). After substitution there must be **no `${` left** in the string.

- [ ] **Step 3: Add the composed default config export**

```typescript
export const DEFAULT_WGE_CONFIG: WgeConfig = {
  system_prompt: DEFAULT_SYSTEM_PROMPT,
  prompt_template: DEFAULT_PROMPT_TEMPLATE,
  variables: DEFAULT_VARIABLES,
  settings: DEFAULT_SETTINGS,
};
```

- [ ] **Step 4: Verify no leftover interpolation**

Run: `grep -n '\${' lib/ai-tools/wge-defaults.ts`
Expected: no output (exit 1).

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit` → no new errors.
```bash
git add lib/ai-tools/wge-defaults.ts
git commit -m "feat(wge): default config (prompt template + variables + settings)"
```

---

## Task 4: Refactor `prompt.ts` to render from a template + context

**Files:**
- Modify: `lib/ai-tools/prompt.ts`
- Test: `tests/aiTools.test.ts` (extend existing `buildPrompt` block)

- [ ] **Step 1: Add `buildContext` and rewrite `buildPrompt`** in `lib/ai-tools/prompt.ts`. Keep the existing `GenInput`, `EMPTY_INPUT`, and `defaultPages` exports. Remove the old `SYSTEM_PROMPT` constant (now `DEFAULT_SYSTEM_PROMPT` in `wge-defaults.ts`) and the giant template literal inside `buildPrompt`. Replace the `buildPrompt` function and add `buildContext`:

```typescript
import { renderTemplate } from "./template";
import { DEFAULT_PROMPT_TEMPLATE } from "./wge-defaults";

// (keep GenInput, EMPTY_INPUT, defaultPages exactly as they are)

/** Resolve the substitution context (raw values + derived variables). */
export function buildContext(d: GenInput): Record<string, string> {
  const refs = [d.r1, d.r2, d.r3, d.r4].filter(Boolean);
  return {
    name: d.name,
    phone: d.phone,
    email: d.email,
    services: d.services,
    exp: d.exp,
    color: d.color,
    profile: d.profile,
    pages: d.pages,
    pageNames: d.pageNames,
    google: d.google,
    map: d.map,
    hero: d.hero,
    serviceImgs: d.serviceImgs,
    logo: d.logo,
    imgs: d.imgs,
    r1: d.r1, r2: d.r2, r3: d.r3, r4: d.r4,
    extra: d.extra,
    // derived
    references: refs.length ? refs.join("\n") : "(none provided — use your best design judgement)",
    ref_count: String(refs.length || 4),
    experience: d.exp ? `${d.exp} Years` : "(not provided)",
    page_names: d.pageNames || defaultPages(d.pages),
  };
}

export function buildPrompt(d: GenInput, template: string = DEFAULT_PROMPT_TEMPLATE): string {
  return renderTemplate(template, buildContext(d));
}
```

- [ ] **Step 2: Update the generate route's system-prompt import** — in `app/api/ai-tools/[tool]/generate/route.ts`, the line `import { SYSTEM_PROMPT } from "@/lib/ai-tools/prompt";` will break. Defer the fix to Task 8 (it will read from config). For now, temporarily change that import to `import { DEFAULT_SYSTEM_PROMPT as SYSTEM_PROMPT } from "@/lib/ai-tools/wge-defaults";` so the build stays green.

- [ ] **Step 3: Extend the parity test** in `tests/aiTools.test.ts` — replace the existing `describe("buildPrompt", ...)` block with:

```typescript
describe("buildPrompt", () => {
  it("injects business details and the file delimiter format", () => {
    const p = buildPrompt({ ...EMPTY_INPUT, name: "Acme Roofing", pages: "3" });
    expect(p).toContain("Acme Roofing");
    expect(p).toContain("[FILE: index.html]");
    expect(p).toContain("[END_FILE]");
    expect(p).toContain("3-page website");
    expect(p.trim().endsWith("START GENERATING NOW.")).toBe(true);
  });
  it("applies fallbacks for empty fields", () => {
    const p = buildPrompt({ ...EMPTY_INPUT, name: "" });
    expect(p).toContain("Business Name: (not provided)");
  });
  it("renders derived experience and references", () => {
    const p = buildPrompt({ ...EMPTY_INPUT, exp: "12", r1: "https://a.com", r2: "https://b.com" });
    expect(p).toContain("Experience: 12 Years");
    expect(p).toContain("https://a.com\nhttps://b.com");
    expect(p).toContain("giving you 2 sites"); // ref_count
  });
  it("falls back to the default page list when names are blank", () => {
    const p = buildPrompt({ ...EMPTY_INPUT, pages: "3" });
    expect(p).toContain("Home, About, Services");
  });
});
```

- [ ] **Step 4: Run the AI-tools tests**

Run: `npm run test -- aiTools`
Expected: PASS (all buildPrompt + existing assertions green).

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools/prompt.ts app/api/ai-tools/[tool]/generate/route.ts tests/aiTools.test.ts
git commit -m "refactor(wge): buildPrompt renders default template via the engine"
```

---

## Task 5: Config-driven `mapLeadToInput`

**Files:**
- Modify: `lib/ai-tools/leadPrefill.ts`
- Test: `tests/aiTools.test.ts` (extend the existing `mapLeadToInput` block)

- [ ] **Step 1: Rewrite `mapLeadToInput` to be variable-driven**

```typescript
import type { GenInput } from "./prompt";
import type { WgeVariable } from "./wge-types";
import { DEFAULT_VARIABLES } from "./wge-defaults";

type LeadRow = Record<string, unknown>;

// Map a leads row to generator form values using the configured variable mappings.
export function mapLeadToInput(lead: LeadRow, variables: WgeVariable[] = DEFAULT_VARIABLES): Partial<GenInput> {
  const out: Record<string, string> = {};
  for (const v of variables) {
    if (!v.lead_column) continue;
    const raw = lead[v.lead_column];
    if (raw == null) continue;
    out[v.key] = Array.isArray(raw) ? (raw as unknown[]).filter(Boolean).join(v.join) : String(raw);
  }
  return out as Partial<GenInput>;
}
```

- [ ] **Step 2: Extend the mapping test** in `tests/aiTools.test.ts` — replace the existing `describe("mapLeadToInput", ...)` block:

```typescript
describe("mapLeadToInput", () => {
  it("maps configured lead columns to generator fields with join rules", () => {
    const f = mapLeadToInput({
      business_name: "Acme",
      business_phone: "555",
      services: ["Roofing", "Gutters"],
      num_webpages: 6,
      specify_pages: ["Home", "About"],
      color_scheme: "green",
      image_links: ["a", "b"],
    });
    expect(f.name).toBe("Acme");
    expect(f.phone).toBe("555");
    expect(f.services).toBe("Roofing, Gutters");
    expect(f.pages).toBe("6");
    expect(f.pageNames).toBe("Home, About");
    expect(f.imgs).toBe("a\nb"); // newline join
  });
  it("skips variables with no lead_column and null lead values", () => {
    const f = mapLeadToInput({ business_name: "Acme", color_scheme: null });
    expect(f.name).toBe("Acme");
    expect("color" in f).toBe(false);
    expect("hero" in f).toBe(false); // hero has no lead_column
  });
  it("respects a custom variable set", () => {
    const f = mapLeadToInput({ business_name: "X" }, [
      { key: "name", label: "n", type: "text", fallback: "", lead_column: "business_name", join: ", " },
    ]);
    expect(f).toEqual({ name: "X" });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm run test -- aiTools`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/ai-tools/leadPrefill.ts tests/aiTools.test.ts
git commit -m "refactor(wge): config-driven mapLeadToInput"
```

---

## Task 6: Config Zod schema

**Files:**
- Create: `lib/ai-tools/wge-schema.ts`
- Test: `tests/wgeConfig.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { wgeConfigSchema } from "@/lib/ai-tools/wge-schema";
import { DEFAULT_WGE_CONFIG } from "@/lib/ai-tools/wge-defaults";

describe("wgeConfigSchema", () => {
  it("accepts the default config", () => {
    expect(wgeConfigSchema.safeParse(DEFAULT_WGE_CONFIG).success).toBe(true);
  });
  it("rejects a bad variable key", () => {
    const bad = { ...DEFAULT_WGE_CONFIG, variables: [{ key: "Bad Key", label: "x", type: "text", fallback: "", lead_column: null, join: ", " }] };
    expect(wgeConfigSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects an unknown variable type", () => {
    const bad = { ...DEFAULT_WGE_CONFIG, variables: [{ key: "ok", label: "x", type: "color", fallback: "", lead_column: null, join: ", " }] };
    expect(wgeConfigSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects out-of-range temperature", () => {
    const bad = { ...DEFAULT_WGE_CONFIG, settings: { ...DEFAULT_WGE_CONFIG.settings, temperature: 9 } };
    expect(wgeConfigSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects an empty prompt template", () => {
    expect(wgeConfigSchema.safeParse({ ...DEFAULT_WGE_CONFIG, prompt_template: "" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- wgeConfig`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the schema**

```typescript
import { z } from "zod";
import { TOOL_IDS } from "./config";

const variableSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "key must be snake_case"),
  label: z.string().trim().min(1),
  type: z.enum(["text", "textarea", "number", "list"]),
  fallback: z.string(),
  lead_column: z.string().min(1).nullable(),
  join: z.string(),
});

const settingsSchema = z.object({
  max_tokens: z.number().int().min(256).max(64000),
  temperature: z.number().min(0).max(2),
  default_pages: z.number().int().min(1).max(20),
  auto_download: z.boolean(),
  auto_generate: z.boolean(),
  auto_engine: z
    .object({ provider: z.enum(TOOL_IDS as [string, ...string[]]), model: z.string().min(1) })
    .nullable(),
  ready_required: z.array(z.string()),
});

export const wgeConfigSchema = z.object({
  system_prompt: z.string().trim().min(10),
  prompt_template: z.string().trim().min(20),
  variables: z.array(variableSchema).min(1).max(60),
  settings: settingsSchema,
});

export type WgeConfigInput = z.infer<typeof wgeConfigSchema>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- wgeConfig`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/ai-tools/wge-schema.ts tests/wgeConfig.test.ts
git commit -m "feat(wge): config Zod schema"
```

---

## Task 7: Migration — table, RLS, permission, grant

**Files:**
- Create: `supabase/migrations/0007_wge.sql`
- Modify: `lib/permissions/constants.ts`, `supabase/seed.sql`

- [ ] **Step 1: Add the permission to `constants.ts`** — insert this line into the `PERMISSIONS` array, right after the `ai_tools.deepseek` entry:

```typescript
  { key: "wge.manage", name: "Manage Website Engine (WGE)", category: "ai_tools", is_sensitive: true },
```

- [ ] **Step 2: Write the migration file** `supabase/migrations/0007_wge.sql`:

```sql
-- WGE-1: Website Generation Engine control config

create table if not exists public.wge_config (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique,
  system_prompt text not null,
  prompt_template text not null,
  variables jsonb not null default '[]',
  settings jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.wge_config enable row level security;

-- any authenticated user who can use AI tools may read the config (the
-- generator needs it). Writes happen via the service role behind the API guard.
create policy "read wge_config" on public.wge_config for select to authenticated using (true);

-- new permission + grant for fresh installs / existing tech dept
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('wge.manage','Manage Website Engine (WGE)',null,'ai_tools',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
select d.id, 'wge.manage' from public.departments d where d.slug = 'tech'
on conflict do nothing;
```

- [ ] **Step 3: Apply the migration** via the Supabase MCP `apply_migration` tool: `project_id: ikuvbxjkoojtgekapbul`, `name: 0007_wge`, `query:` the SQL above.
Expected: `{"success":true}`.

- [ ] **Step 4: Mirror into `seed.sql`** (fresh installs) — add to the `insert into public.permissions ... values` list:
```sql
  ('wge.manage','Manage Website Engine (WGE)',null,'ai_tools',true),
```
and add `('tech','wge.manage')` to the `tech` department's grant tuples in the `department_permissions` block.

- [ ] **Step 5: Verify the row/permission**

Run (Supabase MCP `execute_sql`): `select key from public.permissions where key='wge.manage';`
Expected: one row.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0007_wge.sql supabase/seed.sql lib/permissions/constants.ts
git commit -m "feat(wge): wge_config table, RLS, wge.manage permission"
```

---

## Task 8: Server config loader + access guard + generate-route system prompt

**Files:**
- Create: `lib/ai-tools/wge.ts`
- Modify: `app/api/ai-tools/[tool]/generate/route.ts`

- [ ] **Step 1: Create the loader + guard**

```typescript
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { DEFAULT_WGE_CONFIG } from "./wge-defaults";
import type { WgeConfig } from "./wge-types";

const AI_TOOLS_PERMS = ["ai_tools.webcraft", "ai_tools.deepseek"];

// Read the singleton config; lazily materialise the default row if missing.
export async function getWgeConfig(): Promise<WgeConfig> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("wge_config")
    .select("system_prompt, prompt_template, variables, settings")
    .eq("singleton", true)
    .maybeSingle();

  if (data) {
    return {
      system_prompt: data.system_prompt,
      prompt_template: data.prompt_template,
      variables: data.variables,
      settings: data.settings,
    } as WgeConfig;
  }

  // seed default row using the service role (RLS blocks client writes)
  const admin = createAdminClient();
  await admin.from("wge_config").upsert(
    {
      singleton: true,
      system_prompt: DEFAULT_WGE_CONFIG.system_prompt,
      prompt_template: DEFAULT_WGE_CONFIG.prompt_template,
      variables: DEFAULT_WGE_CONFIG.variables,
      settings: DEFAULT_WGE_CONFIG.settings,
    },
    { onConflict: "singleton" }
  );
  return DEFAULT_WGE_CONFIG;
}

export interface WgeAccess { ok: true; userId: string } | { ok: false; status: number };

// WGE management requires wge.manage AND an AI-tools permission.
export async function assertWgeManage(): Promise<{ userId: string } | { error: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  const hasAiTools = AI_TOOLS_PERMS.some((p) => perms.has(p));
  if (!perms.has("wge.manage") || !hasAiTools) return { error: 403 };
  return { userId: user.id };
}
```
> Note: delete the stray `WgeAccess` interface line above if your linter flags the union syntax — it is not used; keep only `assertWgeManage` and `getWgeConfig`.

- [ ] **Step 2: Point the generate route at the configured system prompt** — in `app/api/ai-tools/[tool]/generate/route.ts`, remove the temporary `DEFAULT_SYSTEM_PROMPT` import from Task 4 and use the loader. Change the messages array to use `config.system_prompt`:

```typescript
// near the other imports
import { getWgeConfig } from "@/lib/ai-tools/wge";
// remove: import { DEFAULT_SYSTEM_PROMPT as SYSTEM_PROMPT } from "@/lib/ai-tools/wge-defaults";

// inside POST, after permission check and before building the fetch body:
const wge = await getWgeConfig();

// in the request body messages:
messages: [
  { role: "system", content: wge.system_prompt },
  { role: "user", content: prompt },
],
```

- [ ] **Step 3: Typecheck & build**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/ai-tools/wge.ts app/api/ai-tools/[tool]/generate/route.ts
git commit -m "feat(wge): server config loader + access guard; generate route uses configured system prompt"
```

---

## Task 9: Config API routes (GET / PUT / reset)

**Files:**
- Create: `app/api/ai-tools/wge/route.ts`, `app/api/ai-tools/wge/reset/route.ts`

- [ ] **Step 1: GET + PUT** in `app/api/ai-tools/wge/route.ts`

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getWgeConfig, assertWgeManage } from "@/lib/ai-tools/wge";
import { wgeConfigSchema } from "@/lib/ai-tools/wge-schema";

export const runtime = "nodejs";

const AI_TOOLS_PERMS = ["ai_tools.webcraft", "ai_tools.deepseek"];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!AI_TOOLS_PERMS.some((p) => perms.has(p))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ config: await getWgeConfig() });
}

export async function PUT(req: Request) {
  const auth = await assertWgeManage();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });

  const parsed = wgeConfigSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid config", issues: parsed.error.flatten() }, { status: 422 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("wge_config").upsert(
    {
      singleton: true,
      system_prompt: parsed.data.system_prompt,
      prompt_template: parsed.data.prompt_template,
      variables: parsed.data.variables,
      settings: parsed.data.settings,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: "singleton" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "wge.config.updated",
    entity_type: "wge_config",
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Reset** in `app/api/ai-tools/wge/reset/route.ts`

```typescript
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWgeManage } from "@/lib/ai-tools/wge";
import { DEFAULT_WGE_CONFIG } from "@/lib/ai-tools/wge-defaults";

export const runtime = "nodejs";

export async function POST() {
  const auth = await assertWgeManage();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });

  const admin = createAdminClient();
  const { error } = await admin.from("wge_config").upsert(
    {
      singleton: true,
      system_prompt: DEFAULT_WGE_CONFIG.system_prompt,
      prompt_template: DEFAULT_WGE_CONFIG.prompt_template,
      variables: DEFAULT_WGE_CONFIG.variables,
      settings: DEFAULT_WGE_CONFIG.settings,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    },
    { onConflict: "singleton" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck & commit**

Run: `npx tsc --noEmit` → no new errors.
```bash
git add app/api/ai-tools/wge/route.ts app/api/ai-tools/wge/reset/route.ts
git commit -m "feat(wge): config API (GET/PUT/reset)"
```

---

## Task 10: WGE Control UI + page + nav

**Files:**
- Create: `components/ai-tools/wge/WgeControl.tsx`, `app/(app)/ai-tools/wge/page.tsx`
- Modify: `components/layout/Sidebar.tsx`

- [ ] **Step 1: Build the page (server guard + load config + leads for test-render)** `app/(app)/ai-tools/wge/page.tsx`

```typescript
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getWgeConfig } from "@/lib/ai-tools/wge";
import { WgeControl } from "@/components/ai-tools/wge/WgeControl";

export default async function WgePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  const hasAiTools = perms.has("ai_tools.webcraft") || perms.has("ai_tools.deepseek");
  if (!perms.has("wge.manage") || !hasAiTools) redirect("/ai-tools");

  const config = await getWgeConfig();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, business_name")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  return <WgeControl initialConfig={config} leads={leads ?? []} />;
}
```

- [ ] **Step 2: Build the control component** `components/ai-tools/wge/WgeControl.tsx`

```typescript
"use client";

import { useState } from "react";
import type { WgeConfig, WgeVariable } from "@/lib/ai-tools/wge-types";
import { TOOLS, TOOL_IDS } from "@/lib/ai-tools/config";
import { listTemplateVars } from "@/lib/ai-tools/template";
import { buildPrompt } from "@/lib/ai-tools/prompt";
import { mapLeadToInput } from "@/lib/ai-tools/leadPrefill";
import { EMPTY_INPUT, type GenInput } from "@/lib/ai-tools/prompt";

type Lead = { id: string; business_name: string };
type Tab = "prompt" | "variables" | "settings";
const DERIVED = ["references", "ref_count", "experience", "page_names"];
const inputCls = "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";

export function WgeControl({ initialConfig, leads }: { initialConfig: WgeConfig; leads: Lead[] }) {
  const [tab, setTab] = useState<Tab>("prompt");
  const [cfg, setCfg] = useState<WgeConfig>(initialConfig);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testLead, setTestLead] = useState<string>(leads[0]?.id ?? "");
  const [testOut, setTestOut] = useState<string>("");

  const definedKeys = new Set([...cfg.variables.map((v) => v.key), ...DERIVED]);
  const usedVars = listTemplateVars(cfg.prompt_template);
  const unmapped = usedVars.filter((k) => !definedKeys.has(k));

  async function save() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/ai-tools/wge", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: (await res.json().catch(() => ({}))).error ?? "Save failed" }); return; }
    setMsg({ ok: true, text: "Saved — affects all future generations." });
  }

  async function reset() {
    if (!confirm("Reset the WGE config to built-in defaults? This overwrites your prompt and mappings.")) return;
    setBusy(true); setMsg(null);
    const res = await fetch("/api/ai-tools/wge/reset", { method: "POST" });
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: "Reset failed" }); return; }
    location.reload();
  }

  async function runTest() {
    const lead = leads.find((l) => l.id === testLead);
    if (!lead) return;
    const res = await fetch(`/api/ai-tools/prefill?lead=${testLead}`);
    const prefill = res.ok ? (await res.json()).fields : {};
    const values: GenInput = { ...EMPTY_INPUT, ...prefill };
    setTestOut(`SYSTEM:\n${cfg.system_prompt}\n\n---- USER ----\n${buildPrompt(values, cfg.prompt_template)}`);
  }

  const updateVar = (i: number, patch: Partial<WgeVariable>) =>
    setCfg((c) => ({ ...c, variables: c.variables.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text">Website Engine (WGE) Control</h1>
          <p className="text-sm text-text-muted mt-0.5">Edit the prompt, field mapping, and engine settings used by every generation.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} disabled={busy} className="text-sm px-3 py-2 rounded-md border border-border text-text-muted hover:bg-surface-2">Reset to defaults</button>
          <button onClick={save} disabled={busy} className="text-sm px-4 py-2 rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>

      {msg && <div className={"mb-4 text-sm rounded-md px-3 py-2 " + (msg.ok ? "bg-ready-bg text-ready-fg" : "bg-dropped-bg text-dropped-fg")}>{msg.text}</div>}

      <div className="flex gap-1 mb-4">
        {(["prompt", "variables", "settings"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={"text-sm px-3 py-1.5 rounded-md font-medium " + (tab === t ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")}>
            {t === "prompt" ? "Prompt Studio" : t === "variables" ? "Variables & Mapping" : "Engine Settings"}
          </button>
        ))}
      </div>

      {tab === "prompt" && (
        <div className="space-y-5">
          <Card title="System prompt">
            <textarea value={cfg.system_prompt} onChange={(e) => setCfg((c) => ({ ...c, system_prompt: e.target.value }))} rows={5} className={inputCls + " font-mono text-xs"} />
          </Card>
          <Card title="Prompt template">
            <div className="flex flex-wrap gap-1 mb-2">
              {[...cfg.variables.map((v) => v.key), ...DERIVED].map((k) => (
                <span key={k} className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-2 border border-border text-text-muted">{`{{${k}}}`}</span>
              ))}
            </div>
            {unmapped.length > 0 && (
              <div className="mb-2 text-xs text-notready-fg bg-notready-bg rounded px-2 py-1">Template uses undefined variables: {unmapped.join(", ")}</div>
            )}
            <textarea value={cfg.prompt_template} onChange={(e) => setCfg((c) => ({ ...c, prompt_template: e.target.value }))} rows={20} className={inputCls + " font-mono text-xs leading-relaxed"} />
          </Card>
          <Card title="Test render">
            <div className="flex gap-2 mb-3">
              <select value={testLead} onChange={(e) => setTestLead(e.target.value)} className={inputCls + " max-w-sm"}>
                {leads.map((l) => <option key={l.id} value={l.id}>{l.business_name}</option>)}
              </select>
              <button onClick={runTest} className="text-sm px-3 py-2 rounded-md border border-border text-text hover:bg-surface-2 whitespace-nowrap">Render with this lead</button>
            </div>
            {testOut && <pre className="w-full max-h-[50vh] overflow-auto bg-[#0f1117] text-[#cdd3de] text-xs font-mono p-4 rounded-lg whitespace-pre-wrap">{testOut}</pre>}
          </Card>
        </div>
      )}

      {tab === "variables" && (
        <Card title="Variables & lead mapping">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-text-faint">
                <th className="py-2 pr-3">Key</th><th className="pr-3">Label</th><th className="pr-3">Type</th><th className="pr-3">Fallback</th><th className="pr-3">Lead column</th><th className="pr-3">Join</th>
              </tr></thead>
              <tbody>
                {cfg.variables.map((v, i) => (
                  <tr key={i} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-3 font-mono text-xs">{v.key}</td>
                    <td className="pr-3"><input value={v.label} onChange={(e) => updateVar(i, { label: e.target.value })} className={inputCls} /></td>
                    <td className="pr-3">
                      <select value={v.type} onChange={(e) => updateVar(i, { type: e.target.value as WgeVariable["type"] })} className={inputCls}>
                        {["text", "textarea", "number", "list"].map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="pr-3"><input value={v.fallback} onChange={(e) => updateVar(i, { fallback: e.target.value })} className={inputCls} /></td>
                    <td className="pr-3"><input value={v.lead_column ?? ""} placeholder="(none)" onChange={(e) => updateVar(i, { lead_column: e.target.value.trim() || null })} className={inputCls + " font-mono text-xs"} /></td>
                    <td className="pr-3"><input value={v.join === "\n" ? "\\n" : v.join} onChange={(e) => updateVar(i, { join: e.target.value === "\\n" ? "\n" : e.target.value })} className={inputCls + " w-16"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-text-faint mt-3">Keys are fixed identifiers used in the template (`{`{{key}}`}`). Edit labels, fallbacks, and which lead column each maps from.</p>
        </Card>
      )}

      {tab === "settings" && (
        <div className="space-y-5">
          <Card title="Generator defaults">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Labeled label="Default pages"><input type="number" value={cfg.settings.default_pages} onChange={(e) => setCfg((c) => ({ ...c, settings: { ...c.settings, default_pages: Number(e.target.value) } }))} className={inputCls} /></Labeled>
              <Labeled label="Max output tokens"><input type="number" value={cfg.settings.max_tokens} onChange={(e) => setCfg((c) => ({ ...c, settings: { ...c.settings, max_tokens: Number(e.target.value) } }))} className={inputCls} /></Labeled>
              <Labeled label={`Temperature: ${cfg.settings.temperature.toFixed(2)}`}><input type="range" min={0} max={1.5} step={0.05} value={cfg.settings.temperature} onChange={(e) => setCfg((c) => ({ ...c, settings: { ...c.settings, temperature: Number(e.target.value) } }))} className="w-full accent-accent" /></Labeled>
              <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={cfg.settings.auto_download} onChange={(e) => setCfg((c) => ({ ...c, settings: { ...c.settings, auto_download: e.target.checked } }))} /> Auto-download ZIP after a generation</label>
            </div>
          </Card>
          <Card title="Automation — used by WGE-2 (not active yet)">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 opacity-90">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.settings.auto_generate} onChange={(e) => setCfg((c) => ({ ...c, settings: { ...c.settings, auto_generate: e.target.checked } }))} /> Auto-generate when a lead is submitted</label>
              <Labeled label="Auto engine">
                <select value={cfg.settings.auto_engine ? `${cfg.settings.auto_engine.provider}:${cfg.settings.auto_engine.model}` : ""} onChange={(e) => {
                  const v = e.target.value;
                  setCfg((c) => ({ ...c, settings: { ...c.settings, auto_engine: v ? { provider: v.split(":")[0] as (typeof TOOL_IDS)[number], model: v.split(":").slice(1).join(":") } : null } }));
                }} className={inputCls}>
                  <option value="">(set later)</option>
                  {TOOL_IDS.flatMap((id) => TOOLS[id].models.map((m) => <option key={`${id}:${m}`} value={`${id}:${m}`}>{TOOLS[id].label} — {m}</option>))}
                </select>
              </Labeled>
              <Labeled label="Required fields before auto-queue">
                <div className="flex flex-wrap gap-1">
                  {cfg.variables.map((v) => {
                    const on = cfg.settings.ready_required.includes(v.key);
                    return (
                      <button key={v.key} type="button" onClick={() => setCfg((c) => ({ ...c, settings: { ...c.settings, ready_required: on ? c.settings.ready_required.filter((k) => k !== v.key) : [...c.settings.ready_required, v.key] } }))} className={"text-xs px-2 py-1 rounded-md border " + (on ? "bg-accent-soft text-accent-ink border-accent" : "border-border text-text-muted")}>{v.key}</button>
                    );
                  })}
                </div>
              </Labeled>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-surface border border-border rounded-lg p-5"><div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-4">{title}</div>{children}</div>;
}
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium text-text-muted mb-1">{label}</label>{children}</div>;
}
```

- [ ] **Step 3: Add the nav entry with the dependency rule** in `components/layout/Sidebar.tsx`. Add a WGE item to the `AI_TOOLS` array:
```typescript
  { href: "/ai-tools/wge", label: "Engine (WGE)", perms: ["wge.manage"] },
```
Then change the AI-tools visibility filter so the WGE item additionally requires an AI-tools permission. Replace the `aiVisible` line:
```typescript
  const hasAiTools = hasAny(["ai_tools.webcraft", "ai_tools.deepseek"]);
  const aiVisible = AI_TOOLS
    .filter((n) => hasAny(n.perms) && (n.href !== "/ai-tools/wge" || hasAiTools))
    .map((n) => ({ href: n.href, label: n.label, perm: n.perms[0] }));
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles; `/ai-tools/wge` appears in the route list.

- [ ] **Step 5: Commit**

```bash
git add components/ai-tools/wge/WgeControl.tsx "app/(app)/ai-tools/wge/page.tsx" components/layout/Sidebar.tsx
git commit -m "feat(wge): control panel UI (prompt/variables/settings) + nav"
```

---

## Task 11: Generator reads from config

**Files:**
- Modify: `components/ai-tools/Generator.tsx`, `app/(app)/ai-tools/webcraft/page.tsx`, `app/(app)/ai-tools/deepseek/page.tsx`

- [ ] **Step 1: Pass config into the generator pages.** In BOTH `webcraft/page.tsx` and `deepseek/page.tsx`: import `getWgeConfig`, call it, pass `variables` to `mapLeadToInput`, and pass `config` to `<Generator>`.

```typescript
// add import
import { getWgeConfig } from "@/lib/ai-tools/wge";

// after the perms check:
const config = await getWgeConfig();

// change the prefill mapping call:
prefill = mapLeadToInput(data, config.variables);

// change the render (webcraft shown; deepseek identical with tool="deepseek"):
return <Generator tool="webcraft" prefill={prefill} leadId={leadId} config={config} />;
```

- [ ] **Step 2: Update `Generator.tsx` props and field rendering.** Change the component to accept `config` and render fields from `config.variables`, build the prompt from `config.prompt_template`, and seed settings/auto-download from `config.settings`.

Replace the top imports + `Field`/`FIELDS` definitions:
```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TOOLS, type ToolId } from "@/lib/ai-tools/config";
import { buildPrompt, EMPTY_INPUT, type GenInput } from "@/lib/ai-tools/prompt";
import type { WgeConfig, WgeVariable } from "@/lib/ai-tools/wge-types";
import { parseFiles, type GeneratedFile } from "@/lib/ai-tools/parse";
import { makeZip } from "@/lib/ai-tools/zip";
import { PreviewPane } from "./PreviewPane";

const inputCls =
  "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";
const estTokens = (s: string) => Math.ceil(s.length / 4);
```
(Delete the old `type Field`, the `FIELDS` array, and the standalone `renderField` helper — replaced below.)

Change the signature and initial state:
```typescript
export function Generator({
  tool,
  prefill,
  leadId,
  config,
}: {
  tool: ToolId;
  prefill?: Partial<GenInput>;
  leadId?: string;
  config: WgeConfig;
}) {
  const cfg = TOOLS[tool];
  const s = config.settings;

  const [step, setStep] = useState(1);
  const [input, setInput] = useState<GenInput>({ ...EMPTY_INPUT, pages: String(s.default_pages), ...prefill });
  const [prompt, setPrompt] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);

  const [model, setModel] = useState(cfg.defaultModel);
  const [maxTokens, setMaxTokens] = useState(Math.min(s.max_tokens, cfg.maxOutputTokens));
  const [temperature, setTemperature] = useState(s.temperature);
  // ... (rest of the state unchanged: generating, streamText, files, tokens, error, save, refs)
```

Change `rebuildPrompt` and the step-2 effect to pass the template:
```typescript
  const rebuildPrompt = useCallback(() => {
    setPrompt(buildPrompt(input, config.prompt_template));
    setPromptDirty(false);
  }, [input, config.prompt_template]);

  useEffect(() => {
    if (step === 2 && !promptDirty && !prompt) setPrompt(buildPrompt(input, config.prompt_template));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
```

After a successful run, honor auto-download — at the end of `generate()`'s success path, after `await persist(...)`:
```typescript
      if (s.auto_download) downloadZip(parsed);
```
And make `downloadZip` accept files (so it can be called before `files` state settles):
```typescript
  function downloadZip(list: GeneratedFile[] = files) {
    if (!list.length) return;
    const blob = makeZip(list);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug = (input.name || "website").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    a.href = url;
    a.download = `${slug || "website"}_site.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }
```
(Update the Step-3 "Download ZIP" button to call `downloadZip()` with no args — unchanged signature works.)

Replace the Step-1 form body (the three `<Card>`s using `FIELDS`) with config-driven rendering:
```typescript
      {step === 1 && (
        <div className="space-y-5">
          <Card title="Website details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
              {config.variables.map((v) => (
                <VarField key={v.key} v={v} value={input[v.key as keyof GenInput] ?? ""} onChange={(val) => setInput((p) => ({ ...p, [v.key]: val }))} />
              ))}
            </div>
          </Card>
          <div className="flex justify-end gap-2">
            <button onClick={() => { rebuildPrompt(); setStep(2); }} className="text-sm px-4 py-2 rounded-md bg-accent text-white font-semibold hover:bg-accent-ink">Build prompt →</button>
          </div>
        </div>
      )}
```

Add the `VarField` helper (replaces `renderField`):
```typescript
function VarField({ v, value, onChange }: { v: WgeVariable; value: string; onChange: (val: string) => void }) {
  const full = v.type === "textarea";
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="block text-xs font-medium text-text-muted mb-1">{v.label}</label>
      {v.type === "textarea" ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={inputCls + " font-mono text-xs"} />
      ) : (
        <input type={v.type === "number" ? "number" : "text"} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      )}
    </div>
  );
}
```
> `GenInput` keys are a fixed set; the default variables match them. If a future admin adds a variable whose `key` is not on `GenInput`, the form still stores it (state is a superset) and the template can use it — TypeScript indexing is handled by the `keyof GenInput` cast with `?? ""`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles cleanly.

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: all tests pass (existing + new wge tests).

- [ ] **Step 5: Commit**

```bash
git add components/ai-tools/Generator.tsx "app/(app)/ai-tools/webcraft/page.tsx" "app/(app)/ai-tools/deepseek/page.tsx"
git commit -m "feat(wge): generator renders fields & prompt from config; honors settings + auto-download"
```

---

## Task 12: Live verification (Chrome MCP)

**Files:** none (manual verification per the project's "click-test the running UI" lesson).

- [ ] **Step 1** Confirm dev server is up (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login` → 200) or start it (`npm run dev`).
- [ ] **Step 2** As admin, open `/ai-tools/wge`. Verify three tabs render and the prompt template shows `{{placeholders}}` (not `${...}`).
- [ ] **Step 3** Prompt Studio → pick a lead → "Render with this lead" → confirm the assembled prompt substitutes the lead's values and shows the system prompt.
- [ ] **Step 4** Edit the template (e.g. add a line `BRAND NOTE: {{name}} — premium tone.`), Save, then open the DeepSeek generator, Build prompt, and confirm the new line appears in the prompt with the business name substituted.
- [ ] **Step 5** Reset to defaults → confirm the template returns to the original.
- [ ] **Step 6** Verify the dependency rule: as a user with `ai_tools.deepseek` but NOT `wge.manage`, `/ai-tools/wge` is hidden in the nav and redirects to `/ai-tools` when visited directly. (Use an existing non-admin demo user or a temporary override.)
- [ ] **Step 7** Confirm a normal DeepSeek generation still works end-to-end (stream → preview → saved to history) — i.e. the refactor didn't regress Phase 4.

---

## Self-Review Notes (addressed)

- **Spec coverage:** prompt editing (Tasks 3,4,10), field mapping (Tasks 3,5,10), engine settings + auto-download (Tasks 1,10,11), `wge.manage` dependent permission + 3-layer enforcement (Tasks 7,8,9,10), template engine + fallback + derived vars (Tasks 2,4), `/ai-tools/wge` UI (Task 10), generator refactor (Task 11), parity (Task 4 tests), error handling (loader fallback Task 8; 422 on save Task 9), tests (Tasks 2,4,5,6), live test (Task 12). WGE-2 items intentionally absent.
- **Coherence change** (vs spec §4): `settings` drops standalone `provider`/`model`; the interactive generator keeps per-tool `TOOLS[tool]` defaults, and `auto_engine` is the configurable headless engine for WGE-2. Documented in the header note.
- **Type consistency:** `WgeConfig`/`WgeVariable`/`WgeSettings` (Task 1) are used identically across Tasks 3–11; `buildPrompt(values, template?)`, `mapLeadToInput(lead, variables?)`, `getWgeConfig()`, `assertWgeManage()` signatures match every call site.
```
