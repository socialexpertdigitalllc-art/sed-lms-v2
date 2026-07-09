# Branding + Dashboard KPI Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-configurable company branding (uploaded logo + company name applied to sidebar/login/tab-title/marketing) and 23 individually permission-gated dashboard widgets, including 12 new KPIs; Quoted Revenue becomes Ready-leads-only.

**Architecture:** Branding rides the `app_settings` singleton + a new public `branding` Storage bucket, surfaced via a `getBranding()` reader and a presentational `BrandMark`. KPI gating is a pure `dashboardVisibility(perms)` flag map over 23 new `dashboard.*` permissions (seeded granted-to-all), with new pure metrics in `lib/dashboard/metrics.ts` feeding a secondary stat grid + 2 new charts.

**Tech Stack:** Next.js 16 App Router + TS, Supabase (Postgres/Storage/RLS), Zod, Vitest, Recharts. Project `ikuvbxjkoojtgekapbul`. Migrations written to `supabase/migrations/` AND applied to remote via Supabase MCP (controller applies).

**Environment notes:**
- Windows; npm slow — targeted `npx vitest run <file>` + `npx tsc --noEmit`; full `npm run build` at group ends.
- Next 16: async `params`/`headers`; `middleware` file deprecation warning is pre-existing/ignored.
- Writes via `createAdminClient()`; route gates via `getUserPermissions(user.id)` + `perms.has(...)`.
- **Reference templates:** settings card/API `components/admin/AppSettingsCard.tsx` + `app/api/admin/settings/route.ts` + `lib/settings/appSettings.ts`; Storage upload `app/api/admin/settings`-style multipart in `app/api/feedback/route.ts` (screenshot part) + bucket insert in `supabase/migrations/0018_ticket_v2.sql`; permission seeding `supabase/migrations/0017_tickets.sql` + `seed.sql`; dashboard `app/(app)/dashboard/page.tsx`, `components/dashboard/{KpiHero,StatusStrip,Charts}.tsx`, `lib/leads/analytics.ts`, `lib/dashboard/palette.ts`; ticket overdue logic `lib/tickets/logic.ts` (`isOverdue`).

---

## GROUP A — Foundations

### Task 1: Migration 0021 — branding columns, bucket, 23 dashboard permissions

**Files:** Create `supabase/migrations/0021_branding_kpis.sql`; modify `supabase/seed.sql`.

- [ ] **Step 1: Write the SQL**

```sql
-- 0021_branding_kpis.sql — company branding + dashboard KPI permissions

alter table public.app_settings
  add column if not exists company_name text not null default 'SED LMS',
  add column if not exists logo_path text;

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('dashboard.kpi.total_leads','KPI: Total Leads',null,'dashboard',false),
  ('dashboard.kpi.quoted_revenue','KPI: Quoted Revenue',null,'dashboard',false),
  ('dashboard.kpi.ready','KPI: Ready Count',null,'dashboard',false),
  ('dashboard.kpi.avg_rating','KPI: Avg Rating',null,'dashboard',false),
  ('dashboard.kpi.closed_revenue','KPI: Closed Revenue',null,'dashboard',false),
  ('dashboard.kpi.recurring_revenue','KPI: Recurring (Yearly) Revenue',null,'dashboard',false),
  ('dashboard.kpi.avg_deal_size','KPI: Avg Deal Size',null,'dashboard',false),
  ('dashboard.kpi.conversion_rate','KPI: Conversion Rate',null,'dashboard',false),
  ('dashboard.kpi.new_this_week','KPI: New Leads This Week',null,'dashboard',false),
  ('dashboard.kpi.overdue_followups','KPI: Overdue Follow-ups',null,'dashboard',false),
  ('dashboard.kpi.pickup_rate','KPI: Pickup Rate',null,'dashboard',false),
  ('dashboard.kpi.open_tickets','KPI: Open Tickets',null,'dashboard',false),
  ('dashboard.kpi.overdue_tickets','KPI: Overdue Tickets',null,'dashboard',false),
  ('dashboard.kpi.avg_resolution_time','KPI: Avg Ticket Resolution Time',null,'dashboard',false),
  ('dashboard.strip.status','Status Percentage Strip',null,'dashboard',false),
  ('dashboard.chart.leads_over_time','Chart: Leads Over Time',null,'dashboard',false),
  ('dashboard.chart.pipeline_by_status','Chart: Pipeline by Status',null,'dashboard',false),
  ('dashboard.chart.leads_by_agent','Chart: Leads by Agent',null,'dashboard',false),
  ('dashboard.chart.site_type_split','Chart: Site Type Split',null,'dashboard',false),
  ('dashboard.chart.rating_distribution','Chart: Rating Distribution',null,'dashboard',false),
  ('dashboard.chart.fresh_vs_followup','Chart: Fresh vs Follow-up',null,'dashboard',false),
  ('dashboard.chart.revenue_by_status','Chart: Revenue by Status',null,'dashboard',false),
  ('dashboard.chart.ticket_status_split','Chart: Ticket Status Split',null,'dashboard',false)
on conflict (key) do nothing;

-- default: every department sees everything (admin revokes selectively later)
insert into public.department_permissions (department_id, permission_key)
  select d.id, p.key
  from public.departments d
  cross join public.permissions p
  where p.category = 'dashboard'
on conflict do nothing;
```

- [ ] **Step 2: Mirror into `supabase/seed.sql`** — READ it first. Append the same 23 permission rows to the permissions `values` block (same tuple shape), and add this statement AFTER the existing department-grant statements (do NOT add 115 tuples):

```sql
-- dashboard widgets: default-granted to every department
insert into public.department_permissions (department_id, permission_key)
  select d.id, p.key from public.departments d cross join public.permissions p
  where p.category = 'dashboard'
on conflict do nothing;
```

- [ ] **Step 3: Commit** (controller applies the migration to the remote DB)

```bash
git -C "D:/sed-lms-v2" add supabase/migrations/0021_branding_kpis.sql supabase/seed.sql
git -C "D:/sed-lms-v2" commit -m "feat: migration 0021 - branding settings, public branding bucket, 23 dashboard KPI perms"
```

---

### Task 2: Constants + appSettings extension

**Files:** Modify `lib/permissions/constants.ts`, `lib/settings/appSettings.ts`.

- [ ] **Step 1: `lib/permissions/constants.ts`** — add `"dashboard"` to `PERMISSION_CATEGORIES`; add all 23 keys to `PERMISSIONS` (category `dashboard`, not sensitive), names matching Task 1 exactly.

- [ ] **Step 2: `lib/settings/appSettings.ts`** — extend `AppSettings` with `company_name: string; logo_path: string | null;`; add both to the `.select(...)` and the lazy-seed defaults (`company_name: "SED LMS", logo_path: null`). Append:

```ts
export function logoPublicUrl(logoPath: string | null): string | null {
  if (!logoPath) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${logoPath}`;
}

export type Branding = { companyName: string; logoUrl: string | null };

/** Fallback-safe: never throws (metadata generation must not crash a render/build). */
export async function getBranding(): Promise<Branding> {
  try {
    const s = await getAppSettings();
    return { companyName: s.company_name || "SED LMS", logoUrl: logoPublicUrl(s.logo_path) };
  } catch {
    return { companyName: "SED LMS", logoUrl: null };
  }
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/permissions/constants.ts lib/settings/appSettings.ts
git -C "D:/sed-lms-v2" commit -m "feat: dashboard perm constants + branding settings fields/reader"
```

---

## GROUP B — Pure logic (TDD)

### Task 3: Quoted-Revenue change + extended metrics

**Files:** Modify `lib/leads/analytics.ts` (`computeKpis`), `tests/analytics.test.ts`; Create `lib/dashboard/metrics.ts`, `tests/dashboardMetrics.test.ts`.

- [ ] **Step 1: Update `tests/analytics.test.ts` FIRST** — find the `computeKpis` quoted-revenue expectation; change fixtures/assertions so `quotedRevenue` counts **only leads with `status === "Ready"`** (e.g. fixture has a Ready lead at 500 and a Closed lead at 900 → expect 500, not 1400). Run `npx vitest run tests/analytics.test.ts` → FAIL (old impl sums more).

- [ ] **Step 2: Change `computeKpis`** in `lib/leads/analytics.ts`: the quoted-revenue accumulation filters `l.status === "Ready"`. Run → PASS.

- [ ] **Step 3: Write failing tests** `tests/dashboardMetrics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeExtendedKpis, revenueByStatus, ticketStatusSplit } from "@/lib/dashboard/metrics";
import type { Lead } from "@/lib/leads/types";

const now = new Date("2026-07-10T12:00:00Z");
const lead = (p: Partial<Lead>): Lead => ({ id: Math.random().toString(), status: "Not Ready", business_name: "x", created_at: "2026-06-01T00:00:00Z", price_quoted: null, yearly_price: null, follow_up_time: null } as unknown as Lead & Record<string, unknown>) && ({ id: Math.random().toString(), status: "Not Ready", business_name: "x", created_at: "2026-06-01T00:00:00Z", price_quoted: null, yearly_price: null, follow_up_time: null, ...p } as unknown as Lead);

describe("computeExtendedKpis", () => {
  it("revenue + deal metrics", () => {
    const leads = [
      lead({ status: "Closed", price_quoted: 900, yearly_price: "100" }),
      lead({ status: "Closed", price_quoted: 300, yearly_price: "None" }),
      lead({ status: "Ready", price_quoted: 500, yearly_price: "50" }),
      lead({ price_quoted: null }),
    ];
    const k = computeExtendedKpis(leads, [], [], now);
    expect(k.closedRevenue).toBe(1200);
    expect(k.recurringRevenue).toBe(100); // Closed only, "None" skipped
    expect(k.avgDealSize).toBeCloseTo((900 + 300 + 500) / 3, 5);
    expect(k.conversionRate).toBeCloseTo(50, 5); // 2 of 4
  });
  it("null-safe when empty", () => {
    const k = computeExtendedKpis([], [], [], now);
    expect(k.avgDealSize).toBeNull();
    expect(k.pickupRate).toBeNull();
    expect(k.avgResolutionHours).toBeNull();
    expect(k.conversionRate).toBe(0);
  });
  it("newThisWeek + overdueFollowUps", () => {
    const leads = [
      lead({ created_at: "2026-07-08T00:00:00Z" }),                                   // this week
      lead({ created_at: "2026-06-01T00:00:00Z" }),                                   // old
      lead({ status: "Ready", follow_up_time: "2026-07-09T00:00:00Z" }),              // overdue
      lead({ status: "Long Term", follow_up_time: "2026-08-01T00:00:00Z" }),          // future
      lead({ status: "Closed", follow_up_time: "2026-07-01T00:00:00Z" }),             // ineligible status
    ];
    const k = computeExtendedKpis(leads, [], [], now);
    expect(k.newThisWeek).toBe(1);
    expect(k.overdueFollowUps).toBe(1);
  });
  it("pickup + ticket metrics", () => {
    const fu = [{ fu_status: "Pickup" }, { fu_status: "Pickup" }, { fu_status: "No Pickup" }, { fu_status: "Pickup" }];
    const tickets = [
      { status: "Open", due_date: "2026-07-09T00:00:00Z", created_at: "2026-07-01T00:00:00Z", resolved_at: null },      // open + overdue
      { status: "Resolved", due_date: null, created_at: "2026-07-01T00:00:00Z", resolved_at: "2026-07-02T00:00:00Z" },  // 24h
      { status: "In Progress", due_date: "2026-08-01T00:00:00Z", created_at: "2026-07-01T00:00:00Z", resolved_at: null },
    ];
    const k = computeExtendedKpis([], fu, tickets, now);
    expect(k.pickupRate).toBeCloseTo(75, 5);
    expect(k.openTickets).toBe(2);
    expect(k.overdueTickets).toBe(1);
    expect(k.avgResolutionHours).toBeCloseTo(24, 5);
  });
});

describe("revenueByStatus", () => {
  it("sums per status, skips zero statuses", () => {
    const r = revenueByStatus([lead({ status: "Ready", price_quoted: 500 }), lead({ status: "Ready", price_quoted: 250 }), lead({ status: "Closed", price_quoted: 900 })]);
    expect(r).toEqual(expect.arrayContaining([{ name: "Ready", value: 750 }, { name: "Closed", value: 900 }]));
  });
});

describe("ticketStatusSplit", () => {
  it("counts per lifecycle status", () => {
    const r = ticketStatusSplit([{ status: "Open" }, { status: "Open" }, { status: "Resolved" }]);
    expect(r).toEqual(expect.arrayContaining([{ name: "Open", value: 2 }, { name: "Resolved", value: 1 }]));
  });
});
```

Run `npx vitest run tests/dashboardMetrics.test.ts` → FAIL (module missing). (If the inline `lead()` helper trips on required `Lead` fields under tsc, mirror the defaults object used by `tests/analytics.test.ts`'s `mk()` instead.)

- [ ] **Step 4: Implement `lib/dashboard/metrics.ts`**

```ts
import type { Lead } from "@/lib/leads/types";
import { isOverdue } from "@/lib/tickets/logic";
import type { TicketStatus } from "@/lib/tickets/types";

export interface FollowUpLite { fu_status: string }
export interface TicketLite { status: string; due_date: string | null; created_at: string; resolved_at: string | null }

export interface ExtendedKpis {
  closedRevenue: number;
  recurringRevenue: number;
  avgDealSize: number | null;
  conversionRate: number;
  newThisWeek: number;
  overdueFollowUps: number;
  pickupRate: number | null;
  openTickets: number;
  overdueTickets: number;
  avgResolutionHours: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export function computeExtendedKpis(
  leads: Lead[], followUps: FollowUpLite[], tickets: TicketLite[], now: Date
): ExtendedKpis {
  const closed = leads.filter((l) => l.status === "Closed");
  const closedRevenue = closed.reduce((s, l) => s + (num(l.price_quoted) ?? 0), 0);
  const recurringRevenue = closed.reduce((s, l) => s + (num(l.yearly_price) ?? 0), 0);

  const priced = leads.map((l) => num(l.price_quoted)).filter((n): n is number => n !== null);
  const avgDealSize = priced.length ? priced.reduce((a, b) => a + b, 0) / priced.length : null;

  const conversionRate = leads.length ? (closed.length / leads.length) * 100 : 0;

  const weekAgo = now.getTime() - 7 * 86_400_000;
  const newThisWeek = leads.filter((l) => new Date(l.created_at).getTime() >= weekAgo).length;

  const overdueFollowUps = leads.filter(
    (l) => (l.status === "Ready" || l.status === "Long Term") &&
      l.follow_up_time && new Date(l.follow_up_time).getTime() < now.getTime()
  ).length;

  const pickups = followUps.filter((f) => f.fu_status === "Pickup").length;
  const pickupRate = followUps.length ? (pickups / followUps.length) * 100 : null;

  const openTickets = tickets.filter((t) => t.status !== "Resolved").length;
  const overdueTickets = tickets.filter((t) => isOverdue(t.due_date, t.status as TicketStatus, now)).length;

  const res = tickets
    .filter((t) => t.resolved_at)
    .map((t) => (new Date(t.resolved_at as string).getTime() - new Date(t.created_at).getTime()) / 3_600_000);
  const avgResolutionHours = res.length ? res.reduce((a, b) => a + b, 0) / res.length : null;

  return { closedRevenue, recurringRevenue, avgDealSize, conversionRate, newThisWeek, overdueFollowUps, pickupRate, openTickets, overdueTickets, avgResolutionHours };
}

export function revenueByStatus(leads: Lead[]): { name: string; value: number }[] {
  const sums = new Map<string, number>();
  for (const l of leads) {
    const v = num(l.price_quoted);
    if (v === null) continue;
    sums.set(l.status, (sums.get(l.status) ?? 0) + v);
  }
  return [...sums.entries()].map(([name, value]) => ({ name, value }));
}

export function ticketStatusSplit(tickets: { status: string }[]): { name: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const t of tickets) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  return [...counts.entries()].map(([name, value]) => ({ name, value }));
}
```

- [ ] **Step 5: Run → pass; full targeted suite + commit**

```bash
npx vitest run tests/dashboardMetrics.test.ts tests/analytics.test.ts && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/leads/analytics.ts tests/analytics.test.ts lib/dashboard/metrics.ts tests/dashboardMetrics.test.ts
git -C "D:/sed-lms-v2" commit -m "feat: Ready-only quoted revenue + extended dashboard metrics (TDD)"
```

---

### Task 4: dashboardVisibility (pure, TDD)

**Files:** Create `lib/dashboard/visibility.ts`, `tests/dashboardVisibility.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import { dashboardVisibility, anyDashboardVisible } from "@/lib/dashboard/visibility";

describe("dashboardVisibility", () => {
  it("maps keys to flags", () => {
    const v = dashboardVisibility(new Set(["dashboard.kpi.total_leads", "dashboard.chart.revenue_by_status"]));
    expect(v.totalLeads).toBe(true);
    expect(v.revenueByStatus).toBe(true);
    expect(v.quotedRevenue).toBe(false);
    expect(v.ticketStatusSplit).toBe(false);
  });
  it("anyDashboardVisible false when nothing granted", () => {
    const v = dashboardVisibility(new Set());
    expect(anyDashboardVisible(v)).toBe(false);
  });
  it("anyDashboardVisible true with one flag", () => {
    expect(anyDashboardVisible(dashboardVisibility(new Set(["dashboard.strip.status"])))).toBe(true);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement `lib/dashboard/visibility.ts`**

```ts
export interface DashboardVisibility {
  totalLeads: boolean; quotedRevenue: boolean; ready: boolean; avgRating: boolean;
  closedRevenue: boolean; recurringRevenue: boolean; avgDealSize: boolean; conversionRate: boolean;
  newThisWeek: boolean; overdueFollowups: boolean; pickupRate: boolean;
  openTickets: boolean; overdueTickets: boolean; avgResolutionTime: boolean;
  statusStrip: boolean;
  leadsOverTime: boolean; pipelineByStatus: boolean; leadsByAgent: boolean; siteTypeSplit: boolean;
  ratingDistribution: boolean; freshVsFollowup: boolean; revenueByStatus: boolean; ticketStatusSplit: boolean;
}

const KEYMAP: [keyof DashboardVisibility, string][] = [
  ["totalLeads", "dashboard.kpi.total_leads"],
  ["quotedRevenue", "dashboard.kpi.quoted_revenue"],
  ["ready", "dashboard.kpi.ready"],
  ["avgRating", "dashboard.kpi.avg_rating"],
  ["closedRevenue", "dashboard.kpi.closed_revenue"],
  ["recurringRevenue", "dashboard.kpi.recurring_revenue"],
  ["avgDealSize", "dashboard.kpi.avg_deal_size"],
  ["conversionRate", "dashboard.kpi.conversion_rate"],
  ["newThisWeek", "dashboard.kpi.new_this_week"],
  ["overdueFollowups", "dashboard.kpi.overdue_followups"],
  ["pickupRate", "dashboard.kpi.pickup_rate"],
  ["openTickets", "dashboard.kpi.open_tickets"],
  ["overdueTickets", "dashboard.kpi.overdue_tickets"],
  ["avgResolutionTime", "dashboard.kpi.avg_resolution_time"],
  ["statusStrip", "dashboard.strip.status"],
  ["leadsOverTime", "dashboard.chart.leads_over_time"],
  ["pipelineByStatus", "dashboard.chart.pipeline_by_status"],
  ["leadsByAgent", "dashboard.chart.leads_by_agent"],
  ["siteTypeSplit", "dashboard.chart.site_type_split"],
  ["ratingDistribution", "dashboard.chart.rating_distribution"],
  ["freshVsFollowup", "dashboard.chart.fresh_vs_followup"],
  ["revenueByStatus", "dashboard.chart.revenue_by_status"],
  ["ticketStatusSplit", "dashboard.chart.ticket_status_split"],
];

export function dashboardVisibility(perms: Set<string>): DashboardVisibility {
  const v = {} as DashboardVisibility;
  for (const [flag, key] of KEYMAP) v[flag] = perms.has(key);
  return v;
}

export function anyDashboardVisible(v: DashboardVisibility): boolean {
  return Object.values(v).some(Boolean);
}
```

- [ ] **Step 3: Run → pass; commit**

```bash
npx vitest run tests/dashboardVisibility.test.ts && npx tsc --noEmit
git -C "D:/sed-lms-v2" add lib/dashboard/visibility.ts tests/dashboardVisibility.test.ts
git -C "D:/sed-lms-v2" commit -m "feat: pure dashboard visibility map over the 23 KPI permissions"
```

---

## GROUP C — Branding backend + UI + render points

### Task 5: Branding API (company_name in PUT + logo upload route)

**Files:** Modify `app/api/admin/settings/route.ts`; Create `app/api/admin/settings/logo/route.ts`.

- [ ] **Step 1: settings PUT** — add `company_name: z.string().trim().min(1).max(80)` to the Zod body and include it in the upsert + response. (GET path: ensure the returned settings include `company_name`/`logo_path` — `getAppSettings` already selects them after Task 2.)

- [ ] **Step 2: `app/api/admin/settings/logo/route.ts`** — `runtime` default; both handlers gated `admin.settings.manage` (mirror the settings route guard):
  - `POST` (multipart): `const form = await req.formData(); const file = form.get("logo");` — 422 unless `file instanceof File`, `["image/png","image/jpeg","image/svg+xml","image/webp"].includes(file.type)`, and `file.size <= 2*1024*1024`. Ext map: png/jpg/svg/webp from the mime. Load current `logo_path` via `getAppSettings()`; upload `branding/logo-${Date.now()}.${ext}` with `admin.storage.from("branding").upload(path, file, { contentType: file.type, upsert: true })`; on success `admin.from("app_settings").update({ logo_path: path, updated_at: ..., updated_by: user.id }).eq("singleton", true)`; best-effort `admin.storage.from("branding").remove([oldPath])` when one existed; `activity_log` `settings.branding_updated`. Return `{ branding: { companyName, logoUrl } }` via `getBranding()`.
  - `DELETE`: null out `logo_path` (+ remove the storage object, best-effort) → return updated branding.

- [ ] **Step 3: Build + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add app/api/admin/settings/route.ts "app/api/admin/settings/logo/route.ts"
git -C "D:/sed-lms-v2" commit -m "feat: branding API - company_name in settings PUT + logo upload/remove route"
```

---

### Task 6: BrandMark + settings-card Branding section

**Files:** Create `components/branding/BrandMark.tsx`; Modify `components/admin/AppSettingsCard.tsx`.

- [ ] **Step 1: `components/branding/BrandMark.tsx`** (presentational; server-safe — no hooks):

```tsx
export function BrandMark({
  companyName,
  logoUrl,
  size = 32,
  textClassName = "font-semibold text-text tracking-tight",
  showName = true,
}: {
  companyName: string;
  logoUrl: string | null;
  size?: number;
  textClassName?: string;
  showName?: boolean;
}) {
  const letter = (companyName.trim()[0] ?? "S").toUpperCase();
  return (
    <span className="flex items-center gap-2 min-w-0">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={companyName} width={size} height={size}
          className="rounded-lg object-contain shrink-0" style={{ width: size, height: size }} />
      ) : (
        <span className="rounded-lg bg-accent grid place-items-center text-white font-bold shrink-0"
          style={{ width: size, height: size, fontSize: size * 0.45 }}>{letter}</span>
      )}
      {showName && <span className={"truncate " + textClassName}>{companyName}</span>}
    </span>
  );
}
```

- [ ] **Step 2: `AppSettingsCard.tsx`** — add a **Branding** section ABOVE "Work Hours & Sessions": company-name text input (state seeded from a new `initial.company_name`; included in the existing PUT body), a logo preview (`<img>` from a new `initialLogoUrl: string | null` prop, else the monogram), `<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp">` that on change validates (type + ≤2 MB, inline error) and immediately `POST`s FormData (`logo` field) to `/api/admin/settings/logo` then `router.refresh()`, and a "Remove logo" button (only when a logo exists) calling `DELETE` then refresh. Pass the new props from the logs page (`app/(app)/admin/logs/page.tsx` renders the card — it has `settings`; compute `logoUrl` there with `logoPublicUrl(settings.logo_path)`).

- [ ] **Step 3: Build + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add components/branding/BrandMark.tsx components/admin/AppSettingsCard.tsx "app/(app)/admin/logs/page.tsx"
git -C "D:/sed-lms-v2" commit -m "feat: BrandMark component + Branding section in admin settings card"
```

---

### Task 7: Apply branding everywhere

**Files:** Modify `app/(app)/layout.tsx`, `components/layout/Sidebar.tsx`, `app/login/page.tsx`, `app/layout.tsx`, the `(marketing)` layout/page + `components/marketing/{MarketingHeader,MarketingFooter,DashboardPreview}.tsx`.

- [ ] **Step 1: READ each file first.** Then:
  - `app/(app)/layout.tsx`: `const branding = await getBranding();` → pass `branding={branding}` to `<Sidebar/>`.
  - `Sidebar.tsx`: accept `branding: { companyName: string; logoUrl: string | null }`; replace the hardcoded brand block (the "S" tile + "SED LMS" text) with `<BrandMark companyName={branding.companyName} logoUrl={branding.logoUrl} size={32} />` keeping the block's existing layout classes.
  - `app/login/page.tsx`: fetch `getBranding()`; replace the hardcoded S + "SED LMS" block with `BrandMark`.
  - `app/layout.tsx`: replace the static `metadata` title with:
    ```ts
    export async function generateMetadata() {
      const { companyName } = await getBranding();
      return { title: companyName };
    }
    ```
    (`getBranding` is fallback-safe.) Keep any other metadata fields.
  - Marketing: in the `(marketing)` layout (or page) fetch branding once; give `MarketingHeader`/`MarketingFooter` a `branding` prop and render `BrandMark` (footer keeps its size); `DashboardPreview` gets `companyName`/`logoUrl` props for its mock sidebar mark. Preserve all existing styling/spacing.

- [ ] **Step 2: Full build** — `npm run build` → must pass (`/login` may flip from ○ static to ƒ dynamic — expected).

- [ ] **Step 3: Commit**

```bash
git -C "D:/sed-lms-v2" add "app/(app)/layout.tsx" components/layout/Sidebar.tsx app/login/page.tsx app/layout.tsx app/"(marketing)" components/marketing
git -C "D:/sed-lms-v2" commit -m "feat: branding applied - sidebar, login, tab title, marketing"
```

---

## GROUP D — Dashboard gating + new widgets

### Task 8: KpiHero visibility props + StatGrid + 2 new charts

**Files:** Modify `components/dashboard/KpiHero.tsx`, `components/dashboard/Charts.tsx`; Create `components/dashboard/StatGrid.tsx`.

- [ ] **Step 1: READ `KpiHero.tsx`** — extend props with `show: { totalLeads: boolean; quotedRevenue: boolean; ready: boolean; avgRating: boolean }` and render each of the 4 tiles only when its flag is true (grid reflows; keep `showReady` semantics by AND-ing: the page will pass `ready: flags.ready && visible.includes("Ready")`). Change the Quoted Revenue tile's subtitle to **"from Ready leads"**.

- [ ] **Step 2: `components/dashboard/StatGrid.tsx`** (new, presentational): props `{ kpis: ExtendedKpis; show: DashboardVisibility }`. A responsive grid (`grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3`) of compact tiles (mirror the tile card styling used by `KpiHero`, smaller paddings) — one per granted flag among the 10:
  Closed Revenue (`$` formatted, reuse the money formatter used in `KpiHero`/`lib/leads/format`), Recurring Revenue (`$…/yr`), Avg Deal Size (`$` or "—"), Conversion Rate (`X.X%`), New This Week (int), Overdue Follow-ups (int, red `text-dropped-fg` when > 0), Pickup Rate (`X%` or "—"), Open Tickets (int), Overdue Tickets (int, red when > 0), Avg Resolution (`<48h → "Xh"`, else `"X.Yd"`, "—" when null):
  ```ts
  const fmtHours = (h: number | null) => h === null ? "—" : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`;
  ```
  Render `null` (nothing) when none of its 10 flags are on.

- [ ] **Step 3: `Charts.tsx`** — READ it; add, mirroring the existing chart components' structure/sizing:
  - `RevenueByStatus({ data }: { data: { name: string; value: number }[] })` — a Recharts bar chart (like `LeadsByAgent`) with currency tooltip; color bars via `STATUS_LEGEND` colors from `lib/dashboard/palette.ts` when the status name matches, else the accent.
  - `TicketStatusDonut({ data })` — a donut (like `StatusDonut`) with a small fixed palette for Open/Assigned/In Progress/Resolved (reuse existing palette tokens/hexes in `lib/dashboard/palette.ts` — add a `TICKET_LEGEND` there if the file's pattern calls for it).

- [ ] **Step 4: Build + commit**

```bash
cd "D:/sed-lms-v2" && npx tsc --noEmit
git -C "D:/sed-lms-v2" add components/dashboard/KpiHero.tsx components/dashboard/StatGrid.tsx components/dashboard/Charts.tsx lib/dashboard/palette.ts
git -C "D:/sed-lms-v2" commit -m "feat: KpiHero visibility props, secondary StatGrid, revenue/ticket charts"
```

---

### Task 9: Dashboard page composition

**Files:** Modify `app/(app)/dashboard/page.tsx`.

- [ ] **Step 1:** Extend the data load (user-scoped client, same as leads): `supabase.from("lead_follow_ups").select("fu_status")` and `supabase.from("lead_tickets").select("status, due_date, created_at, resolved_at")`.
- [ ] **Step 2:** Compute `const flags = dashboardVisibility(perms);` (`perms` is already loaded), `const ext = computeExtendedKpis(leads, followUps ?? [], tickets ?? [], new Date());`. Compose:
  - Header subtitle (the "N active leads" line) renders only when `flags.totalLeads`.
  - `<KpiHero kpis={kpis} show={{ totalLeads: flags.totalLeads, quotedRevenue: flags.quotedRevenue, ready: flags.ready && visible.includes("Ready"), avgRating: flags.avgRating }} />` — render the hero only if any of the 4 are on.
  - `<StatGrid kpis={ext} show={flags} />`.
  - `<StatusStrip …/>` only when `flags.statusStrip`.
  - Each existing ChartCard wrapped in its flag; add two new ChartCards: "Revenue by status" (`flags.revenueByStatus`, data `revenueByStatus(leads).filter(d => visible.includes(d.name))`) and "Ticket status split" (`flags.ticketStatusSplit`, data `ticketStatusSplit(tickets ?? [])`). Keep the grid layout sensible when pieces are missing (existing `grid-cols-*` classes are fine — cards just reflow; adjust `lg:col-span-2` on Leads-over-time only if it's the sole card in its row… leave as-is, acceptable).
  - If `!anyDashboardVisible(flags)`: render the header + a centered muted empty state: "No dashboard widgets are enabled for you. Ask an admin to grant dashboard permissions."
- [ ] **Step 3:** `npm run build` → pass. Commit:

```bash
git -C "D:/sed-lms-v2" add "app/(app)/dashboard/page.tsx"
git -C "D:/sed-lms-v2" commit -m "feat: permission-gated dashboard composition + new KPI tiles/charts"
```

---

## GROUP E — Verification

### Task 10: Full verification
- [ ] **Step 1:** `npx vitest run` (all green) + `npm run build` (green).
- [ ] **Step 2 (controller): live Chrome pass** — dashboard renders (all widgets present, Quoted Revenue says "from Ready leads" with the Ready-only number); admin settings → set a company name + upload a generated test PNG → sidebar + tab title + login show it; Remove logo → monogram fallback; deny `dashboard.kpi.quoted_revenue` for the admin via a user-permission-override → tile disappears + grid reflows → remove the override; new tiles show plausible numbers (cross-check one against SQL).
- [ ] **Step 3:** Fix any runtime issues, re-verify, commit.

---

## Self-review coverage map
- Migration/bucket/perms/seed → Task 1 · constants/reader → Task 2
- Ready-only quoted revenue → Task 3 · metrics → Task 3 · visibility → Task 4
- Branding API → Task 5 · BrandMark/settings UI → Task 6 · render points (sidebar/login/title/marketing) → Task 7
- Hero props/StatGrid/charts → Task 8 · page composition/empty state → Task 9 · verify → Task 10
