# SED LMS v2 — Phase 1 & 2 Design Spec

- **Date:** 2026-06-21
- **Status:** Approved for spec review
- **Project:** Social Expert Digital — Lead Management System, v2 (ground-up rebuild)
- **Source of truth for features:** "Dashboard feature audit" session (complete inventory of the old vanilla-HTML/Express/Google-Sheets LMS)

---

## 1. Purpose & Goals

The old LMS is statically "vibe-coded": adding a user, a field, or a department means editing code and redeploying. v2 rebuilds the **same feature set** on a systematic, production-ready, future-expandable stack where **everything is controlled from the dashboard** — users, departments, and feature permissions included.

**Goals**
1. Reproduce every feature from the audit (nothing lost).
2. Make users, departments, and permissions fully admin-manageable — no code edits.
3. Replace Google Sheets with Postgres (typed columns, constraints, soft-delete, audit trail).
4. Ship a polished, light-theme, accessible UI.
5. Build a foundation that later phases (pre-leads, AI tools, analytics, realtime) extend without rework.

### Design Authority
The audit is the **feature checklist** — the authoritative list of *what must exist* (fields, statuses, KPIs, actions, routes). The **information architecture, visual hierarchy, navigation structure, KPI/chart curation, and component design are decided in this spec** to be best-in-class, not a 1:1 copy of the old layout. Where this spec diverges from the old structure, the divergence is intentional and noted.

---

## 2. Scope

### In scope — Phase 1 (Foundation)
- Next.js 14 app scaffold (TypeScript, App Router, Tailwind, shadcn/ui)
- Supabase project + migrations for the full Phase 1–2 schema (plus forward-looking tables)
- Auth: email/password via Supabase Auth; **admin-created users with a temporary password** (no public signup, no SMTP dependency)
- Session middleware (cookie refresh)
- 3-layer permission engine (resolver + context provider + `usePermissions` hook + `<PermissionGate>`)
- Permission-aware app shell (sidebar + topbar)
- **Admin panel:** Users, Departments, Permissions (full CRUD + toggle grids + overrides)
- Seed migration: permission catalogue, default departments, default department→permission mapping, one bootstrap admin

### In scope — Phase 2 (Main LMS / management side)
- Dashboard: curated KPI hierarchy + charts
- Leads: unified table (search, filter, sort, paginate) with status tabs
- Lead detail: inline-edit panel for all field groups
- Status-change flow + soft-delete (with confirmation)
- By-Agent view
- Business Lookup (global search)
- New Lead create form

### Out of scope (future phases — schema accommodates them)
- **Phase 3:** Agent-facing Pre-Lead dashboards, follow-up system, world clocks, notification bell, upfront multi-section intake wizard.
- **Phase 4:** WebCraft + DeepSeek AI generators and their analytics.
- **Phase 5:** Activity-log UI, CSV export, Supabase Realtime, **Google Sheets → Supabase importer** (data migration deferred per decision).

---

## 3. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router, TS) | RSC + Route Handlers |
| Styling | Tailwind CSS + shadcn/ui | themed to light Data Console look |
| DB / Auth | Supabase (Postgres 17 + Auth + RLS) | new free project, region `ap-southeast-1` |
| Tables | TanStack Table v8 | client sort/filter/paginate |
| Charts | Recharts | themed light; tabular feel |
| Forms | React Hook Form + Zod | type-safe validation |
| Data access | Supabase server client | service-role only in protected Route Handlers |
| Testing | Vitest + RTL; Playwright | resolver + handlers + login smoke |

---

## 4. Location & Repository
- New directory: **`D:\sed-lms-v2`** (the old project at `D:\Old LMS Dashboard\sed-lms` is never modified).
- Fresh local `git init`; user creates and connects the remote.
- `.gitignore` covers `node_modules`, `.next`, `.env*`, `.superpowers/`.
- Supabase project name `sed-lms-v2` ($0/mo on current plan).

---

## 5. Design System (Light — "Data Console / Teal")

Chosen via visual companion: dense, scannable, dividers over heavy shadows, cool-gray canvas, teal accent.

### Tokens
| Token | Value | Use |
|---|---|---|
| `--bg` | `#EEF1F5` | app canvas |
| `--surface` | `#FFFFFF` | cards, panels, table |
| `--surface-2` | `#FBFCFD` | sidebar, subtle fills |
| `--border` | `#DDE2EA` | card/table borders, dividers |
| `--border-subtle` | `#EEF1F5` | inner row dividers |
| `--text` | `#141B2D` | primary text |
| `--text-muted` | `#5A6377` | secondary |
| `--text-faint` | `#8089A0` | labels, captions |
| `--accent` | `#0D9488` | nav-active, buttons, links, focus, chart bars, KPI deltas |
| `--accent-soft` | `#DFF5F2` | active-nav bg, tags |
| `--accent-ink` | `#0F766E` | accent text on soft bg |

### Status colors (semantic, fixed) — soft-bg pills
| Status | Text | Bg |
|---|---|---|
| Ready | `#15803D` | `#DCFCE7` |
| Not Ready | `#B45309` | `#FEF3C7` |
| Closed | `#7E22CE` | `#F3E8FF` |
| Dropped | `#B91C1C` | `#FEE2E2` |
| Long-Term | `#1D4ED8` | `#E8F0FE` |

### Typography
- **Inter** — all UI text. **JetBrains Mono** — numbers, IDs, prices, counts (tabular numerals in tables/KPIs).
- Scale: page title 20–24, section 14–15 semibold, body 13–14, label 10–11 uppercase tracked.

### Form & density rules
- Radii 6–8px; compact table rows (~36–40px); sticky table headers.
- Inputs: 1px `--border`, focus ring `--accent` at 2px + soft halo.
- Buttons: primary = accent solid; secondary = surface + border; destructive = red.
- All interactive elements keyboard-navigable; **WCAG AA** contrast minimum; visible focus states.

---

## 6. Information Architecture (optimized — design authority)

The old app had **one sidebar item per status** (Ready, Not Ready, Closed, Dropped, Long Term) plus By Agent, Lookup, and tool/analytics items. v2 consolidates:

**Sidebar (permission-gated):**
- **Dashboard** — `analytics.view`
- **Leads** — `leads.view` — unified table; status surfaced as **tabs/segmented filter** (All · Ready · Not Ready · Closed · Dropped · Long-Term) with live counts, not separate pages
- **By Agent** — `analytics.view` — per-agent performance + drill-in
- **Admin** (section) — Users `admin.users.view` · Departments `admin.departments.manage` · Permissions `admin.permissions.manage`

**Topbar:**
- Global **Business Lookup** as ⌘K command-search (replaces the standalone Lookup page; still reachable as a feature)
- User menu (profile, change password, logout)
- "+ New Lead" primary action (gated on `leads.create`)

*Future phases append their own nav groups (Pre-Leads, AI Tools, Analytics) without disturbing this structure.*

---

## 7. Data Model (Postgres)

All tables in `public`, RLS enabled. Timestamps `timestamptz default now()`. UUID PKs.

### Identity & access
- **`profiles`** — extends `auth.users`: `id` (FK auth.users), `email` unique, `full_name`, `display_name`, `avatar_url`, `is_active`, `created_by`, timestamps.
- **`departments`** — `id`, `name` unique, `slug` unique, `description`, `color`, `icon`, `is_active`.
- **`department_members`** — `user_id`, `department_id`, `dept_role` (`member|lead|manager`), `added_by`, unique(user, dept).
- **`permissions`** — `key` PK (e.g. `leads.view`), `name`, `description`, `category`, `is_sensitive`.
- **`department_permissions`** — `department_id`, `permission_key`, unique(dept, key).
- **`user_permission_overrides`** — `user_id`, `permission_key`, `is_granted` (true=grant / false=revoke), `reason`, `expires_at`, unique(user, key).

### LMS data
- **`leads`** — typed columns for all 28 audited fields: status, agent_id, business_name, business_phone, business_email, business_profile_link, website_link, logo_link, map_embed_link, site_type, platform, `services text[]`, `service_areas text[]`, has_service_areas, client_experience int, num_webpages int, `specify_pages text[]`, color_scheme, price_quoted numeric, yearly_price, follow_up_time, direct_line_saved bool, fresh_or_followup, reference_link, `image_links text[]`, rating smallint (1–10), comments, created_by, created_at, updated_at, **`deleted_at`** (soft delete).
- **`pre_leads`** — full pre-lead schema (built now for completeness, UI in Phase 3).
- **`ai_generations`** — webcraft/deepseek logging (built now, UI Phase 4).
- **`activity_log`** — `user_id`, `action`, `entity_type`, `entity_id`, `old_value jsonb`, `new_value jsonb`, `created_at` (written by mutations now; UI Phase 5).

### Permission resolution
`FINAL = (∪ all dept permissions for the user's departments) + user grants − user revokes` (expired overrides ignored). Computed server-side; cached per request.

---

## 8. Permission Catalogue & Default Mapping

Catalogue (seeded): `leads.{view,create,edit,delete,status_change,view_all,export}`, `pre_leads.{view,create,edit,delete,followup}`, `analytics.{view,view_webcraft,view_deepseek,view_all_agents}`, `ai_tools.{webcraft,deepseek}`, `admin.{users.view,users.create,users.edit,users.deactivate,departments.manage,permissions.manage,logs.view}`.

Default department→permission mapping (Sales / Management / Tech / Support / Admin) seeded exactly as in the audit session's matrix. Admin department holds `admin.*`.

---

## 9. Phase 1 — Detailed Deliverables

1. **Scaffold:** Next.js + TS + Tailwind + shadcn/ui; design tokens wired into Tailwind theme + CSS variables; base layout primitives (Button, Input, Select, Dialog, Table, Badge, Card, Tabs, Toast).
2. **Supabase:** project created; migrations for all §7 tables; RLS policies; seed (permissions, departments, mapping, bootstrap admin).
3. **Auth:** login page (email/password); session middleware; sign-out; change-password.
4. **Permission engine:** `resolver.ts` (server), `usePermissions` hook, `<PermissionGate>`, server-side guards for Route Handlers.
5. **App shell:** sidebar (permission-filtered nav + live counts), topbar (search, user menu, primary action), responsive.
6. **Admin → Users:** list (name, email, dept badges, status, created); create (email + temp password + dept assignment); edit profile; assign/remove departments; per-user overrides (grant/revoke, optional expiry); activate/deactivate.
7. **Admin → Departments:** list (member + permission counts); create/edit; members tab (add/remove, set dept_role); permissions tab (toggle grid of full catalogue).
8. **Admin → Permissions:** read-only catalogue grouped by category, showing which departments grant each.

## 10. Phase 2 — Detailed Deliverables

**Dashboard (curated hierarchy — design authority):**
- **Hero KPI row (4):** Total Leads (+ trend vs last period), Quoted Revenue (+ trend), Ready (conversion-ready % of total), Avg Rating (/8 or /10 normalized).
- **Status breakdown strip:** Ready / Not Ready / Closed / Dropped / Long-Term — count + share bar each.
- **Charts:** (1) **Leads over time** (area/line — new; directly answers "is it getting better/worse"), (2) Leads by Agent (bar), (3) Status distribution (donut), (4) Site-Type split (donut), (5) Rating distribution (bar). Fresh-vs-Follow-up shown as a compact segmented stat rather than a full chart.

**Leads table:** toolbar (search by business/email/agent/status; filters: status tab, agent, site-type; sort: follow-up/rating/price/date asc-desc; result count); columns: Date, Status (pill), Agent (avatar+name), Type, Business+Email, Phone, Price, Follow-up, Rating, Actions (Detail / Status). Pagination (server-friendly), sticky header.

**Lead detail (inline edit):** grouped sections — Business Info, Images, Lead Info, Services & Scope, Follow-up & Notes — all fields from the audit; actions: Refresh, Save (PATCH changed fields), Change Status, Delete (soft). (AI-tool actions deferred to Phase 4.)

**Status-change modal**, **delete-confirm modal** (typed/checkbox confirm → set `deleted_at`), **By-Agent view** (per-agent card: totals, ready/closed, mini table + drill-in), **Business Lookup** (⌘K global search → detail), **New Lead form** (RHF + Zod; creates a lead).

---

## 11. Auth / Onboarding Flow
1. Admin opens **Admin → Users → Create**, enters email + display name, assigns department(s), sets a temporary password.
2. Server Route Handler (service role) creates the `auth.users` record (email confirmed) + `profiles` row.
3. User logs in with the temp password; can change it from the user menu.
4. No public signup. Deactivation flips `is_active` and blocks login.

---

## 12. Testing Strategy
- **Unit (Vitest):** permission resolver (union + grant − revoke, expiry) — the highest-risk logic; Zod schemas; formatters.
- **Component (RTL):** `<PermissionGate>`, sidebar nav filtering, leads table filter/sort.
- **Route Handlers:** auth guard + permission guard behavior; admin user-create happy and error paths.
- **E2E (Playwright):** login → permission-filtered nav → open a lead → change status.
- **TDD** applied to the resolver and Route Handlers (tests first).

---

## 13. Risks & Mitigations
- **Permission resolver correctness** → TDD + exhaustive unit tests; server re-checks on every mutation.
- **Service-role key exposure** → only in server Route Handlers; never shipped to client; in `.env` (gitignored).
- **Scope creep from later phases** → tables exist but UIs are explicitly deferred; nav structure reserves space.
- **Light-theme contrast** → AA contrast audited on tokens; status pills tested against white + canvas.

---

## 14. Definition of Done (Phase 1 & 2)
- Admin can create users/departments and toggle permissions entirely from the UI; nav and actions reflect permissions live.
- A management user can view, search/filter/sort, edit inline, change status, soft-delete, and create leads; dashboard KPIs/charts render from real data.
- All listed tests pass; `npm run build` clean; AA contrast verified on core screens.
