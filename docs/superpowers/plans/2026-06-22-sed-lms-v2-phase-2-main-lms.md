# SED LMS v2 — Phase 2 (Main LMS) Implementation Plan

> **For agentic workers:** executed inline with checkpoints (continuation of Phase 1). Design contract: `docs/superpowers/specs/2026-06-21-sed-lms-v2-phase-1-2-design.md` §10. Patterns established in `2026-06-21-sed-lms-v2-phase-1-foundation.md`.

**Goal:** Build the management-side Main LMS — dashboard (curated KPIs + charts), the unified leads table, lead detail with inline editing, status changes, soft-delete, a new-lead form, the By-Agent view, and ⌘K business lookup — all permission-gated.

**Architecture:** Server components fetch leads via the Supabase server client; all mutations go through permission-checked Route Handlers using the service-role client (re-checking the resolved permission set), writing to `activity_log`. Interactive pieces (table, charts, filters, modals, command palette) are client components. Recharts renders charts (client-only), themed to the light Data Console palette via CSS-variable colors.

**Tech:** Next 16 / React 19, TanStack Table v8, Recharts 3, React Hook Form + Zod, Supabase.

---

## File Structure (Phase 2 additions)

```
lib/leads/
  types.ts          — Lead type, STATUSES, AGENTS-less (agents come from profiles), SITE_TYPES
  schema.ts         — createLeadSchema, updateLeadSchema (Zod)
  format.ts         — formatCurrency, formatDate, formatDateTimeLocal, maskPhone
  analytics.ts      — computeKpis(leads), chart aggregations (byStatus, byAgent, bySiteType, ratingDist, overTime, freshVsFollowup)
app/api/leads/
  route.ts          — GET list, POST create
  [id]/route.ts     — PATCH (edit/status), DELETE (soft)
app/(app)/leads/
  page.tsx          — server: fetch leads + agents → <LeadsTable>
  new/page.tsx      — new lead form
  [id]/page.tsx     — server: fetch lead + agents → <LeadDetail>
app/(app)/by-agent/page.tsx
components/leads/
  LeadsTable.tsx        — client, TanStack + toolbar + tabs + pagination
  StatusPill.tsx        — shared status badge
  LeadDetail.tsx        — client inline-edit form
  StatusChangeModal.tsx
  DeleteLeadModal.tsx
  NewLeadForm.tsx
components/dashboard/
  KpiHero.tsx, StatusStrip.tsx, charts/*.tsx (client Recharts)
components/layout/
  CommandPalette.tsx    — client ⌘K (wired into Topbar)
tests/
  leadSchema.test.ts, analytics.test.ts
```

---

## Shared conventions

- **Statuses:** `Ready | Not Ready | Closed | Dropped`. Long-Term is a follow-up view, not a stored status. Pill colors per spec tokens (`ready/notready/closed/dropped`).
- **Site types:** `Custom Website | Redesign | E-Commerce | Landing Page`.
- **Soft-delete:** every list query filters `deleted_at is null`; DELETE sets `deleted_at = now()`.
- **Permissions:** `leads.view` (see), `leads.create`, `leads.edit`, `leads.status_change`, `leads.delete`. Route Handlers re-check via `getUserPermissions`.

---

## Task P2-1 — Leads domain (TDD)

- `lib/leads/types.ts`: `Lead` interface (all columns), `LEAD_STATUSES`, `SITE_TYPES`, `STATUS_PILL` map (status → tailwind classes).
- `lib/leads/format.ts`: `formatCurrency(n)`, `formatDate(iso)`, `formatDateTimeLocal(iso)` (for datetime-local inputs), `maskPhone(s)`.
- `lib/leads/schema.ts`: `createLeadSchema` (business_name required; status default "Not Ready"; optional contact/site fields; arrays for services/areas; numeric price/rating coerced), `updateLeadSchema = createLeadSchema.partial()`.
- `lib/leads/analytics.ts`: pure functions over `Lead[]`:
  - `computeKpis`: total, ready, notReady, closed, dropped, freshCount, quotedRevenue (Σ price_quoted), avgRating.
  - `byStatus`, `byAgent(leads, agentNameById)`, `bySiteType`, `ratingDistribution` (1–10 buckets), `leadsOverTime` (group by day/week), `freshVsFollowup`.
- **Tests:** `analytics.test.ts` (computeKpis on a fixture: revenue sum, avg rating, status counts), `leadSchema.test.ts` (rejects missing business_name; coerces price; accepts valid).

## Task P2-2 — Demo data seed

Via service-role SQL (same pattern as the bootstrap admin, with token-column fix): create 4 demo agents (Alex, Sam, Evan, Erick) `@sed.demo` in the **Sales** department, then insert ~16 leads spread across statuses, agents, site types, prices, ratings, and `created_at` over the last ~6 weeks (some with `follow_up_time`, mix of Fresh/Follow Up). Tag obviously demo (e.g. business names). Document how to wipe (`delete from leads; delete demo agents`).

## Task P2-3 — Leads API routes

`app/api/leads/route.ts`:
- `GET`: auth + `leads.view`; returns non-deleted leads (ordered by created_at desc).
- `POST`: auth + `leads.create`; validate `createLeadSchema`; insert with `created_by`; activity_log `lead.created`; return `{id}`.

`app/api/leads/[id]/route.ts`:
- `PATCH`: auth; if body has only `status` → require `leads.status_change`, else require `leads.edit`; validate `updateLeadSchema`; update; activity_log `lead.updated`/`lead.status_changed` with old/new.
- `DELETE`: auth + `leads.delete`; set `deleted_at = now()`; activity_log `lead.deleted`.

All use `createAdminClient` after the permission check (consistent with Phase 1 admin routes).

## Task P2-4 — Dashboard

Server page fetches non-deleted leads + a `agentNameById` map (from profiles). Computes KPIs/aggregations server-side, passes plain data to client chart components.
- `KpiHero`: 4 cards — Total Leads (+ new-this-week), Quoted Revenue, Ready (% of total), Avg Rating (/8 display).
- `StatusStrip`: Ready/Not Ready/Closed/Dropped with count + share bar.
- Charts (client, Recharts, themed): `LeadsOverTime` (area), `LeadsByAgent` (bar), `StatusDonut`, `SiteTypeDonut`, `RatingBars`. Fresh-vs-Followup as a compact segmented stat.
- Recharts theming: teal `#0D9488` + status colors; axis/grid use `--border`/`--text-faint`; `ResponsiveContainer`. Empty-state copy when no leads.

## Task P2-5 — Leads table

`LeadsTable` (client): TanStack `useReactTable` with columns Date, Status (pill), Agent, Type, Business+Email, Phone, Price, Follow-up, Rating, Actions. Toolbar: search box (global filter on business/email/agent/status), status **tabs** (All/Ready/Not Ready/Closed/Dropped with live counts), agent + type `<select>` filters, sort menu, result count. Client pagination (page size 15), sticky header. Row Actions: "Detail" (link `/leads/[id]`) and "Status" (opens StatusChangeModal). Header has "+ New Lead" (gated).

## Task P2-6 — Lead detail + modals

`/leads/[id]` server-fetches the lead + agents → `LeadDetail` (client). Grouped sections mirroring the audit: Business Info, Images (textarea→array), Lead Info (agent/status/site_type/price/rating/fresh selects), Services & Scope (arrays + numbers), Follow-up & Notes (datetime-local, comments). Tracks dirty fields; **Save** PATCHes only changed fields; **Refresh** re-fetches (router.refresh); **Change Status** → `StatusChangeModal`; **Delete** → `DeleteLeadModal` (checkbox confirm → DELETE → redirect to /leads). Edit controls gated on `leads.edit`; delete on `leads.delete`.

## Task P2-7 — New Lead form

`/leads/new` → `NewLeadForm` (RHF+Zod, `createLeadSchema`): core fields (business name/phone/email/profile, site type, agent, status, price, services, follow-up, comments). POST `/api/leads` → redirect to the new lead's detail. Gated on `leads.create`.

## Task P2-8 — By-Agent

`/by-agent` server-fetches leads + agents; groups by agent → cards (avatar initials, totals, Ready/Closed counts, quoted revenue, a mini 5-row table) with a link to `/leads?agent=<name>`.

## Task P2-9 — ⌘K Business Lookup

`CommandPalette` (client) mounted in the authenticated shell; `⌘K`/`Ctrl+K` opens an overlay input; fetches `/api/leads` (or receives a lightweight list) and fuzzy-filters business/email/phone; Enter/click → `/leads/[id]`. Topbar search affordance triggers it.

## Task P2-10 — Verify & commit

`npx vitest run` (Phase 1 + new) green; `npm run build` green; dev smoke: authenticated `/dashboard`, `/leads`, `/leads/[id]`, `/by-agent` render with demo data; status change + soft-delete work. Commit.

---

## Self-review
- Spec §10 coverage: dashboard KPIs+charts (P2-4), leads table w/ toolbar (P2-5), lead detail inline edit (P2-6), status change + soft-delete modals (P2-6), By-Agent (P2-8), business lookup (P2-9), new lead (P2-7), API/soft-delete (P2-3). ✅
- Permissions enforced server-side on every mutation (P2-3) and gated in UI.
- Demo data (P2-2) makes all views verifiable without waiting for real data.
