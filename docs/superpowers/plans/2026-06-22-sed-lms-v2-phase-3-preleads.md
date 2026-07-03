# SED LMS v2 — Phase 3 (Pre-Lead System) Implementation Plan

> Continuation of Phases 1–2. Feature reference: audit §5C (`prelead-dashboard.html`) + architecture Phase 3. Built foundation-inline, then UI fanned out via a Workflow (parallel subagents).

**Goal:** The agent-facing pre-lead pipeline — capture prospective leads, categorize them, run the follow-up loop, and see pipeline analytics — integrated into the unified app shell and gated by the `pre_leads.*` permissions.

**Scope:** pre-lead domain + API, an analytics overview, a unified All-Pre-Leads table, an add form, follow-up + quick-view modals, a world-clocks widget, and a follow-ups-due notification bell. Agent data is RLS-scoped (an agent sees only their own pre-leads; admins see all).

## Design Authority (IA decisions)
The old agent dashboard had a separate sidebar with ~15 sections (one per category, one per follow-up state, plus analytics/add/upfront/ready-websites). v2 collapses that into:
- **Pre-Leads → Overview** (`/pre-leads`): KPIs, category distribution, service split, follow-ups due, recent activity, world clocks.
- **Pre-Leads → All Pre-Leads** (`/pre-leads/all`): one table with **category tabs** (All + 6 categories) + status filter + **follow-up quick filter** (Due 24h / Past due) + search; row actions Quick View / Follow-up / Delete.
- **New pre-lead** (`/pre-leads/new`): add form.
- **Notification bell** (topbar): follow-ups due in the next 24h.
"Upfront" remains a category; the standalone upfront-to-main-lead wizard is deferred (a future "convert to lead" action).

## Foundation (built inline)
- `lib/preleads/types.ts` — `PreLead`, `LEAD_CATEGORIES` (Strong/Weak/Mockup/Long Term/Upfront/Call Backs), `PRELEAD_STATUSES` (Next follow up/Closed/Dropped), service consts, pill maps.
- `lib/preleads/schema.ts` — create/update + `followUpSchema` (Zod).
- `lib/preleads/analytics.ts` — `computePreLeadKpis`, `categoryDistribution`, `serviceSplit`, `followUpsDue`, `recentPreLeads`.
- `app/api/pre-leads/route.ts` (GET scoped via RLS + `pre_leads.view`; POST + `pre_leads.create`, sets `agent_id = self`).
- `app/api/pre-leads/[id]/route.ts` (PATCH: follow-up keys → `pre_leads.followup`, else `pre_leads.edit`; DELETE → `pre_leads.delete` soft-delete). All audit-logged.
- `components/preleads/CategoryPill.tsx` — `CategoryPill`, `PreLeadStatusPill`.
- Sidebar: "Pre-Leads" nav group (gated `pre_leads.view`), longest-prefix active match.
- Demo: 12 pre-leads across the 4 demo agents/categories/follow-up windows.

## UI (Workflow fan-out)
**Components:** `FollowUpModal`, `QuickViewModal`, `AddPreLeadForm`, `PreLeadsTable` (TanStack, mirrors `LeadsTable`), `PreLeadOverview`, `layout/WorldClocks`, `layout/NotificationBell`.
**Pages:** `/pre-leads`, `/pre-leads/all`, `/pre-leads/new`.
Each subagent read the foundation files + canonical leads components for house style and wrote exactly one file.

## Integration & verification (P3-5)
Wire `NotificationBell` into the Topbar (inline); `npx vitest run` + `next build` green; RLS data check; adversarial review pass; commit.
