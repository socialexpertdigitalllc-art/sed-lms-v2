# Long Term Status, Category Permissions & Form Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "Long Term" lead status, per-category view/set permissions enforced in RLS + API + UI, and rebuild the New Lead / New Pre-Lead forms to match the old LMS forms' structure and dynamics in the v2 design language.

**Architecture:** Category permissions are ordinary RBAC keys (`leads.cat_view.<slug>` / `leads.cat_set.<slug>`) resolved by the existing 3-layer resolver and enforced at the database (RLS select policy via `has_permission()`), the API (status-set checks), and the UI (tabs/dropdowns/KPIs render only permitted categories). Forms are rebuilt as controlled-useState components on top of new shared primitives in `components/forms/`, with pure unit-tested validator/payload modules mirroring the old forms' exact rules.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, Supabase (Postgres RLS), Vitest.

**Repo:** `D:\sed-lms-v2` (work here; the old app at `D:\Old LMS Dashboard\sed-lms` is read-only reference). Spec: `docs/superpowers/specs/2026-07-07-longterm-category-perms-form-parity-design.md`.

**Conventions:** run tests with `npx vitest run tests/<file> --reporter=basic`; full suite `npx vitest run --reporter=basic`; build check `npm run build`. npm/npx on this machine is slow to start — be patient. Commit after every task.

---

### Task 1: "Long Term" status + analytics + dashboard visuals

**Files:**
- Modify: `lib/leads/types.ts:1-20`
- Modify: `lib/leads/analytics.ts` (Kpis interface, computeKpis, byStatus)
- Modify: `components/dashboard/StatusStrip.tsx`
- Modify: `components/dashboard/KpiHero.tsx` (no Long Term change needed — verify only)
- Modify: `components/dashboard/Charts.tsx:23-28`
- Test: `tests/analytics.test.ts`, `tests/importMap.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/analytics.test.ts` (inside the existing top-level describe or as a new describe; follow the file's existing helper style for building leads — read the file first and reuse its lead factory if one exists):

```ts
describe("Long Term status", () => {
  it("computeKpis counts Long Term leads", () => {
    const leads = [
      { status: "Long Term", created_at: "2026-01-01" },
      { status: "Long Term", created_at: "2026-01-01" },
      { status: "Ready", created_at: "2026-01-01" },
    ] as never[];
    const k = computeKpis(leads);
    expect(k.longTerm).toBe(2);
    expect(k.ready).toBe(1);
  });

  it("byStatus includes Long Term in order after Dropped", () => {
    const leads = [
      { status: "Long Term" },
      { status: "Ready" },
    ] as never[];
    expect(byStatus(leads)).toEqual([
      { name: "Ready", value: 1 },
      { name: "Long Term", value: 1 },
    ]);
  });
});
```

Append to `tests/importMap.test.ts` (reuse the file's existing mapping-test pattern — it already tests status coercion; add):

```ts
it("keeps Long Term as a valid status", () => {
  // build a raw row the same way the file's other status tests do,
  // with the status cell set to "Long Term"
  // expect mapped lead.status === "Long Term" (NOT "Not Ready")
});
```

(Write the real assertion using the same helper the neighboring status test uses — the only change is the input value `"Long Term"`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/analytics.test.ts tests/importMap.test.ts --reporter=basic`
Expected: FAIL — `longTerm` undefined; byStatus missing "Long Term"; importMap coerces to "Not Ready".

- [ ] **Step 3: Implement**

`lib/leads/types.ts` — change lines 1 and 15-20:

```ts
export const LEAD_STATUSES = ["Ready", "Not Ready", "Closed", "Dropped", "Long Term"] as const;
```

```ts
export const STATUS_PILL: Record<string, string> = {
  Ready: "bg-ready-bg text-ready-fg",
  "Not Ready": "bg-notready-bg text-notready-fg",
  Closed: "bg-closed-bg text-closed-fg",
  Dropped: "bg-dropped-bg text-dropped-fg",
  "Long Term": "bg-longterm-bg text-longterm-fg",
};
```

`lib/leads/analytics.ts`:
- `Kpis` interface: add `longTerm: number;` after `dropped: number;`
- `computeKpis`: counts object → `{ Ready: 0, "Not Ready": 0, Closed: 0, Dropped: 0, "Long Term": 0 }`; return object → add `longTerm: counts["Long Term"],`
- `byStatus`: `const order = ["Ready", "Not Ready", "Closed", "Dropped", "Long Term"];`

`components/dashboard/StatusStrip.tsx` — add to `items` after Dropped:

```ts
{ label: "Long Term", count: kpis.longTerm, bar: "bg-longterm-fg", text: "text-longterm-fg" },
```

and change the wrapper grid so 5 items fit (replace `grid-cols-2 sm:grid-cols-4` with an auto-fit style):

```tsx
<div
  className="bg-surface border border-border rounded-lg p-4 grid gap-5"
  style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
>
```

`components/dashboard/Charts.tsx` — `STATUS_COLORS` add:

```ts
"Long Term": "#1D4ED8",
```

(`STATUS_LEGEND` at line 154 derives automatically. The donut's `<Cell fill={STATUS_COLORS[d.name] ?? TEAL}>` picks it up. `KpiHero` needs no change.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/analytics.test.ts tests/importMap.test.ts tests/leadSchema.test.ts --reporter=basic`
Expected: PASS (leadSchema tests confirm the enum still parses; if any snapshot-style test asserts the exact status list, update it to include "Long Term").

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Long Term lead status across types, analytics, dashboard"
```

---

### Task 2: Category permission helpers (`lib/leads/categories.ts`)

**Files:**
- Create: `lib/leads/categories.ts`
- Test: `tests/categories.test.ts`

- [ ] **Step 1: Write failing test** — create `tests/categories.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  statusSlug,
  catViewKey,
  catSetKey,
  visibleStatuses,
  settableStatuses,
} from "@/lib/leads/categories";

describe("category permission helpers", () => {
  it("slugs statuses (lowercase, spaces to underscores)", () => {
    expect(statusSlug("Ready")).toBe("ready");
    expect(statusSlug("Not Ready")).toBe("not_ready");
    expect(statusSlug("Long Term")).toBe("long_term");
  });

  it("builds permission keys", () => {
    expect(catViewKey("Not Ready")).toBe("leads.cat_view.not_ready");
    expect(catSetKey("Long Term")).toBe("leads.cat_set.long_term");
  });

  it("filters visible statuses by cat_view keys", () => {
    const perms = new Set(["leads.cat_view.ready", "leads.cat_view.long_term"]);
    expect(visibleStatuses(perms)).toEqual(["Ready", "Long Term"]);
  });

  it("filters settable statuses by cat_set keys", () => {
    const perms = new Set(["leads.cat_set.closed"]);
    expect(settableStatuses(perms)).toEqual(["Closed"]);
    expect(settableStatuses(new Set())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/categories.test.ts --reporter=basic` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `lib/leads/categories.ts`:

```ts
import { LEAD_STATUSES, type LeadStatus } from "./types";

export const CAT_VIEW_PREFIX = "leads.cat_view.";
export const CAT_SET_PREFIX = "leads.cat_set.";

/** "Not Ready" -> "not_ready" — must match the SQL in migration 0011. */
export function statusSlug(status: string): string {
  return status.toLowerCase().replace(/ /g, "_");
}

export function catViewKey(status: string): string {
  return CAT_VIEW_PREFIX + statusSlug(status);
}

export function catSetKey(status: string): string {
  return CAT_SET_PREFIX + statusSlug(status);
}

/** Lead categories the user may see, in canonical order. */
export function visibleStatuses(perms: Set<string>): LeadStatus[] {
  return LEAD_STATUSES.filter((s) => perms.has(catViewKey(s)));
}

/** Lead categories the user may set a lead to, in canonical order. */
export function settableStatuses(perms: Set<string>): LeadStatus[] {
  return LEAD_STATUSES.filter((s) => perms.has(catSetKey(s)));
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/categories.test.ts --reporter=basic` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: category permission key helpers"
```

---

### Task 3: Migration 0011 — permissions, seeds, RLS

**Files:**
- Create: `supabase/migrations/0011_category_permissions.sql`

- [ ] **Step 1: Write the migration** — create `supabase/migrations/0011_category_permissions.sql`:

```sql
-- Per-category lead permissions: which categories a user can VIEW and which
-- they can SET a lead to. Slug = lower(replace(status,' ','_')).

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('leads.cat_view.ready','View Ready Leads','Can see leads in the Ready category','leads',false),
  ('leads.cat_view.not_ready','View Not Ready Leads','Can see leads in the Not Ready category','leads',false),
  ('leads.cat_view.closed','View Closed Leads','Can see leads in the Closed category','leads',false),
  ('leads.cat_view.dropped','View Dropped Leads','Can see leads in the Dropped category','leads',false),
  ('leads.cat_view.long_term','View Long Term Leads','Can see leads in the Long Term category','leads',false),
  ('leads.cat_set.ready','Set Lead to Ready','Can set a lead''s status to Ready','leads',false),
  ('leads.cat_set.not_ready','Set Lead to Not Ready','Can set a lead''s status to Not Ready','leads',false),
  ('leads.cat_set.closed','Set Lead to Closed','Can set a lead''s status to Closed','leads',false),
  ('leads.cat_set.dropped','Set Lead to Dropped','Can set a lead''s status to Dropped','leads',false),
  ('leads.cat_set.long_term','Set Lead to Long Term','Can set a lead''s status to Long Term','leads',false)
on conflict (key) do nothing;

-- Zero-disruption seeding:
-- every dept that can view leads keeps seeing every category…
insert into public.department_permissions (department_id, permission_key)
select d.department_id, v.key
from (select distinct department_id from public.department_permissions
      where permission_key = 'leads.view') d
cross join (values
  ('leads.cat_view.ready'),('leads.cat_view.not_ready'),('leads.cat_view.closed'),
  ('leads.cat_view.dropped'),('leads.cat_view.long_term')) v(key)
on conflict do nothing;

-- …and every dept that can change status OR create leads keeps every set-target.
-- (Creating a lead requires cat_set for its initial status; sales has
-- leads.create without leads.status_change.)
insert into public.department_permissions (department_id, permission_key)
select d.department_id, v.key
from (select distinct department_id from public.department_permissions
      where permission_key in ('leads.status_change','leads.create')) d
cross join (values
  ('leads.cat_set.ready'),('leads.cat_set.not_ready'),('leads.cat_set.closed'),
  ('leads.cat_set.dropped'),('leads.cat_set.long_term')) v(key)
on conflict do nothing;

-- Category visibility enforced at the database. A row is visible only if the
-- user could already see it (view_all or own) AND may view its category.
drop policy if exists "read leads scoped" on public.leads;
create policy "read leads scoped" on public.leads for select to authenticated
  using (
    (public.has_permission('leads.view_all') or agent_id = auth.uid())
    and public.has_permission('leads.cat_view.' || lower(replace(status, ' ', '_')))
  );
```

- [ ] **Step 2: Apply to the live project** — use the Supabase MCP `apply_migration` tool against project `ikuvbxjkoojtgekapbul` with name `category_permissions` and the SQL above. (Main-session step — subagents may not have MCP access; if running as a subagent, stop and report so the orchestrator applies it.)

- [ ] **Step 3: Verify** — via MCP `execute_sql`:

```sql
select count(*) from public.permissions where key like 'leads.cat_%';           -- expect 10
select permission_key, count(*) from public.department_permissions
 where permission_key like 'leads.cat_%' group by 1 order by 1;                 -- each key seeded to >=1 dept
select polname from pg_policies where tablename = 'leads';                      -- "read leads scoped" present
```

Also confirm the admin user still sees all leads (the app must behave identically post-migration).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: migration 0011 - per-category lead permissions + RLS"
```

---

### Task 4: "Set" enforcement — API + status dropdowns

**Files:**
- Modify: `app/api/leads/route.ts:37-48` (POST)
- Modify: `app/api/leads/[id]/route.ts:25-37` (PATCH)
- Modify: `components/leads/StatusChangeModal.tsx`
- Modify: `components/leads/LeadDetail.tsx:200` (status select in inline edit)
- Test: `tests/categories.test.ts` (already covers helpers; API checks verified live + by suite)

- [ ] **Step 1: API POST check** — in `app/api/leads/route.ts`, add import `import { catSetKey } from "@/lib/leads/categories";` and after the `parsed.success` guard (line ~48) insert:

```ts
if (!perms.has(catSetKey(parsed.data.status))) {
  return NextResponse.json(
    { error: `You are not allowed to create a lead with status "${parsed.data.status}"` },
    { status: 403 }
  );
}
```

- [ ] **Step 2: API PATCH check** — in `app/api/leads/[id]/route.ts`, add the same import, and after the `parsed.success` guard (line ~37) insert:

```ts
if (parsed.data.status !== undefined && !perms.has(catSetKey(parsed.data.status))) {
  return NextResponse.json(
    { error: `You are not allowed to set status "${parsed.data.status}"` },
    { status: 403 }
  );
}
```

- [ ] **Step 3: StatusChangeModal** — filter buttons to settable statuses. Replace the `LEAD_STATUSES` import with:

```ts
import { settableStatuses } from "@/lib/leads/categories";
import { usePermissions } from "@/hooks/usePermissions";
```

Inside the component add `const { all } = usePermissions();` and `const options = settableStatuses(all);`, replace `{LEAD_STATUSES.map((s) => (` with `{options.map((s) => (`, and after the grid add an empty-state:

```tsx
{options.length === 0 && (
  <p className="text-sm text-text-muted">No categories available to you.</p>
)}
```

- [ ] **Step 4: LeadDetail status select** — same pattern: import `settableStatuses` + `usePermissions` (LeadDetail is already a client component), compute `const settable = settableStatuses(all);` and render options as:

```tsx
{(settable.includes(lead.status as never) ? settable : [lead.status, ...settable]).map((s) => (
  <option key={s} value={s}>{s}</option>
))}
```

(The current status stays selectable so opening the editor doesn't silently change it; read the surrounding code and keep its exact editing flow.)

- [ ] **Step 5: Run suite + build** — `npx vitest run --reporter=basic` → all pass; `npm run build` → green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: enforce cat_set permissions in leads API and status dropdowns"
```

---

### Task 5: "View" chrome — tabs, KPI strip, donut legend

**Files:**
- Modify: `components/leads/LeadsTable.tsx:72-77` (statusCounts) and `:226` (tabs)
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `components/dashboard/StatusStrip.tsx`
- Modify: `components/dashboard/KpiHero.tsx`

- [ ] **Step 1: LeadsTable tabs** — import `visibleStatuses` from `@/lib/leads/categories`. The component already calls `usePermissions()` (line 32) — destructure `all` too: `const { has, all } = usePermissions();` then `const visible = visibleStatuses(all);`. Replace `LEAD_STATUSES` with `visible` in both the `statusCounts` memo (line 74, add `visible` to the dep array) and the tabs render (line 226): `{["All", ...visible].map((tab) => (`.

- [ ] **Step 2: StatusStrip accepts a filter** — change the signature to:

```tsx
export function StatusStrip({ kpis, statuses }: { kpis: Kpis; statuses?: string[] }) {
```

and filter the items list before rendering:

```ts
const items = allItems.filter((i) => !statuses || statuses.includes(i.label));
```

(`allItems` is the existing 5-entry array from Task 1.) If `items.length === 0`, return `null`.

- [ ] **Step 3: KpiHero hides the Ready card when Ready is hidden** — signature:

```tsx
export function KpiHero({ kpis, showReady = true }: { kpis: Kpis; showReady?: boolean }) {
```

and after building `cards`: `const shown = cards.filter((c) => c.label !== "Ready" || showReady);` — render `shown`. Keep the wrapper as `grid grid-cols-2 lg:grid-cols-4` (3 cards in a 4-col grid is fine).

- [ ] **Step 4: Dashboard page** — after fetching leads, resolve the viewer's permissions and pass filters:

```ts
import { getUserPermissions } from "@/lib/permissions/resolver";
import { visibleStatuses } from "@/lib/leads/categories";
```

```ts
const { data: { user } } = await supabase.auth.getUser();
const perms = user ? await getUserPermissions(user.id) : new Set<string>();
const visible: string[] = visibleStatuses(perms);
```

```tsx
<KpiHero kpis={kpis} showReady={visible.includes("Ready")} />
<StatusStrip kpis={kpis} statuses={visible} />
```

and filter the donut legend:

```tsx
<Legend items={STATUS_LEGEND.filter((i) => visible.includes(i.name))} />
```

(The donut data itself is already RLS-filtered — hidden categories have zero rows.)

- [ ] **Step 5: Run suite + build** — `npx vitest run --reporter=basic` and `npm run build` → green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: hide non-permitted lead categories from tabs and dashboard chrome"
```

---

### Task 6: Shared form primitives (`components/forms/`) + phone util

**Files:**
- Create: `lib/forms/phone.ts`
- Create: `components/forms/RadioPillGroup.tsx`
- Create: `components/forms/ChipGroup.tsx`
- Create: `components/forms/DynamicList.tsx`
- Create: `components/forms/ConditionalBlock.tsx`
- Create: `components/forms/RatingGroup.tsx`
- Create: `components/forms/Field.tsx`
- Test: `tests/phone.test.ts`

- [ ] **Step 1: Failing test** — create `tests/phone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatPhone, PHONE_RE } from "@/lib/forms/phone";

describe("formatPhone", () => {
  it("masks progressively", () => {
    expect(formatPhone("2")).toBe("(2");
    expect(formatPhone("252401")).toBe("(252) 401");
    expect(formatPhone("2524012775")).toBe("(252) 401-2775");
  });
  it("strips non-digits and caps at 10", () => {
    expect(formatPhone("(252) 401-2775 ext 9")).toBe("(252) 401-2775");
    expect(formatPhone("abc")).toBe("");
  });
  it("PHONE_RE matches the exact format", () => {
    expect(PHONE_RE.test("(252) 401-2775")).toBe(true);
    expect(PHONE_RE.test("252-401-2775")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run tests/phone.test.ts --reporter=basic` → FAIL.

- [ ] **Step 3: Implement `lib/forms/phone.ts`** (identical behavior to the old form's mask):

```ts
/** Progressive US phone mask: 2524012775 -> "(252) 401-2775". */
export function formatPhone(raw: string): string {
  const v = raw.replace(/\D/g, "").slice(0, 10);
  let f = "";
  if (v.length > 0) f = "(" + v.slice(0, 3);
  if (v.length >= 4) f += ") " + v.slice(3, 6);
  if (v.length >= 7) f += "-" + v.slice(6, 10);
  return f;
}

export const PHONE_RE = /^\(\d{3}\) \d{3}-\d{4}$/;
```

- [ ] **Step 4: Run** — PASS. Then create the components:

`components/forms/Field.tsx`:

```tsx
export function Field({
  label,
  required,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-text-muted mb-1">
        {label}
        {required && <span className="text-dropped-fg"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[11px] text-text-faint mt-1">{hint}</p>}
      {error && <p className="text-[11px] text-dropped-fg mt-1">⚠ {error}</p>}
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-5 first:pt-0">
      <div className="text-sm font-semibold text-text border-b border-border pb-2 mb-4">{title}</div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

/** Standard input class, matching existing forms. */
export const inputCls =
  "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";
```

`components/forms/RadioPillGroup.tsx`:

```tsx
"use client";

export function RadioPillGroup({
  options,
  value,
  onChange,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={
            "px-3.5 py-1.5 text-sm rounded-full border transition-colors " +
            (value === o
              ? "border-accent bg-accent-soft text-accent-ink font-medium"
              : "border-border text-text-muted hover:bg-surface-2")
          }
        >
          {o}
        </button>
      ))}
    </div>
  );
}
```

`components/forms/ChipGroup.tsx`:

```tsx
"use client";

export function ChipGroup({
  options,
  selected,
  onToggle,
  locked = [],
  disabled = [],
  counter,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (v: string) => void;
  /** Always-on chips the user cannot toggle (shown "(Required)"). */
  locked?: string[];
  /** Chips that cannot be selected right now. */
  disabled?: string[];
  counter?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((o) => {
        const isOn = selected.includes(o);
        const isLocked = locked.includes(o);
        const isDisabled = disabled.includes(o);
        return (
          <button
            key={o}
            type="button"
            disabled={isLocked || isDisabled}
            onClick={() => onToggle(o)}
            className={
              "px-3 py-1.5 text-sm rounded-md border transition-colors " +
              (isOn
                ? "border-accent bg-accent-soft text-accent-ink font-medium"
                : "border-border text-text-muted hover:bg-surface-2") +
              (isDisabled ? " opacity-40 cursor-not-allowed" : "") +
              (isLocked ? " opacity-80 cursor-default" : "")
            }
          >
            {o}
            {isLocked && isOn ? " (Required)" : ""}
          </button>
        );
      })}
      {counter && <span className="text-xs font-mono text-text-faint ml-1">{counter}</span>}
    </div>
  );
}
```

`components/forms/DynamicList.tsx`:

```tsx
"use client";

import { inputCls } from "./Field";

export function DynamicList({
  values,
  onChange,
  placeholder,
  addLabel,
  inputType = "text",
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  addLabel: string;
  inputType?: string;
}) {
  const setAt = (i: number, v: string) => onChange(values.map((x, j) => (j === i ? v : x)));
  const removeAt = (i: number) => onChange(values.filter((_, j) => j !== i));
  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type={inputType}
            value={v}
            onChange={(e) => setAt(i, e.target.value)}
            placeholder={placeholder}
            className={"flex-1 " + inputCls}
          />
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="text-xs text-text-muted border border-border rounded-md px-2.5 py-2 hover:bg-dropped-bg hover:text-dropped-fg whitespace-nowrap"
          >
            ✕ Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, ""])}
        className="text-sm text-accent-ink font-medium border border-dashed border-accent rounded-md px-3 py-1.5 hover:bg-accent-soft"
      >
        + {addLabel}
      </button>
    </div>
  );
}
```

`components/forms/ConditionalBlock.tsx`:

```tsx
"use client";

export function ConditionalBlock({
  open,
  label,
  children,
}: {
  open: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="mt-3 border-l-2 border-accent bg-surface-2 rounded-r-md p-3">
      {label && (
        <div className="text-[11px] font-semibold uppercase tracking-wide text-accent-ink mb-2">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}
```

`components/forms/RatingGroup.tsx`:

```tsx
"use client";

export function RatingGroup({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={
            "w-9 h-9 rounded-md border text-sm font-mono transition-colors " +
            (n === value
              ? "border-accent bg-accent text-white font-semibold"
              : n < value
                ? "border-accent bg-accent-soft text-accent-ink"
                : "border-border text-text-muted hover:bg-surface-2")
          }
        >
          {n}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Build check** — `npm run build` → green (components are unused so far; tree-shaken but type-checked).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: shared form primitives (pills, chips, dynamic list, rating, phone mask)"
```

---

### Task 7: New Lead form logic module (validator + payload, TDD)

**Files:**
- Create: `lib/leads/newLeadForm.ts`
- Test: `tests/newLeadForm.test.ts`

Behavior mirrors `D:\Old LMS Dashboard\sed-lms\public\upfront-form.html` exactly, including the weighted page counter (Individual Service Pages counts as #services, Individual Service Area Pages as #areas), auto-forced Contact Us, and the ISAP-disabled-when-no-service-areas rule. `num_webpages` is **derived** from the chips (the old form auto-filled the field from the same calculation), so the rebuilt form shows the computed total instead of a manual input. Note: the old form marks "Direct Line saved?" with * but never validates it — we faithfully keep it optional.

- [ ] **Step 1: Failing tests** — create `tests/newLeadForm.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  pageTotal,
  nonEmpty,
  validateNewLead,
  buildLeadPayload,
  emptyNewLead,
  type NewLeadFormState,
} from "@/lib/leads/newLeadForm";

function validState(): NewLeadFormState {
  return {
    ...emptyNewLead("Not Ready"),
    site_type: "Custom Website",
    business_name: "Acme Plumbing",
    business_phone: "(252) 401-2775",
    business_email: "acme@example.com",
    platform: "Google",
    business_profile_link: "https://maps.google.com/acme",
    has_service_areas: "No",
    services: ["Plumbing"],
    client_experience: "5",
    specify_pages: ["Home", "About Us", "Contact Us"],
    color_scheme: "#0D9488, #FFFFFF",
    follow_up_time: "2027-01-01T10:00",
    price_quoted: "500",
    comments: "Solid lead",
    rating: 8,
    fresh_or_followup: "Fresh",
  };
}

describe("pageTotal (weighted, as in the old form)", () => {
  it("counts plain pages as 1", () => {
    expect(pageTotal(["Home", "About Us"], 3, 2)).toBe(2);
  });
  it("Individual Service Pages counts as max(services,1)", () => {
    expect(pageTotal(["Home", "Individual Service Pages"], 3, 0)).toBe(4);
    expect(pageTotal(["Individual Service Pages"], 0, 0)).toBe(1);
  });
  it("Individual Service Area Pages counts as areas (0 allowed)", () => {
    expect(pageTotal(["Individual Service Area Pages"], 1, 2)).toBe(2);
    expect(pageTotal(["Individual Service Area Pages"], 1, 0)).toBe(0);
  });
});

describe("validateNewLead", () => {
  const now = new Date("2026-07-07T00:00:00");

  it("passes a fully valid state", () => {
    expect(validateNewLead(validState(), now)).toEqual({});
  });

  it("requires phone in exact format", () => {
    const e = validateNewLead({ ...validState(), business_phone: "2524012775" }, now);
    expect(e.business_phone).toBeTruthy();
  });

  it("requires other platform name when platform is Other", () => {
    const e = validateNewLead({ ...validState(), platform: "Other", other_platform: "" }, now);
    expect(e.other_platform).toBeTruthy();
  });

  it("requires at least one area when service areas is Yes", () => {
    const e = validateNewLead(
      { ...validState(), has_service_areas: "Yes", areas: ["  "] },
      now
    );
    expect(e.areas).toBeTruthy();
  });

  it("requires future follow-up time", () => {
    const e = validateNewLead({ ...validState(), follow_up_time: "2025-01-01T10:00" }, now);
    expect(e.follow_up_time).toBeTruthy();
  });

  it("requires custom price when price is Other", () => {
    const e = validateNewLead({ ...validState(), price_quoted: "Other", price_custom: "" }, now);
    expect(e.price_custom).toBeTruthy();
  });

  it("requires https reference link for Redesign", () => {
    const e = validateNewLead(
      { ...validState(), site_type: "Redesign", reference_link: "not-a-url" },
      now
    );
    expect(e.reference_link).toBeTruthy();
  });

  it("requires rating and comments and fresh/follow-up", () => {
    const e = validateNewLead(
      { ...validState(), rating: 0, comments: " ", fresh_or_followup: "" },
      now
    );
    expect(e.rating).toBeTruthy();
    expect(e.comments).toBeTruthy();
    expect(e.fresh_or_followup).toBeTruthy();
  });
});

describe("buildLeadPayload", () => {
  it("maps platform Other to the custom name and derives num_webpages", () => {
    const p = buildLeadPayload({
      ...validState(),
      platform: "Other",
      other_platform: "Facebook",
      specify_pages: ["Home", "Individual Service Pages", "Contact Us"],
      services: ["A", "B"],
    });
    expect(p.platform).toBe("Facebook");
    expect(p.num_webpages).toBe(4); // Home 1 + ISP 2 + Contact 1
    expect(p.status).toBe("Not Ready");
  });

  it("uses custom price when Other, yearly defaults to None", () => {
    const p = buildLeadPayload({
      ...validState(),
      price_quoted: "Other",
      price_custom: "1200",
      yearly_price: "",
    });
    expect(p.price_quoted).toBe(1200);
    expect(p.yearly_price).toBe("None");
  });

  it("replaces the Other page chip with its custom label and nulls reference when not Redesign", () => {
    const p = buildLeadPayload({
      ...validState(),
      specify_pages: ["Home", "Other", "Contact Us"],
      other_page: "FAQ",
      reference_link: "https://x.com",
    });
    expect(p.specify_pages).toContain("FAQ");
    expect(p.reference_link).toBeNull();
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run tests/newLeadForm.test.ts --reporter=basic` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `lib/leads/newLeadForm.ts`:

```ts
import { PHONE_RE } from "@/lib/forms/phone";

export const PAGE_OPTIONS = [
  "Home",
  "About Us",
  "Services",
  "Service Areas",
  "Gallery",
  "Contact Us",
  "Individual Service Pages",
  "Individual Service Area Pages",
  "Pricing",
  "Other",
] as const;

export const PLATFORM_OPTIONS = ["Google", "Yelp", "Other"] as const;
export const PRICE_OPTIONS = ["250", "500", "750", "Other"] as const;
export const YEARLY_OPTIONS = ["100", "50", "Other", "None"] as const;

export interface NewLeadFormState {
  status: string;
  agent_id: string;
  site_type: string;
  business_name: string;
  business_phone: string;
  business_email: string;
  platform: string;
  other_platform: string;
  business_profile_link: string;
  map_embed_link: string;
  has_service_areas: "" | "Yes" | "No";
  areas: string[];
  services: string[];
  client_experience: string;
  specify_pages: string[];
  other_page: string;
  color_scheme: string;
  logo_link: string;
  image_links: string[];
  follow_up_time: string;
  price_quoted: string;
  price_custom: string;
  yearly_price: string;
  yearly_custom: string;
  direct_line_saved: "" | "Yes" | "No";
  reference_link: string;
  comments: string;
  rating: number;
  fresh_or_followup: string;
}

export function emptyNewLead(status: string): NewLeadFormState {
  return {
    status,
    agent_id: "",
    site_type: "",
    business_name: "",
    business_phone: "",
    business_email: "",
    platform: "",
    other_platform: "",
    business_profile_link: "",
    map_embed_link: "",
    has_service_areas: "",
    areas: [],
    services: [""],
    client_experience: "",
    specify_pages: ["Home"],
    other_page: "",
    color_scheme: "",
    logo_link: "",
    image_links: [""],
    follow_up_time: "",
    price_quoted: "",
    price_custom: "",
    yearly_price: "",
    yearly_custom: "",
    direct_line_saved: "",
    reference_link: "",
    comments: "",
    rating: 0,
    fresh_or_followup: "",
  };
}

export function nonEmpty(list: string[]): string[] {
  return list.map((s) => s.trim()).filter(Boolean);
}

/**
 * Weighted page count, exactly as the old upfront form:
 * "Individual Service Pages" counts as the number of services (min 1),
 * "Individual Service Area Pages" as the number of areas (0 allowed),
 * every other selected chip counts as 1.
 */
export function pageTotal(selected: string[], serviceCount: number, areaCount: number): number {
  let total = 0;
  for (const p of selected) {
    if (p === "Individual Service Pages") total += Math.max(serviceCount, 1);
    else if (p === "Individual Service Area Pages") total += areaCount;
    else total += 1;
  }
  return total;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field-keyed error messages, mirroring the old form's validateForm(). */
export function validateNewLead(
  f: NewLeadFormState,
  now: Date = new Date()
): Record<string, string> {
  const e: Record<string, string> = {};

  if (!f.status) e.status = "No category available to you.";
  if (!f.site_type) e.site_type = "Please select a site type.";
  if (!f.business_name.trim()) e.business_name = "Business name is required.";
  if (!PHONE_RE.test(f.business_phone.trim()))
    e.business_phone = "Enter a valid phone: (252) 401-2775";
  if (!EMAIL_RE.test(f.business_email.trim())) e.business_email = "Enter a valid email address.";
  if (!f.platform) e.platform = "Please select a platform.";
  if (!f.business_profile_link.trim()) e.business_profile_link = "Profile link is required.";
  if (f.platform === "Other" && !f.other_platform.trim())
    e.other_platform = "Platform name is required when selecting Other.";
  if (!f.has_service_areas) e.has_service_areas = "Please indicate if there are service areas.";
  if (f.has_service_areas === "Yes" && nonEmpty(f.areas).length === 0)
    e.areas = "At least one area is required.";
  if (nonEmpty(f.services).length === 0) e.services = "At least one service is required.";

  const exp = parseInt(f.client_experience, 10);
  if (f.client_experience === "" || Number.isNaN(exp) || exp < 0)
    e.client_experience = "Please enter a valid number of years.";

  const total = pageTotal(
    f.specify_pages,
    nonEmpty(f.services).length,
    f.has_service_areas === "Yes" ? nonEmpty(f.areas).length : 0
  );
  if (total < 1) e.specify_pages = "Select at least one page.";

  if (!f.color_scheme.trim()) e.color_scheme = "Color scheme is required.";
  if (!f.follow_up_time || new Date(f.follow_up_time) <= now)
    e.follow_up_time = "Follow up time must be in the future.";
  if (!f.price_quoted) e.price_quoted = "Please select a price.";
  if (f.price_quoted === "Other" && (f.price_custom === "" || Number(f.price_custom) < 0))
    e.price_custom = "Enter a valid custom price.";
  if (f.site_type === "Redesign" && !/^https?:\/\/.+/.test(f.reference_link.trim()))
    e.reference_link = "A valid reference site URL is required for redesigns.";
  if (!f.comments.trim()) e.comments = "Please enter comments about the client.";
  if (f.rating === 0) e.rating = "Please rate the lead.";
  if (!f.fresh_or_followup) e.fresh_or_followup = "Please select Fresh or Follow Up.";

  return e;
}

/** Map the form state to the POST /api/leads body (createLeadSchema shape). */
export function buildLeadPayload(f: NewLeadFormState) {
  const services = nonEmpty(f.services);
  const areas = f.has_service_areas === "Yes" ? nonEmpty(f.areas) : [];
  const pages = f.specify_pages.map((p) => (p === "Other" ? f.other_page.trim() || "Other" : p));
  const total = pageTotal(f.specify_pages, services.length, areas.length);
  const images = nonEmpty(f.image_links);

  return {
    business_name: f.business_name.trim(),
    status: f.status,
    agent_id: f.agent_id || null,
    site_type: f.site_type || null,
    business_phone: f.business_phone.trim() || null,
    business_email: f.business_email.trim() || null,
    business_profile_link: f.business_profile_link.trim() || null,
    platform: f.platform === "Other" ? f.other_platform.trim() || null : f.platform || null,
    map_embed_link: f.map_embed_link.trim() || null,
    has_service_areas: f.has_service_areas === "" ? null : f.has_service_areas === "Yes",
    service_areas: areas.length ? areas : null,
    services: services.length ? services : null,
    client_experience: f.client_experience === "" ? null : parseInt(f.client_experience, 10),
    num_webpages: total || null,
    specify_pages: pages.length ? pages : null,
    color_scheme: f.color_scheme.trim() || null,
    logo_link: f.logo_link.trim() || null,
    image_links: images.length ? images : null,
    follow_up_time: f.follow_up_time ? new Date(f.follow_up_time).toISOString() : null,
    price_quoted:
      f.price_quoted === ""
        ? null
        : f.price_quoted === "Other"
          ? Number(f.price_custom)
          : Number(f.price_quoted),
    yearly_price:
      f.yearly_price === ""
        ? "None"
        : f.yearly_price === "Other"
          ? f.yearly_custom.trim() || "None"
          : f.yearly_price,
    direct_line_saved: f.direct_line_saved === "" ? null : f.direct_line_saved === "Yes",
    reference_link: f.site_type === "Redesign" ? f.reference_link.trim() || null : null,
    rating: f.rating || null,
    fresh_or_followup: f.fresh_or_followup || null,
    comments: f.comments.trim() || null,
  };
}
```

- [ ] **Step 4: Run** — `npx vitest run tests/newLeadForm.test.ts --reporter=basic` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: new-lead form logic (weighted pages, old-form validation, payload)"
```

---

### Task 8: Rebuild `NewLeadForm.tsx` (old upfront-form structure)

**Files:**
- Rewrite: `components/leads/NewLeadForm.tsx`

Interactive dynamics to preserve (from the old form's JS):
- Contact Us is auto-forced (checked + locked) whenever any chip besides Home/Contact Us is selected; unchecked automatically when none are.
- "Individual Service Area Pages" chip is disabled (and deselected) while Service Areas ≠ Yes.
- Selecting Service Areas = Yes seeds the areas list with one empty row if empty.
- Pages counter shows the weighted total: `N page(s) total` (or `0 / — selected` when 0).
- Phone input applies `formatPhone` on change.
- Errors clear per-field as the user edits; on submit, scroll the first error into view.

- [ ] **Step 1: Rewrite the component** — replace the whole file with:

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SITE_TYPES } from "@/lib/leads/types";
import { settableStatuses } from "@/lib/leads/categories";
import { usePermissions } from "@/hooks/usePermissions";
import { formatPhone } from "@/lib/forms/phone";
import {
  PAGE_OPTIONS,
  PLATFORM_OPTIONS,
  PRICE_OPTIONS,
  YEARLY_OPTIONS,
  emptyNewLead,
  nonEmpty,
  pageTotal,
  validateNewLead,
  buildLeadPayload,
  type NewLeadFormState,
} from "@/lib/leads/newLeadForm";
import { Field, FormSection, inputCls } from "@/components/forms/Field";
import { RadioPillGroup } from "@/components/forms/RadioPillGroup";
import { ChipGroup } from "@/components/forms/ChipGroup";
import { DynamicList } from "@/components/forms/DynamicList";
import { ConditionalBlock } from "@/components/forms/ConditionalBlock";
import { RatingGroup } from "@/components/forms/RatingGroup";

type Agent = { id: string; display_name: string | null };

export function NewLeadForm({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  const { all } = usePermissions();
  const settable = settableStatuses(all);

  const [f, setF] = useState<NewLeadFormState>(() =>
    emptyNewLead(settable.includes("Not Ready") ? "Not Ready" : (settable[0] ?? ""))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  /** Set one field and clear its error. */
  function set<K extends keyof NewLeadFormState>(k: K, v: NewLeadFormState[K]) {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((p) => {
      if (!(k in p)) return p;
      const n = { ...p };
      delete n[k as string];
      return n;
    });
  }

  const serviceCount = nonEmpty(f.services).length;
  const areaCount = f.has_service_areas === "Yes" ? nonEmpty(f.areas).length : 0;
  const total = useMemo(
    () => pageTotal(f.specify_pages, serviceCount, areaCount),
    [f.specify_pages, serviceCount, areaCount]
  );

  // Contact Us is forced whenever anything besides Home/Contact Us is selected.
  const contactForced = f.specify_pages.some((p) => p !== "Home" && p !== "Contact Us");
  const isapDisabled = f.has_service_areas !== "Yes";

  function togglePage(p: string) {
    setErrors((prev) => {
      const n = { ...prev };
      delete n.specify_pages;
      return n;
    });
    setF((prev) => {
      let next = prev.specify_pages.includes(p)
        ? prev.specify_pages.filter((x) => x !== p)
        : [...prev.specify_pages, p];
      // dynamics from the old form
      const forced = next.some((x) => x !== "Home" && x !== "Contact Us");
      if (forced && !next.includes("Contact Us")) next = [...next, "Contact Us"];
      if (!forced) next = next.filter((x) => x !== "Contact Us");
      return { ...prev, specify_pages: next, other_page: next.includes("Other") ? prev.other_page : "" };
    });
  }

  function setServiceAreas(v: string) {
    const yes = v === "Yes";
    setF((prev) => ({
      ...prev,
      has_service_areas: v as "Yes" | "No",
      areas: yes && nonEmpty(prev.areas).length === 0 ? [""] : yes ? prev.areas : [],
      // deselect ISAP when service areas are turned off
      specify_pages: yes
        ? prev.specify_pages
        : prev.specify_pages.filter((p) => p !== "Individual Service Area Pages"),
    }));
    setErrors((p) => {
      const n = { ...p };
      delete n.has_service_areas;
      delete n.areas;
      return n;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateNewLead(f);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      document.querySelector("[data-error='true']")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    setApiError(null);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildLeadPayload(f)),
    });
    setBusy(false);
    if (!res.ok) {
      setApiError((await res.json().catch(() => ({}))).error ?? "Failed to create lead");
      return;
    }
    const { id } = await res.json();
    router.push(`/leads/${id}`);
    router.refresh();
  }

  /** Wrapper that flags a field for scroll-to-first-error. */
  const F = ({ k, ...props }: { k: string } & React.ComponentProps<typeof Field>) => (
    <div data-error={errors[k] ? "true" : undefined}>
      <Field {...props} error={errors[k]} />
    </div>
  );

  return (
    <div className="max-w-3xl">
      <Link href="/leads" className="text-xs text-text-muted hover:text-text">← Leads</Link>
      <h1 className="text-xl font-semibold text-text mt-2 mb-5">New lead</h1>

      {apiError && (
        <div className="mb-4 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{apiError}</div>
      )}

      <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-5 divide-y divide-border">
        {/* ⓪ Assignment (v2-specific) */}
        <FormSection title="Assignment">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="status" label="Status" required>
              <select value={f.status} onChange={(e) => set("status", e.target.value)} className={inputCls}>
                {settable.length === 0 && <option value="">No categories available to you</option>}
                {settable.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </F>
            <F k="agent_id" label="Agent">
              <select value={f.agent_id} onChange={(e) => set("agent_id", e.target.value)} className={inputCls}>
                <option value="">Unassigned</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.display_name ?? a.id}</option>)}
              </select>
            </F>
          </div>
        </FormSection>

        {/* ① Client Identity */}
        <FormSection title="Client Identity">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="site_type" label="Site Type" required>
              <RadioPillGroup options={SITE_TYPES} value={f.site_type} onChange={(v) => set("site_type", v)} />
            </F>
            <F k="business_name" label="Business Name" required>
              <input value={f.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="Enter business name" className={inputCls} autoFocus />
            </F>
            <F k="business_phone" label="Phone Number" required hint="Format: (252) 401-2775">
              <input type="tel" value={f.business_phone} onChange={(e) => set("business_phone", formatPhone(e.target.value))} placeholder="(252) 401-2775" maxLength={14} className={inputCls} />
            </F>
            <F k="business_email" label="Email Address" required>
              <input type="email" value={f.business_email} onChange={(e) => set("business_email", e.target.value)} placeholder="example@email.com" className={inputCls} />
            </F>
          </div>
          <F k="platform" label="Platform" required>
            <RadioPillGroup options={PLATFORM_OPTIONS} value={f.platform} onChange={(v) => set("platform", v)} />
            <div className="mt-3" data-error={errors.business_profile_link ? "true" : undefined}>
              <input value={f.business_profile_link} onChange={(e) => set("business_profile_link", e.target.value)} placeholder="Enter profile link" className={inputCls} />
              {errors.business_profile_link && (
                <p className="text-[11px] text-dropped-fg mt-1">⚠ {errors.business_profile_link}</p>
              )}
            </div>
            <ConditionalBlock open={f.platform === "Other"} label="Other Platform">
              <div data-error={errors.other_platform ? "true" : undefined}>
                <input value={f.other_platform} onChange={(e) => set("other_platform", e.target.value)} placeholder="e.g., Facebook, Instagram, LinkedIn" className={inputCls} />
                {errors.other_platform && (
                  <p className="text-[11px] text-dropped-fg mt-1">⚠ {errors.other_platform}</p>
                )}
              </div>
            </ConditionalBlock>
          </F>
        </FormSection>

        {/* ② Location & Services */}
        <FormSection title="Location & Services">
          <F k="map_embed_link" label="Map Embed Link">
            <textarea value={f.map_embed_link} onChange={(e) => set("map_embed_link", e.target.value)} placeholder="Paste your map embed link or iframe code here" rows={2} className={inputCls} />
          </F>
          <F k="has_service_areas" label="Service Areas" required>
            <RadioPillGroup options={["Yes", "No"]} value={f.has_service_areas} onChange={setServiceAreas} />
            <ConditionalBlock open={f.has_service_areas === "Yes"} label="Areas">
              <div data-error={errors.areas ? "true" : undefined}>
                <DynamicList values={f.areas} onChange={(v) => set("areas", v)} placeholder="Enter service area" addLabel="Add Area" />
                {errors.areas && <p className="text-[11px] text-dropped-fg mt-1">⚠ {errors.areas}</p>}
              </div>
            </ConditionalBlock>
          </F>
          <F k="services" label="Services" required>
            <DynamicList values={f.services} onChange={(v) => set("services", v)} placeholder="Enter service" addLabel="Add Service" />
          </F>
        </FormSection>

        {/* ③ Website Details */}
        <FormSection title="Website Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="client_experience" label="Client's Experience (Years)" required>
              <input type="number" min={0} value={f.client_experience} onChange={(e) => set("client_experience", e.target.value)} placeholder="e.g., 5" className={inputCls} />
            </F>
            <Field label="No. of Webpages (auto)" hint="Derived from the selected pages below.">
              <div className={inputCls + " bg-surface-2 font-mono"}>{total || "—"}</div>
            </Field>
          </div>
          <F k="specify_pages" label="Specify Webpages" required hint={total > 0 ? `Total webpages: ${total}.` : "Selections determine the total number of webpages."}>
            <ChipGroup
              options={PAGE_OPTIONS}
              selected={f.specify_pages}
              onToggle={togglePage}
              locked={contactForced ? ["Home", "Contact Us"] : ["Home"]}
              disabled={isapDisabled ? ["Individual Service Area Pages"] : []}
              counter={total > 0 ? `${total} page(s) total` : "0 / — selected"}
            />
            <ConditionalBlock open={f.specify_pages.includes("Other")}>
              <input value={f.other_page} onChange={(e) => set("other_page", e.target.value)} placeholder="Specify other page name" className={inputCls} />
            </ConditionalBlock>
          </F>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="color_scheme" label="Color Scheme" required>
              <input value={f.color_scheme} onChange={(e) => set("color_scheme", e.target.value)} placeholder="e.g., #1A73E8, #FFFFFF, #000000" className={inputCls} />
            </F>
            <F k="logo_link" label="Logo Link">
              <input type="url" value={f.logo_link} onChange={(e) => set("logo_link", e.target.value)} placeholder="https://example.com/logo.png" className={inputCls} />
            </F>
          </div>
          <F k="image_links" label="Image Links">
            <DynamicList values={f.image_links} onChange={(v) => set("image_links", v)} placeholder="https://example.com/image.jpg" addLabel="Add Image Link" inputType="url" />
          </F>
        </FormSection>

        {/* ④ Pricing & Follow Up */}
        <FormSection title="Pricing & Follow Up">
          <F k="follow_up_time" label="Follow Up Time" required>
            <input type="datetime-local" value={f.follow_up_time} onChange={(e) => set("follow_up_time", e.target.value)} className={inputCls} />
          </F>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="price_quoted" label="Price Quoted" required>
              <RadioPillGroup
                options={PRICE_OPTIONS}
                value={f.price_quoted}
                onChange={(v) => set("price_quoted", v)}
              />
              <ConditionalBlock open={f.price_quoted === "Other"}>
                <div className="relative" data-error={errors.price_custom ? "true" : undefined}>
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">$</span>
                  <input type="number" min={0} value={f.price_custom} onChange={(e) => set("price_custom", e.target.value)} placeholder="Enter custom price" className={inputCls + " pl-7"} />
                </div>
                {errors.price_custom && <p className="text-[11px] text-dropped-fg mt-1">⚠ {errors.price_custom}</p>}
              </ConditionalBlock>
            </F>
            <F k="yearly_price" label="Yearly Price">
              <RadioPillGroup
                options={YEARLY_OPTIONS}
                value={f.yearly_price}
                onChange={(v) => set("yearly_price", v)}
              />
              <ConditionalBlock open={f.yearly_price === "Other"}>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">$</span>
                  <input type="number" min={0} value={f.yearly_custom} onChange={(e) => set("yearly_custom", e.target.value)} placeholder="Enter yearly price" className={inputCls + " pl-7"} />
                </div>
              </ConditionalBlock>
            </F>
          </div>
          <F k="direct_line_saved" label="Direct Line saved?">
            <RadioPillGroup options={["Yes", "No"]} value={f.direct_line_saved} onChange={(v) => set("direct_line_saved", v as "Yes" | "No")} />
          </F>
          <ConditionalBlock open={f.site_type === "Redesign"} label="Reference Site (Redesign only)">
            <div data-error={errors.reference_link ? "true" : undefined}>
              <input type="url" value={f.reference_link} onChange={(e) => set("reference_link", e.target.value)} placeholder="https://referencesite.com" className={inputCls} />
              {errors.reference_link && <p className="text-[11px] text-dropped-fg mt-1">⚠ {errors.reference_link}</p>}
            </div>
          </ConditionalBlock>
        </FormSection>

        {/* ⑤ Final Assessment */}
        <FormSection title="Final Assessment">
          <F k="comments" label="Specific Comments on Client" required>
            <textarea value={f.comments} onChange={(e) => set("comments", e.target.value)} placeholder="Enter detailed comments about the client..." rows={4} className={inputCls} />
          </F>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="rating" label="Give Lead a Rating (1–10)" required>
              <RatingGroup value={f.rating} onChange={(v) => set("rating", v)} />
            </F>
            <F k="fresh_or_followup" label="Fresh or Follow Up?" required>
              <RadioPillGroup options={["Fresh", "Follow Up"]} value={f.fresh_or_followup} onChange={(v) => set("fresh_or_followup", v)} />
            </F>
          </div>
        </FormSection>

        <div className="flex justify-end gap-2 pt-5">
          <Link href="/leads" className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2">Cancel</Link>
          <button disabled={busy || settable.length === 0} className="px-5 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60">
            {busy ? "Submitting…" : "Submit Lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

Note: `FormSection` children sit inside a `divide-y` form — check the rendered spacing and adjust (`FormSection` already pads with `pt-5 first:pt-0`; the form's `p-5` stays).

- [ ] **Step 2: Suite + build** — `npx vitest run --reporter=basic` and `npm run build` → green.

- [ ] **Step 3: Smoke-check in the browser** (dev server on :3000, log in as admin `admin` / `SedAdmin#2026`): `/leads/new` renders 6 sections; phone masks as you type; selecting About Us forces Contact Us; ISAP disabled until Service Areas=Yes; Redesign shows the reference block; Other price shows the $ input; rating highlights; submitting empty shows errors and scrolls to the first.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: rebuild New Lead form with old upfront-form structure and dynamics"
```

---

### Task 9: Pre-lead form logic + rebuild `AddPreLeadForm.tsx`

**Files:**
- Create: `lib/preleads/newPreLeadForm.ts`
- Rewrite: `components/preleads/AddPreLeadForm.tsx`
- Test: `tests/newPreLeadForm.test.ts`

Parity notes (old `prelead-dashboard.html` form `#leadForm`): three sections; Service Type is required **only when Service Offered = Website**; phone required + masked; email optional-but-validated; profile link required; follow-up required; category required. The old form has no status field (new pre-leads start as "Next follow up") — the rebuilt form drops the status select and sends the default.

- [ ] **Step 1: Failing tests** — create `tests/newPreLeadForm.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validatePreLead, buildPreLeadPayload, emptyPreLead } from "@/lib/preleads/newPreLeadForm";

function valid() {
  return {
    ...emptyPreLead(),
    service_offered: "SEO",
    business_name: "Acme",
    phone_number: "(252) 401-2775",
    google_yelp_link: "https://maps.google.com/acme",
    follow_up_time: "2027-01-01T10:00",
    lead_category: "Strong Lead",
  };
}

describe("validatePreLead", () => {
  it("passes a valid state", () => {
    expect(validatePreLead(valid())).toEqual({});
  });
  it("requires service_type only when Website", () => {
    expect(validatePreLead({ ...valid(), service_offered: "Website", service_type: "" }).service_type).toBeTruthy();
    expect(validatePreLead({ ...valid(), service_offered: "SEO", service_type: "" }).service_type).toBeUndefined();
  });
  it("requires exact phone format", () => {
    expect(validatePreLead({ ...valid(), phone_number: "123" }).phone_number).toBeTruthy();
  });
  it("validates email only when present", () => {
    expect(validatePreLead({ ...valid(), email: "bad" }).email).toBeTruthy();
    expect(validatePreLead({ ...valid(), email: "" }).email).toBeUndefined();
  });
  it("requires follow-up time and category and profile link", () => {
    const e = validatePreLead({ ...valid(), follow_up_time: "", lead_category: "", google_yelp_link: "" });
    expect(e.follow_up_time).toBeTruthy();
    expect(e.lead_category).toBeTruthy();
    expect(e.google_yelp_link).toBeTruthy();
  });
});

describe("buildPreLeadPayload", () => {
  it("splits comma lists, defaults status, nulls empties", () => {
    const p = buildPreLeadPayload({ ...valid(), services: "SEO, Ads,  ", areas: "Kinston, NC" });
    expect(p.status).toBe("Next follow up");
    expect(p.services).toEqual(["SEO", "Ads"]);
    expect(p.areas).toEqual(["Kinston", "NC"]);
    expect(p.email).toBeNull();
    expect(p.pricing).toBeNull();
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run tests/newPreLeadForm.test.ts --reporter=basic` → FAIL.

- [ ] **Step 3: Implement `lib/preleads/newPreLeadForm.ts`:**

```ts
import { PHONE_RE } from "@/lib/forms/phone";

export interface PreLeadFormState {
  service_offered: string;
  service_type: string;
  business_name: string;
  phone_number: string;
  email: string;
  owner_name: string;
  google_yelp_link: string;
  areas: string;
  services: string;
  pricing: string;
  follow_up_time: string;
  lead_category: string;
  comments: string;
}

export function emptyPreLead(): PreLeadFormState {
  return {
    service_offered: "",
    service_type: "",
    business_name: "",
    phone_number: "",
    email: "",
    owner_name: "",
    google_yelp_link: "",
    areas: "",
    services: "",
    pricing: "",
    follow_up_time: "",
    lead_category: "",
    comments: "",
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePreLead(f: PreLeadFormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.service_offered) e.service_offered = "Please select a service.";
  if (f.service_offered === "Website" && !f.service_type)
    e.service_type = "Service type is required for Website.";
  if (!f.business_name.trim()) e.business_name = "Business name is required.";
  if (!PHONE_RE.test(f.phone_number.trim())) e.phone_number = "Use format: (252) 401-2775";
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) e.email = "Enter a valid email address.";
  if (!f.google_yelp_link.trim()) e.google_yelp_link = "Profile link is required.";
  if (!f.follow_up_time) e.follow_up_time = "Follow-up date & time is required.";
  if (!f.lead_category) e.lead_category = "Please select a category.";
  return e;
}

const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function buildPreLeadPayload(f: PreLeadFormState) {
  return {
    business_name: f.business_name.trim(),
    lead_category: f.lead_category,
    status: "Next follow up",
    service_offered: f.service_offered || null,
    service_type: f.service_type || null,
    phone_number: f.phone_number.trim() || null,
    email: f.email.trim() || null,
    owner_name: f.owner_name.trim() || null,
    google_yelp_link: f.google_yelp_link.trim() || null,
    pricing: f.pricing.trim() === "" ? null : Number(f.pricing),
    areas: csv(f.areas),
    services: csv(f.services),
    follow_up_time: f.follow_up_time ? new Date(f.follow_up_time).toISOString() : null,
    comments: f.comments.trim() || null,
  };
}
```

- [ ] **Step 4: Run** — PASS. Then rewrite `components/preleads/AddPreLeadForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LEAD_CATEGORIES, SERVICE_OFFERED, SERVICE_TYPE } from "@/lib/preleads/types";
import { formatPhone } from "@/lib/forms/phone";
import {
  emptyPreLead,
  validatePreLead,
  buildPreLeadPayload,
  type PreLeadFormState,
} from "@/lib/preleads/newPreLeadForm";
import { Field, FormSection, inputCls } from "@/components/forms/Field";

export function AddPreLeadForm() {
  const router = useRouter();
  const [f, setF] = useState<PreLeadFormState>(emptyPreLead());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  function set<K extends keyof PreLeadFormState>(k: K, v: PreLeadFormState[K]) {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((p) => {
      if (!(k in p)) return p;
      const n = { ...p };
      delete n[k as string];
      return n;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validatePreLead(f);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      document.querySelector("[data-error='true']")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    setApiError(null);
    const res = await fetch("/api/pre-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPreLeadPayload(f)),
    });
    setBusy(false);
    if (!res.ok) {
      setApiError((await res.json().catch(() => ({}))).error ?? "Failed to create pre-lead");
      return;
    }
    router.push("/pre-leads/all");
    router.refresh();
  }

  const F = ({ k, ...props }: { k: string } & React.ComponentProps<typeof Field>) => (
    <div data-error={errors[k] ? "true" : undefined}>
      <Field {...props} error={errors[k]} />
    </div>
  );

  const websiteSelected = f.service_offered === "Website";

  return (
    <div className="max-w-3xl">
      <Link href="/pre-leads/all" className="text-xs text-text-muted hover:text-text">← Pre-Leads</Link>
      <h1 className="text-xl font-semibold text-text mt-2 mb-5">New pre-lead</h1>

      {apiError && (
        <div className="mb-4 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{apiError}</div>
      )}

      <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-5 divide-y divide-border">
        {/* ① Service Details */}
        <FormSection title="Service Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="service_offered" label="Service Offered" required>
              <select
                value={f.service_offered}
                onChange={(e) => {
                  set("service_offered", e.target.value);
                  setErrors((p) => {
                    const n = { ...p };
                    delete n.service_type;
                    return n;
                  });
                }}
                className={inputCls}
              >
                <option value="">Select Service</option>
                {SERVICE_OFFERED.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </F>
            <F k="service_type" label="Service Type" required={websiteSelected}>
              <select value={f.service_type} onChange={(e) => set("service_type", e.target.value)} className={inputCls}>
                <option value="">Select Type</option>
                {SERVICE_TYPE.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </F>
          </div>
        </FormSection>

        {/* ② Business Information */}
        <FormSection title="Business Information">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="business_name" label="Business Name" required>
              <input value={f.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="Legal business name" className={inputCls} autoFocus />
            </F>
            <F k="phone_number" label="Phone Number" required hint="Format: (252) 401-2775">
              <input type="tel" value={f.phone_number} onChange={(e) => set("phone_number", formatPhone(e.target.value))} placeholder="(252) 401-2775" maxLength={14} className={inputCls} />
            </F>
            <F k="email" label="Email Address">
              <input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="contact@business.com" className={inputCls} />
            </F>
            <F k="owner_name" label="Owner Name">
              <input value={f.owner_name} onChange={(e) => set("owner_name", e.target.value)} placeholder="Decision maker name" className={inputCls} />
            </F>
            <F k="google_yelp_link" label="Profile Link" required>
              <input type="url" value={f.google_yelp_link} onChange={(e) => set("google_yelp_link", e.target.value)} placeholder="Google Maps or Yelp profile URL" className={inputCls} />
            </F>
            <F k="areas" label="Areas">
              <input value={f.areas} onChange={(e) => set("areas", e.target.value)} placeholder="Primary service areas" className={inputCls} />
            </F>
          </div>
        </FormSection>

        {/* ③ Project Scope & Follow-up */}
        <FormSection title="Project Scope & Follow-up">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="services" label="Services (Comma-separated)">
              <input value={f.services} onChange={(e) => set("services", e.target.value)} placeholder="e.g., Social Media, SEO, Analytics" className={inputCls} />
            </F>
            <F k="pricing" label="Target Pricing ($)">
              <input type="number" min={0} step="0.01" value={f.pricing} onChange={(e) => set("pricing", e.target.value)} placeholder="Estimated value" className={inputCls} />
            </F>
            <F k="follow_up_time" label="Follow-up Date & Time" required>
              <input type="datetime-local" value={f.follow_up_time} onChange={(e) => set("follow_up_time", e.target.value)} className={inputCls} />
            </F>
            <F k="lead_category" label="Lead Category" required>
              <select value={f.lead_category} onChange={(e) => set("lead_category", e.target.value)} className={inputCls}>
                <option value="">Select Category</option>
                {LEAD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </F>
          </div>
          <F k="comments" label="Internal Comments / Notes">
            <textarea value={f.comments} onChange={(e) => set("comments", e.target.value)} placeholder="Add any relevant details or initial conversation notes..." rows={3} className={inputCls} />
          </F>
        </FormSection>

        <div className="pt-5">
          <button disabled={busy} className="w-full px-5 py-2.5 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60">
            {busy ? "Submitting…" : "Submit Pre-Lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Suite + build** — `npx vitest run --reporter=basic`, `npm run build` → green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: rebuild New Pre-Lead form with old prelead-dashboard structure"
```

---

### Task 10: Full verification (suite, build, live)

- [ ] **Step 1: Full suite + build** — `npx vitest run --reporter=basic` (expect all green, 95 pre-existing + new) and `npm run build`.

- [ ] **Step 2: Live verification via the Claude-in-Chrome MCP** (dev server on :3000; the Playwright/preview headless browsers do not work on this machine). Checklist:

1. **Long Term:** log in as admin → dashboard shows a Long Term entry in the status strip and donut legend; `/leads` shows a Long Term tab; change a demo lead's status to Long Term → blue pill everywhere.
2. **cat_view:** in Admin → Users, pick a demo agent (`@sed.demo`) and add a revoke override for `leads.cat_view.closed` (Admin → Users → overrides; the new keys appear in the `leads` category). Log in as that agent (or use the admin "reset password" to get access) → Closed tab gone, Closed rows absent (even their own), dashboard shows no Closed anywhere, CSV export contains no Closed rows.
3. **cat_set:** revoke `leads.cat_set.dropped` for the same agent → Dropped missing from the status-change modal and the new-lead status select; a direct `PATCH /api/leads/<id>` with `{"status":"Dropped"}` (fetch from the console) returns 403.
4. **Submit perms:** revoke `leads.create` → "+ New Lead" disappears and `/leads/new` redirects; same for `pre_leads.create` → "Add Pre-Lead" hidden, `/pre-leads/new` redirects.
5. **New Lead form:** fill end-to-end exercising every dynamic (Other platform, Yes→areas, ISP/ISAP weighting shown in the counter, Other price, Redesign reference, rating) → submits, lands on the detail page with all fields persisted.
6. **New Pre-Lead form:** Website→Service Type required, phone mask, submit → appears in the pre-leads table with category pill and "Next follow up" status.
7. **Importer:** `/admin/import` preview → rows with "Long Term" status map to "Long Term" (no longer coerced to "Not Ready").
8. Remove the test overrides afterward.

- [ ] **Step 3: Update memory + audit** — update `docs/AUDIT.md` "What we're onto" and the memory file per project convention (main session does this at the end).

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "chore: verification pass for Long Term status, category perms, form parity"
```

---

## Self-Review Notes

- **Spec coverage:** A → Task 1; B model/helpers → Task 2; B migration/RLS → Task 3; B set-enforcement → Task 4; B view-chrome → Task 5; C → verified already at all 3 layers (live re-check in Task 10.4); D shared primitives → Task 6; D1 → Tasks 7–8; D2 → Task 9; testing/live → Task 10.
- **Deviation from spec (intentional):** `num_webpages` is auto-derived (the old form auto-filled it from the weighted chip count and validation required equality — same net behavior, simpler UI). "Direct Line saved?" is optional (the old form labels it required but never validates it).
- **Types:** `visibleStatuses`/`settableStatuses` take `Set<string>` (matches `usePermissions().all` and `getUserPermissions()` return). `Kpis.longTerm` used by StatusStrip Task 1/5 consistently. `emptyNewLead(status)` seeded from `settableStatuses` in Task 8.
