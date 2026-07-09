# SED LMS v2 — Branding + Dashboard KPI Permissions

**Date:** 2026-07-10
**Branch:** `branding-kpis` (off `main` @ `5387917`)
**Status:** Design approved — ready for planning

Two admin-control features requested before the Payment Links system: (1) admin-configurable **company branding** (logo + company name, replacing the hardcoded "S" monogram and "SED LMS"), and (2) **permission-gated dashboard KPIs** — every dashboard widget becomes an individually grantable permission, including 12 new KPIs. Builds on the `app_settings` singleton, the Storage patterns, and the RBAC system ([[polish-3-signin-dup-addons]], [[sed-lms-v2-rebuild]]).

## Decisions (locked in brainstorming)
- KPI defaults: **all granted to all departments** at migration — dashboards unchanged until an admin revokes.
- Logo: **file upload** (PNG/JPG/SVG/WebP, ≤2 MB) to a new **public** Storage bucket `branding` (public pages — login/marketing — must render it without signed URLs).
- Brand scope: **everywhere** — in-app sidebar, login page, browser-tab title, marketing header/footer/preview mock.
- Granularity: **all 23 widgets individually** (4 hero tiles + 10 new tiles + status strip + 8 charts).
- **Quoted Revenue changes**: sums `price_quoted` over **Ready leads only** (was open+won); tile subtitle says "from Ready leads".

---

## 1. Migration `0021_branding_kpis.sql`
- `app_settings` + `company_name text not null default 'SED LMS'`, `logo_path text` (null = monogram fallback).
- Public bucket: `insert into storage.buckets (id, name, public) values ('branding','branding', true) on conflict do nothing;`
- **23 permissions**, category `dashboard`, none sensitive:
  - Tiles: `dashboard.kpi.total_leads`, `.quoted_revenue`, `.ready`, `.avg_rating`, `.closed_revenue`, `.recurring_revenue`, `.avg_deal_size`, `.conversion_rate`, `.new_this_week`, `.overdue_followups`, `.pickup_rate`, `.open_tickets`, `.overdue_tickets`, `.avg_resolution_time`
  - Strip: `dashboard.strip.status`
  - Charts: `dashboard.chart.leads_over_time`, `.pipeline_by_status`, `.leads_by_agent`, `.site_type_split`, `.rating_distribution`, `.fresh_vs_followup`, `.revenue_by_status`, `.ticket_status_split`
- **Grant all 23 to ALL departments** via `cross join` on `p.category='dashboard'` (idempotent). Mirror both the permission rows and a category-wide grant statement in `seed.sql`. Add `"dashboard"` to `PERMISSION_CATEGORIES` + the 23 entries to `PERMISSIONS` in `lib/permissions/constants.ts` (auto-appears in the existing Permissions admin UI, grouped under "dashboard").

## 2. Branding

**Settings:** `AppSettings` gains `company_name: string`, `logo_path: string | null` (reader select + lazy-seed defaults). New helpers in `lib/settings/appSettings.ts`:
- `logoPublicUrl(path)` → `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${path}` (or null).
- `getBranding()` → `{ companyName, logoUrl }` (wraps `getAppSettings`; **try/catch fallback** to `{ "SED LMS", null }` so metadata generation can never crash a build/render).

**API (gated `admin.settings.manage`):**
- `company_name` joins the existing JSON `PUT /api/admin/settings` (Zod `trim().min(1).max(80)`).
- New `app/api/admin/settings/logo/route.ts`: `POST` multipart (`logo` file — `image/(png|jpeg|svg\+xml|webp)`, ≤2 MB) → upload to `branding/logo-{Date.now()}.{ext}` (timestamped name = cache-busting), delete the previous `logo_path` object, update `app_settings.logo_path`, `activity_log` `settings.branding_updated`; `DELETE` → remove object + null the path. Both return the new branding.

**Admin UI:** a **Branding** section at the top of `AppSettingsCard`: company-name input (saved via the existing Save/PUT), current-logo preview (img or monogram), file input with immediate upload on select, and "Remove logo". Client-side validation mirrors the server (type + 2 MB).

**Render points (all consume `getBranding()` server-side and pass props down):**
- `app/(app)/layout.tsx` → `<Sidebar branding={...}>` — the sidebar brand block renders `BrandMark` + company name instead of the hardcoded S/"SED LMS".
- `app/login/page.tsx` — same replacement on the login card.
- `app/layout.tsx` — `export const metadata` becomes `generateMetadata()` returning `{ title: companyName }` (fallback-safe; makes `/login` dynamic — acceptable, everything else already is).
- Marketing: the `(marketing)` layout/page fetches branding → `MarketingHeader`, `MarketingFooter`, `DashboardPreview` render the real name + mark.
- **`components/branding/BrandMark.tsx`** (presentational): `{ companyName, logoUrl, size }` → `<img src={logoUrl} class="h-8 w-8 rounded-lg object-contain">` when a logo exists, else the accent monogram tile with `companyName[0]`. Wide logos letterbox inside the square mark (v1 tradeoff, noted).

## 3. Dashboard KPI permissions + new KPIs

**Pure visibility map — `lib/dashboard/visibility.ts`** (TDD): `dashboardVisibility(perms: Set<string>)` → a flags object (one boolean per widget key above). The page renders exclusively from these flags; `allHidden` → friendly empty state ("No dashboard widgets are enabled for you."). The "N active leads" page subtitle is gated by the `total_leads` flag (it leaks the same number).

**Pure metrics — `lib/dashboard/metrics.ts`** (TDD):
- `computeExtendedKpis(leads, followUps, tickets, now)` →
  - `closedRevenue` Σ `price_quoted` where status Closed
  - `recurringRevenue` Σ numeric(`yearly_price`) where status Closed (parse; skip "None"/non-numeric)
  - `avgDealSize` mean `price_quoted` over priced leads (any status; null if none)
  - `conversionRate` Closed ÷ total × 100 (0 when no leads)
  - `newThisWeek` `created_at ≥ now − 7d`
  - `overdueFollowUps` status ∈ (Ready, Long Term) && `follow_up_time < now`
  - `pickupRate` Pickups ÷ all follow-up logs × 100 (null if no logs → "—")
  - `openTickets` status ≠ Resolved; `overdueTickets` via existing `isOverdue()` from `lib/tickets/logic`
  - `avgResolutionHours` mean(`resolved_at − created_at`) over resolved tickets (null if none; UI formats <48h as "Xh", else "X.Yd")
- `revenueByStatus(leads)` → `[{name: status, value: Σ price_quoted}]` (page filters to the user's visible status categories, like the strip)
- `ticketStatusSplit(tickets)` → counts per lifecycle status
- **Change in `lib/leads/analytics.ts` `computeKpis`**: `quotedRevenue` sums **Ready only** (existing `tests/analytics.test.ts` expectations updated first, TDD).

**Data loading (`app/(app)/dashboard/page.tsx`):** keeps the RLS-scoped leads query (KPIs reflect what the user can see) and adds RLS-scoped `lead_follow_ups.select("fu_status")` and `lead_tickets.select("status, due_date, created_at, resolved_at")`.

**UI:**
- `KpiHero` — per-tile visibility props (Ready tile = `kpi.ready` flag **AND** the existing Ready-category visibility); Quoted Revenue subtitle → "from Ready leads".
- New `components/dashboard/StatGrid.tsx` — compact secondary tiles (responsive 2/3/5-col grid) rendering only the granted ones of the 10 new tiles.
- `components/dashboard/Charts.tsx` + `RevenueByStatus` (bar, status palette) and `TicketStatusDonut` (donut, ticket-status colors).
- Page composition: hero → StatGrid → strip → chart grids, every piece behind its flag; chart rows compact/reflow when pieces are revoked.

## Testing
- **Unit:** `dashboardVisibility` (mapping, all-false), `computeExtendedKpis` (empty sets, null prices, "None" yearly, pickupRate null, overdue edges), `revenueByStatus`/`ticketStatusSplit`, updated `computeKpis` Ready-only, `logoPublicUrl`/monogram fallback logic.
- **Live (Chrome MCP):** set company name + upload a logo (generated test PNG) → sidebar/login/tab-title update; remove logo → monogram returns; deny one KPI via a per-user override → tile disappears, grid reflows → remove override (leaves real perms untouched); dashboard renders all new tiles/charts with real data.

## Out of scope / deferred
Favicon upload; dark-mode logo variant; per-user dashboard personalization (ordering/layout); revenue-over-time by close date (no closed-at timestamp exists); pre-lead KPIs.
