# SED LMS v2 — Full Project Audit

**Date:** 2026-06-30
**Repo:** `D:\sed-lms-v2` · branch `main` · remote `github.com/socialexpertdigitalllc-art/sed-lms-v2`
**Status:** All five planned phases feature-complete · build green · 95/95 unit tests · live-verified.

---

## 1. Environment & Working Directory

| | |
|---|---|
| **Working directory** | `D:\sed-lms-v2` (all v2 work lives here) |
| **Legacy reference app** | `D:\Old LMS Dashboard\sed-lms` — the OLD vanilla-HTML/Express/Google-Sheets system. Read-only reference; never modified. |
| **Git** | branch `main` · single "first commit" `4dd5ffa` · working tree clean |
| **GitHub remote** | `origin → github.com/socialexpertdigitalllc-art/sed-lms-v2.git` |
| **Supabase project** | `sed-lms-v2`, id `ikuvbxjkoojtgekapbul`, region ap-southeast-1 (Singapore), free tier |
| **Bootstrap admin** | `admin@sedsolutions.online` / `SedAdmin#2026` (username `admin`) |
| **Dev server** | `npm run dev` → http://localhost:3000 |
| **Codebase size** | 152 TS/TSX files · 25 pages · 23 API routes · 39 components · 37 lib files · 13 test files · 9 migrations |

> **Note on git history:** the full per-phase commit history (the `phase-1-foundation` branch, ~60 commits) was squashed into a single "first commit" on `main` and pushed to GitHub. The code is 100% intact — all Phases 1–5 are present in the working tree — but the granular history now lives narratively in `docs/superpowers/` specs/plans rather than in git.

**Tech stack:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 (CSS-first `@theme`) · Supabase (Postgres + Auth + RLS + Realtime + Storage) · TanStack Table · Recharts · React-Hook-Form + Zod · `googleapis` · Vitest (unit) + Playwright (e2e scaffold).

**Design language:** "Data Console" — light theme, cool-gray canvas `#EEF1F5`, white surfaces, dividers-over-shadows, teal accent `#0D9488`, Inter (UI) + JetBrains Mono (numbers) + Bricolage (display). Fixed status colors (Ready=green, Not Ready=amber, Closed=purple, Dropped=red).

---

## 2. Directory Structure

```
D:\sed-lms-v2\
├── app/
│   ├── (marketing)/          # public landing + /docs
│   ├── login/                # auth
│   ├── (app)/                # authenticated area (AppShell: sidebar + topbar)
│   │   ├── dashboard, leads, by-agent, pre-leads, account
│   │   ├── ai-tools/         # overview, webcraft, deepseek, analytics, wge, generations/[id]
│   │   └── admin/            # users, departments, permissions, logs, import
│   └── api/                  # 23 route handlers (leads, pre-leads, ai-tools, admin, activity)
├── components/    (39)       # layout, leads, preleads, dashboard, admin, ai-tools, shared
├── lib/           (37)       # supabase clients, permissions, leads, preleads, ai-tools, import, activity
├── hooks/                    # usePermissions, useRealtimeRefresh
├── providers/                # PermissionProvider, ActivityTracker
├── supabase/migrations/ (9)  # 0001–0010 schema
├── docs/superpowers/         # specs + plans for every phase
├── instrumentation.ts        # WGE-2 processor poller
├── middleware.ts             # auth gate (+ /process exemption)
└── e2e/, tests/              # Playwright + Vitest
```

**Routes — 25 pages:** `(marketing)/`, `(marketing)/docs`, `login`, `(app)/dashboard`, `leads`, `leads/new`, `leads/[id]`, `by-agent`, `pre-leads`, `pre-leads/all`, `pre-leads/new`, `account`, `ai-tools`, `ai-tools/webcraft`, `ai-tools/deepseek`, `ai-tools/analytics`, `ai-tools/wge`, `ai-tools/generations/[id]`, `admin/users`, `admin/users/[id]`, `admin/departments`, `admin/departments/[id]`, `admin/permissions`, `admin/logs`, `admin/import`.

**Routes — 23 API handlers:** `account`, `activity/track`, `leads`, `leads/[id]`, `pre-leads`, `pre-leads/[id]`, `admin/users` (+`[id]`, `[id]/overrides`), `admin/departments/[id]/permissions`, `admin/import/{config,preview,run}`, `ai-tools/prefill`, `ai-tools/[tool]/{generate,save}`, `ai-tools/wge` (+`reset`, `process`, `queue`, `queue/[id]`, `queue/[id]/retry`).

---

## 3. What We've Done (all planned phases complete)

### Phase 1 — Foundation
Next.js + Supabase scaffold, Supabase Auth login (email *or* username), session middleware, and a 3-layer RBAC permission system (`FINAL = union(dept perms) + user grants − user revokes`, TDD'd resolver). Admin panel: invite users + set temp password, department management, permission toggle grid. Public marketing landing page + documentation.

### Phase 2 — Main LMS
Dashboard with KPI hero + charts (leads-over-time, pipeline donut, by-agent, site-type, rating). Unified Leads table (TanStack: sort/filter/paginate + status tabs). Lead detail page with inline editing, status-change flow with soft-delete (`deleted_at`), By-Agent view, and ⌘K business lookup.

### Phase 3 — Pre-Lead System
Agent pre-lead overview + table, add/follow-up/quick-view modals, world clocks, and a notification bell (overdue + due-24h follow-ups).

### Mid-project polish
Admin reset/delete user, self-service `/account` page, topbar user menu, per-user lead scoping (RLS: agents see only their leads unless `leads.view_all`), and username login.

### Phase 4 — AI Tools (WebCraft + DeepSeek generators)
Two website generators with server-side streaming (API keys never reach the client), 3-step flow (details → editable prompt → live stream + preview), multi-file parser, ZIP download, files persisted to a private Supabase Storage bucket, an analytics dashboard (KPIs + charts + history + per-generation detail/preview), and auto-fill from a lead.

### WGE-1 — Website Engine Control (`/ai-tools/wge`)
Admin command-center making generation fully config-driven — nothing hardcoded. A `wge_config` singleton holds the editable system prompt, prompt template (`{{key|fallback}}` engine), variable + lead-column mapping, and engine settings. Three tabs (Prompt Studio with test-render, Variables & Mapping, Engine Settings). New dependent permission `wge.manage` (requires `ai_tools.*`).

### WGE-2 — Automation (queue + auto-generate)
A `wge_queue` + serial in-app processor (Postgres advisory-lock, one generation at a time), auto-enqueue on lead submit when "ready", a manual "Queue for generation" button, a queue-management tab (retry/cancel), an `instrumentation.ts` poller safety-net, and notification-bell alerts on completion.

### Phase 5 — Logs, CSV, Realtime, Importer
1. **User-movement tracker** — client `ActivityTracker` logs page-views + labeled clicks + tab-focus into `user_activity` (90-day auto-prune) + a combined Activity Log viewer (`/admin/logs`, Audit + User Activity tabs).
2. **CSV export** of the filtered leads table.
3. **Realtime** — leads/pre-leads/queue auto-refresh via Supabase Realtime.
4. **Google Sheets importer** (`/admin/import`) — reuses the old service account, editable+persisted column mapping, preview→import, dedupe, agent resolution.

---

## 4. Data Model & Security

**14 tables** (Postgres, all RLS-enabled):

| Table | Approx rows | Purpose |
|---|---|---|
| `profiles` | 8 | users (extends auth.users) |
| `departments` / `department_members` | 5 / 8 | RBAC groups |
| `permissions` / `department_permissions` / `user_permission_overrides` | 28 / 60 / 6 | the 3-layer RBAC |
| `leads` | 16 | main lead records (demo data) |
| `pre_leads` | 12 | agent pre-leads (demo) |
| `ai_generations` | 1 | generated-website records |
| `wge_config` / `wge_queue` | 1 / 0 | engine config + automation queue |
| `activity_log` | 32 | audited mutations |
| `user_activity` | 49 | raw movement tracker |
| `import_config` | 1 | Sheets-import mapping |

**Migrations 0001–0010** (0002 = seed): core schema, FK on-delete rules, lead scoping, username, ai_tools, wge, wge_queue, phase5, realtime replica-identity.

**28 permissions** across `leads`, `pre_leads`, `analytics`, `ai_tools`, `admin` categories. Security posture (validated by an adversarial-review workflow): service-role writes behind permission guards, RLS scoping, no secret leakage, dependent-permission enforcement in nav + page + API.

**Runtime deps:** `next@16.2.9`, `react@19.2.4`, `@supabase/{ssr,supabase-js}`, `@tanstack/react-table`, `recharts`, `react-hook-form`, `zod`, `googleapis`, `date-fns`, `lucide-react`, tailwind utils.

**Env (gitignored `.env.local`):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `KIMI_API_KEY`, `DEEPSEEK_API_KEY`, `WGE_PROCESSOR_SECRET`, `WGE_SELF_ORIGIN`, `GOOGLE_SERVICE_ACCOUNT_JSON`.

---

## 5. Current State (verification)

- Build green (production `next build` compiles all routes).
- 95/95 unit tests pass (13 test files).
- Live-verified in Chrome across every phase, including Phase 5's tracker, logs, CSV, realtime, and a real Sheets preview (read 348 rows).
- Quality gates: each phase built subagent-driven with per-task + final review; Phase 5 also passed a 4-lens adversarial-review workflow (5 real issues found → all fixed).

---

## 6. What We're Onto

A full item-by-item polishing pass of the dashboard — walking the app screen by screen (dashboard → leads → pre-leads → AI tools → WGE → admin) to refine UX, visual consistency, empty/loading/error states, responsiveness, micro-interactions, copy, and accessibility.

---

## 7. What Remains

### A. Action items (yours, not code)
1. **Top up the Moonshot/Kimi account** — it's suspended, so WebCraft generations fail until funded. (DeepSeek works.)
2. **Run the real Sheets import** — only verified via preview so far (345 new leads waiting); click Import on `/admin/import` to populate the DB (currently only demo data: 16 leads).
3. **Flip `auto_generate` ON** in WGE → Engine Settings for lead-submit auto-generation (currently OFF; each ready lead ≈ one DeepSeek gen).
4. Decide on **demo-data cleanup** — the `@sed.demo` agents + demo leads/pre-leads are removable before going live.

### B. The polishing pass (about to do)
Screen-by-screen refinement — prioritized punch-list to be produced at kickoff. Candidates: consistent loading/skeleton states, empty states, toast notifications instead of inline banners, mobile responsiveness, keyboard/a11y, chart polish, copy tightening.

### C. Known smaller gaps / future enhancements (optional)
- Realtime works but each list-view component opens its own channel; could consolidate.
- The importer currently handles the leads tab only (pre-leads/analytics tabs could be added).
- Deployment — nothing is deployed yet (self-hosted dev only); a production deploy (host + prod Supabase env) is a future step.
- Playwright e2e suite is scaffolded but thin (unit coverage is the strength).
- Future/unplanned: activity-log CSV export, scheduled Sheets sync, per-lead engine override, mobile app.

---

**Bottom line:** the v2 rebuild is feature-complete across all five planned phases, on `main`, tested, and pushed to GitHub. Nothing blocks the polishing pass.
