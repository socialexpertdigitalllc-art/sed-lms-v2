# Payment Links Management System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A permission-gated `/payments` catalog of the accounts team's Stripe payment links — grouped by category, search + copy-first UI, manager CRUD — with a new Accounts department and a Stripe-ready schema (provider/external_id/currency) for future integration.

**Architecture:** One table (`payment_links`, RLS-read gated by `payments.view`), pure helpers (`groupLinks`, Zod schemas — TDD), guarded CRUD routes (service-role writes + activity_log), and a role-aware client board mirroring the /feedback viewer/manager split.

**Tech Stack:** Next.js 16 App Router + TS, Supabase (Postgres/RLS/service role), Zod, Vitest. Project `ikuvbxjkoojtgekapbul`. Migration written to `supabase/migrations/` AND applied to remote by the controller via Supabase MCP.

**Environment notes:**
- Windows; npm slow — targeted `npx vitest run <file>` + `npx tsc --noEmit`; `npm run build` at group ends.
- Guard pattern: `createClient()` + `getUser()` → 401; `getUserPermissions(user.id)` → `perms.has(...)` → 403; writes via `createAdminClient()`; `activity_log` shape `{ user_id, action, entity_type, entity_id, new_value }`.
- **Templates:** routes `app/api/admin/add-ons/route.ts` + `[id]/route.ts` (closest CRUD twin); role-aware page `app/(app)/feedback/page.tsx` + `components/feedback/FeedbackList.tsx`; modal `components/tickets/TicketModal.tsx`; pills `components/forms/RadioPillGroup.tsx`; `inputCls` from `components/forms/Field.tsx`; money formatting `lib/leads/format.ts`; sidebar `components/layout/Sidebar.tsx` (MAIN array; `perm` optional now).

---

## GROUP A — Foundations + pure logic

### Task 1: Migration 0022 — table, Accounts dept, permissions

**Files:** Create `supabase/migrations/0022_payment_links.sql`; modify `supabase/seed.sql`.

- [ ] **Step 1: Write the SQL**

```sql
-- 0022_payment_links.sql — payment link catalog + Accounts department + perms

create table if not exists public.payment_links (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'USD',
  category text not null default 'Website' check (category in ('Website','Yearly','Add-on','Other')),
  url text not null,
  notes text,
  provider text not null default 'stripe',
  external_id text,
  is_active boolean not null default true,
  sort int not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_links_cat_sort_idx on public.payment_links (category, sort, created_at);

alter table public.payment_links enable row level security;
create policy "read payment links" on public.payment_links for select to authenticated
  using (public.has_permission('payments.view'));
-- writes via service role only (guarded by payments.manage in the routes)

insert into public.departments (name, slug, description, color, icon)
values ('Accounts','accounts','Payments & billing','#CA8A04','wallet')
on conflict (slug) do nothing;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('payments.view','View Payment Links',null,'payments',false),
  ('payments.manage','Manage Payment Links',null,'payments',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('payments.view'),('payments.manage')) as k(key)
  where d.slug in ('accounts','admin')
on conflict do nothing;
```

- [ ] **Step 2: Mirror into `supabase/seed.sql`** — READ it first. Add: the Accounts department row to the departments `values` block (same tuple shape); the 2 permission rows to the permissions block; grant tuples `('accounts','payments.view'),('accounts','payments.manage'),('admin','payments.view'),('admin','payments.manage')` to the grant list (match the file's exact tuple pattern; note seed's admin cross-join also covers admin — include explicit tuples anyway per the file's precedent).

- [ ] **Step 3: Commit** (controller applies to remote)

```bash
git -C "D:/sed-lms-v2" add supabase/migrations/0022_payment_links.sql supabase/seed.sql
git -C "D:/sed-lms-v2" commit -m "feat: migration 0022 - payment_links, Accounts department, payments perms"
```

---

### Task 2: Types, constants, Zod + board helpers (TDD)

**Files:** Create `lib/payments/types.ts`, `lib/payments/schema.ts`, `lib/payments/board.ts`, `tests/paymentLinks.test.ts`; modify `lib/permissions/constants.ts`.

- [ ] **Step 1: `lib/payments/types.ts`**

```ts
export const PAYMENT_CATEGORIES = ["Website", "Yearly", "Add-on", "Other"] as const;
export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];

export interface PaymentLink {
  id: string;
  label: string;
  amount: number;
  currency: string;
  category: PaymentCategory;
  url: string;
  notes: string | null;
  provider: string;
  external_id: string | null;
  is_active: boolean;
  sort: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: `lib/permissions/constants.ts`** — add `"payments"` to `PERMISSION_CATEGORIES`; add `payments.view` (not sensitive) + `payments.manage` (sensitive) to `PERMISSIONS` matching the existing entry shape.

- [ ] **Step 3: Write failing tests** `tests/paymentLinks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { paymentLinkSchema, paymentLinkPatchSchema } from "@/lib/payments/schema";
import { groupLinks } from "@/lib/payments/board";
import type { PaymentLink } from "@/lib/payments/types";

const base = { label: "Website $250", amount: 250, category: "Website", url: "https://buy.stripe.com/abc123" };

describe("paymentLinkSchema", () => {
  it("accepts a valid link", () => expect(paymentLinkSchema.safeParse(base).success).toBe(true));
  it("rejects non-https urls", () => {
    expect(paymentLinkSchema.safeParse({ ...base, url: "http://buy.stripe.com/x" }).success).toBe(false);
    expect(paymentLinkSchema.safeParse({ ...base, url: "not-a-url" }).success).toBe(false);
  });
  it("rejects zero/negative amounts", () => {
    expect(paymentLinkSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(paymentLinkSchema.safeParse({ ...base, amount: -5 }).success).toBe(false);
  });
  it("rejects bad category + long label", () => {
    expect(paymentLinkSchema.safeParse({ ...base, category: "Nope" }).success).toBe(false);
    expect(paymentLinkSchema.safeParse({ ...base, label: "x".repeat(121) }).success).toBe(false);
  });
  it("patch allows partial + is_active", () => {
    expect(paymentLinkPatchSchema.safeParse({ is_active: false }).success).toBe(true);
    expect(paymentLinkPatchSchema.safeParse({}).success).toBe(true);
  });
});

const mk = (p: Partial<PaymentLink>): PaymentLink => ({
  id: Math.random().toString(), label: "L", amount: 100, currency: "USD", category: "Website",
  url: "https://x.co", notes: null, provider: "stripe", external_id: null, is_active: true,
  sort: 0, created_by: null, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z", ...p,
});

describe("groupLinks", () => {
  const links = [
    mk({ label: "Site 250", amount: 250, category: "Website", sort: 1 }),
    mk({ label: "Site 200", amount: 200, category: "Website", sort: 0 }),
    mk({ label: "Yearly 100", amount: 100, category: "Yearly" }),
    mk({ label: "Old 500", amount: 500, category: "Website", is_active: false }),
  ];
  it("groups in fixed category order, sorts within", () => {
    const g = groupLinks(links, {});
    expect(g[0].category).toBe("Website");
    expect(g[0].links.map((l) => l.label)).toEqual(["Site 200", "Site 250"]);
    expect(g[1].category).toBe("Yearly");
  });
  it("excludes archived by default, includes on demand", () => {
    expect(groupLinks(links, {}).flatMap((s) => s.links).some((l) => !l.is_active)).toBe(false);
    expect(groupLinks(links, { includeArchived: true }).flatMap((s) => s.links).some((l) => !l.is_active)).toBe(true);
  });
  it("searches by label and by amount digits", () => {
    expect(groupLinks(links, { query: "site 2" }).flatMap((s) => s.links)).toHaveLength(2);
    expect(groupLinks(links, { query: "250" }).flatMap((s) => s.links).map((l) => l.label)).toEqual(["Site 250"]);
  });
  it("filters by category", () => {
    const g = groupLinks(links, { category: "Yearly" });
    expect(g).toHaveLength(1);
    expect(g[0].links[0].label).toBe("Yearly 100");
  });
});
```

Run `npx vitest run tests/paymentLinks.test.ts` → FAIL (modules missing).

- [ ] **Step 4: Implement `lib/payments/schema.ts`**

```ts
import { z } from "zod";
import { PAYMENT_CATEGORIES } from "@/lib/payments/types";

const httpsUrl = z.string().trim().url().refine((u) => u.startsWith("https://"), "URL must be https");

export const paymentLinkSchema = z.object({
  label: z.string().trim().min(1).max(120),
  amount: z.number().positive().max(999999.99),
  category: z.enum(PAYMENT_CATEGORIES),
  url: httpsUrl,
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const paymentLinkPatchSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  amount: z.number().positive().max(999999.99).optional(),
  category: z.enum(PAYMENT_CATEGORIES).optional(),
  url: httpsUrl.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  is_active: z.boolean().optional(),
  sort: z.number().int().optional(),
});
export type PaymentLinkInput = z.infer<typeof paymentLinkSchema>;
```

- [ ] **Step 5: Implement `lib/payments/board.ts`**

```ts
import { PAYMENT_CATEGORIES, type PaymentCategory, type PaymentLink } from "@/lib/payments/types";

export interface BoardFilter {
  query?: string;
  category?: PaymentCategory | "";
  includeArchived?: boolean;
}
export interface CategorySection { category: PaymentCategory; links: PaymentLink[] }

export function groupLinks(links: PaymentLink[], f: BoardFilter): CategorySection[] {
  const q = (f.query ?? "").trim().toLowerCase();
  const filtered = links.filter((l) => {
    if (!f.includeArchived && !l.is_active) return false;
    if (f.category && l.category !== f.category) return false;
    if (q && !l.label.toLowerCase().includes(q) && !String(l.amount).includes(q)) return false;
    return true;
  });
  const sections: CategorySection[] = [];
  for (const category of PAYMENT_CATEGORIES) {
    const inCat = filtered
      .filter((l) => l.category === category)
      .sort((a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at));
    if (inCat.length) sections.push({ category, links: inCat });
  }
  return sections;
}
```

- [ ] **Step 6: Run → PASS; typecheck; commit**

```bash
npx vitest run tests/paymentLinks.test.ts && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/payments lib/permissions/constants.ts tests/paymentLinks.test.ts
git -C "D:/sed-lms-v2" commit -m "feat: payment link types, schemas, board grouping (TDD) + perm constants"
```

---

## GROUP B — API + UI

### Task 3: CRUD routes

**Files:** Create `app/api/payments/links/route.ts`, `app/api/payments/links/[id]/route.ts`.

- [ ] **Step 1: `route.ts`** — mirror `app/api/admin/add-ons/route.ts` structure (READ it):
  - Shared `guard(minPerm)` helper: auth → 401 "Unauthorized"; `getUserPermissions` → 403 "Forbidden" when lacking the given perm; returns `{ user, perms }`.
  - `GET`: guard `payments.view`. Admin client: `.from("payment_links").select("*").order("category").order("sort").order("created_at")`. If the caller lacks `payments.manage`, filter to `is_active` (server-side after load or `.eq`). Return `{ links }`.
  - `POST`: guard `payments.manage`; `paymentLinkSchema.safeParse(await req.json())` → 422 `{ error: "invalid", issues }`; insert `{ ...parsed.data, notes: parsed.data.notes ?? null, created_by: user.id }` `.select("*").single()` (400 on error, message); `activity_log` `{ user_id, action: "payment_link.created", entity_type: "payment_link", entity_id: link.id, new_value: link }`; return `{ link }` 201.
- [ ] **Step 2: `[id]/route.ts`** — Next 16 async params:
  - `PATCH`: guard `payments.manage`; `paymentLinkPatchSchema` → 422; update `{ ...parsed.data, updated_at: new Date().toISOString() }` `.eq("id", id).select("*").single()` (400 on error); `activity_log payment_link.updated` (new_value = the patch); return `{ link }`.
  - `DELETE`: guard `payments.manage`; `.delete().eq("id", id)` (400 on error); `activity_log payment_link.deleted`; return `{ ok: true }`.
- [ ] **Step 3: Typecheck + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add "app/api/payments"
git -C "D:/sed-lms-v2" commit -m "feat: payment links CRUD API (view-gated reads, manage-gated writes)"
```

---

### Task 4: /payments page + board + nav

**Files:** Create `app/(app)/payments/page.tsx`, `components/payments/PaymentLinksBoard.tsx`, `components/payments/PaymentLinkModal.tsx`; modify `components/layout/Sidebar.tsx`.

- [ ] **Step 1: Page (server)** — mirror `app/(app)/feedback/page.tsx`: auth → redirect `/login`; `perms.has("payments.view")` else redirect `/dashboard`; `const canManage = perms.has("payments.manage")`; load via admin client (all rows ordered as the GET; filter `is_active` when `!canManage`); render `<PaymentLinksBoard links={links} canManage={canManage} />`.
- [ ] **Step 2: `PaymentLinkModal.tsx`** (client) — mirror `TicketModal`'s shell: props `{ initial?: PaymentLink | null; onClose: () => void }`. Fields: label (input), amount (`type="number" min=1 step="0.01"`), category (`RadioPillGroup options={PAYMENT_CATEGORIES}`), url (input, placeholder `https://buy.stripe.com/…`), notes (textarea). Client validation mirrors the Zod rules (non-empty label, amount > 0, https URL) with inline errors. Submit: POST `/api/payments/links` or PATCH `/api/payments/links/${initial.id}` (JSON), surface `!res.ok` error, on success `router.refresh()` + `onClose()`.
- [ ] **Step 3: `PaymentLinksBoard.tsx`** (client) — state: `query`, `category` (`"" | PaymentCategory`), `showArchived` (managers only), `modal` (`null | "new" | PaymentLink`), `copiedId`. Compute `const sections = groupLinks(links, { query, category, includeArchived: showArchived });`.
  - Header: title "Payment Links" + total count; controls row: search `<input>` (`inputCls`, placeholder "Search label or amount…"), category pills (All + `PAYMENT_CATEGORIES`, active styling like RadioPillGroup), managers: "Show archived" checkbox + "Add link" accent button.
  - Sections: per `CategorySection` a heading (`text-[11px] uppercase tracking-wide text-text-faint`) + rows in a `bg-surface border border-border rounded-lg divide-y divide-border` list. Each row: left = label (semibold, `+ " opacity-60"` when archived w/ an "Archived" mini-tag) + notes (`text-xs text-text-muted truncate`); middle = `$` amount (`font-mono text-lg font-semibold`, use the money formatting approach from `lib/leads/format.ts` — READ it; plain `$${amount}` is fine if no exact fit); right = **Copy** button (accent, `navigator.clipboard.writeText(l.url)` then set `copiedId` + revert after 1500ms → shows "Copied ✓"), an open-in-new-tab `<a target="_blank" rel="noreferrer">` icon (lucide `ExternalLink`), and when `canManage`: Edit (opens modal), Archive/Restore (PATCH `{ is_active: !l.is_active }` → refresh), Delete (`confirm()` then DELETE → refresh).
  - Empty states: no links at all → centered muted "No payment links yet." (+ "Add link" hint for managers); filtered-empty → "No links match."
- [ ] **Step 4: Sidebar** — add `{ href: "/payments", label: "Payments", perm: "payments.view" }` to `MAIN` (after Tickets/Feedback, before Notifications — match the file's ordering style).
- [ ] **Step 5: Full build + commit**

```bash
cd "D:/sed-lms-v2" && npm run build
git -C "D:/sed-lms-v2" add "app/(app)/payments" components/payments components/layout/Sidebar.tsx
git -C "D:/sed-lms-v2" commit -m "feat: role-aware /payments board - search, category pills, copy-first rows, manager CRUD + nav"
```

---

## GROUP C — Verification

### Task 5 (controller): apply migration + full gate + live pass
- [ ] Apply `0022` via Supabase MCP; verify table/RLS/dept/perms/grants by SQL.
- [ ] `npx vitest run` (all green) + `npm run build` (green).
- [ ] Live (Chrome): create a $250 Website link via the modal; Copy → clipboard contains the URL + "Copied ✓" flash; edit; archive → gone from default view → visible via Show archived → restore; sidebar "Payments" entry present; temporary deny override of `payments.view` on a test basis → `/payments` redirects → override removed.
- [ ] Merge to main + push; remind about hPanel redeploy.

---

## Self-review coverage map
- Table/dept/perms/seed → Task 1 · types/constants/Zod/groupLinks → Task 2 · API → Task 3 · page/board/modal/nav → Task 4 · migration-apply/tests/live → Task 5.
