# Deployment System & Dashboard Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the deployment boards into Site Builder with hosting-wide subdomain management (categories, shuffle, versioned rewrites, custom-domain go-live, bulk delete), plus sidebar submenus, follow-up page filters, ticket improvements, notification fixes, and dashboard-wide multiselect filters — then deploy to prod and run a UX review.

**Architecture:** All deployment features extend the existing v3 `studio_deployments` system (DirectAdmin for `*.dmviral.com` staging subdomains, Hostinger REST + local fs for custom domains). The legacy template-engine "Deployed Sites" page is retired (redirect). Hosting truth is merged with DB truth at read time: `GET /api/site-studio/deployments` returns tracked rows plus untracked hosting subdomains, categorized. New naming scheme `{first-2-words≤20ch}v{N}.dmviral.com` with version parsing for shuffle/rewrite. Notifications gain a `website_url` column; follow-up reminders gain per-user status selection via the dormant `user_notification_settings` table.

**Tech Stack:** Next.js App Router, Supabase (service-role writes, RLS reads), DirectAdmin HTTP API, Hostinger REST API, TanStack Table, vitest.

---

## Key existing files (from exploration)

- DirectAdmin client: `lib/template-engine/directadmin.ts` (createSubdomain:124, deleteSubdomain:133, subdomainExists:142, archiveDocroot:204, clearDocroot:256, uploadZipAndExtract:271)
- Hostinger client: `lib/hostinger/client.ts` (listDomains:67, getWebsite:96, ensureWebsite:113, deleteWebsite:134); fs deploy: `lib/template-engine/fsDeploy.ts`
- Deployments API: `app/api/site-studio/deployments/route.ts` (GET), `[id]/route.ts` (DELETE takedown/record), `[id]/transfer/route.ts` (POST custom domain)
- Board UI: `components/site-studio/DeploymentsBoard.tsx` (mounted by BOTH site-builder & site-studio deployments pages)
- Legacy page: `app/(app)/ai-tools/template-engine/deployments/page.tsx` + `components/template-engine/wizard/UploadSitePanel.tsx` + upload API `app/api/template-engine/deployments/upload/route.ts`
- Slug rules: `lib/site-studio/deploy/slug.ts` (resolveSubdomain:92, dnsSafe:48); deploys: `lib/site-builder/deploy.ts`, `lib/site-studio/deploy/deployRun.ts`
- Sidebar: `components/layout/Sidebar.tsx` (flat NavItem arrays; Deployed Sites at :58); tabs: `components/site-builder/BuilderTabs.tsx`, `components/site-studio/StudioTabs.tsx`
- Follow-ups: `components/leads/FollowUpQueue.tsx` (no filters), `components/leads/FollowUpModal.tsx` (QUICK_MINUTE_PRESETS:12), API `app/api/leads/[id]/follow-ups/route.ts`
- Tickets: `components/tickets/TicketQueue.tsx`, `app/(app)/tickets/page.tsx`, detail `app/(app)/tickets/[id]/page.tsx` (lead select :78-82 lacks website_link), gate `lib/tickets/logic.ts:16` aliases `isFollowUpEligible`
- Nav counts: `hooks/useNavCounts.ts` (no polling/focus refresh), `app/api/nav-counts/route.ts`
- Notifications: `components/layout/BellBase.tsx` (slice(0,8) at :145), `app/api/notifications/route.ts` (limit 50), `lib/notifications/notify.ts`, events `lib/notifications/events.ts`, generate poller `app/api/notifications/generate/route.ts` (hardcoded Ready/Long Term :31)
- Multiselect reference: `components/leads/RegionFilter.tsx`; filter state: `hooks/useViewState.ts` (comma-join convention)
- View state pages: `components/leads/LeadsTable.tsx`, `components/preleads/PreLeadsTable.tsx`, `components/dashboard/DashboardBoard.tsx`, `components/feedback/FeedbackList.tsx`, `components/notifications/NotificationInbox.tsx`, `components/admin/LogsViewer.tsx`

---

## Phase A — Shared primitives

### Task A1: `MultiSelect` common component

**Files:** Create `components/common/MultiSelect.tsx`; Modify `components/leads/RegionFilter.tsx`, `components/leads/TagFilter.tsx` later consumers.

Generic popover-checkbox multiselect extracted from `RegionFilter.tsx` anatomy (open state + outside-mousedown close + `Label · N` trigger + Clear). Props:

```ts
type Option = { value: string; label?: string; count?: number };
export default function MultiSelect({ label, options, selected, onChange, icon, align = "left" }: {
  label: string; options: Option[]; selected: string[];
  onChange: (next: string[]) => void; icon?: LucideIcon; align?: "left" | "right";
})
```

- [ ] Build component; refactor `RegionFilter` onto it to prove parity (`TagFilter` keeps its CRUD-heavy custom panel).
- [ ] Commit.

### Task A2: Subdomain naming helpers + tests (TDD)

**Files:** Create `lib/site-studio/deploy/naming.ts`, `tests/subdomainNaming.test.ts`.

```ts
// naming.ts
const MAX_BASE = 20;
export function baseSubdomain(businessName: string): string {
  const firstTwo = businessName.trim().split(/\s+/).slice(0, 2).join(" ");
  const slug = firstTwo.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const cut = slug.slice(0, MAX_BASE).replace(/-+$/g, "");
  return cut || "site";
}
export function parseVersion(sub: string): { base: string; version: number } {
  const m = /^(.*[^\d])v(\d{1,4})$/.exec(sub);
  if (m && m[1]) return { base: m[1], version: parseInt(m[2], 10) };
  return { base: sub, version: 1 };
}
export function versionedSubdomain(base: string, version: number): string {
  return `${base}v${version}`;
}
export function nextVersionSubdomain(current: string): string {
  const { base, version } = parseVersion(current);
  return versionedSubdomain(base, version + 1);
}
```

New deploys use `versionedSubdomain(baseSubdomain(name), 1)`; on collision with an unrelated existing subdomain, bump version until free (helper `firstFreeVersion(base, exists: (s)=>Promise<boolean>)`).

- [ ] Write tests: two-word truncation ≤20, accents, single word, numeric-ending base round-trips (`"site2"` must not parse as version), parse/next chain (`joes-plumbingv1` → `joes-plumbingv2`).
- [ ] Implement, run `npx vitest run tests/subdomainNaming.test.ts`, commit.

### Task A3: Migration 0066

**Files:** Create `supabase/migrations/0066_deployment_enhancements.sql`.

```sql
-- 1. manual origin for studio_deployments
alter table public.studio_deployments drop constraint if exists studio_deployments_origin_check;
alter table public.studio_deployments add constraint studio_deployments_origin_check
  check (origin in ('studio','v2_import','builder','manual'));
-- 2. website url on notifications (machine-readable live-site link)
alter table public.notifications add column if not exists website_url text;
-- 3. per-user follow-up reminder status filter (revives dormant table)
alter table public.user_notification_settings add column if not exists statuses text[];
-- 4. notification rule for custom-domain go-live (agent + management)
insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes)
values ('website_custom_domain', true, '{Management}', '{}', '{lead_agent}', 0)
on conflict (event_key) do nothing;
```

- [ ] Also register event in `lib/notifications/events.ts`: key `website_custom_domain`, bell `website`, availableRoles `["lead_agent","lead_closer"]`, no timing.
- [ ] Apply to Supabase (shared dev/prod DB) BEFORE code deploy. Commit.

---

## Phase B — Deployment backend

### Task B1: DirectAdmin `listSubdomains()`

**Files:** Modify `lib/template-engine/directadmin.ts` (extract from `subdomainExists`).

```ts
export async function listSubdomains(): Promise<string[]> // CMD_API_SUBDOMAINS list[] parse
```
`subdomainExists` becomes `(await listSubdomains()).includes(sub)`.

- [ ] Implement + unit-test the parser if extractable; commit.

### Task B2: Merged, categorized `GET /api/site-studio/deployments`

**Files:** Modify `app/api/site-studio/deployments/route.ts`; Create `lib/site-studio/deploy/categorize.ts` + `tests/deploymentCategories.test.ts`.

Response shape: `{ rows: BoardRow[], daDomain, hostingerConfigured }` where

```ts
type BoardRow = {
  id: string | null;            // null = untracked (hosting-only)
  subdomain: string | null;     // null for custom-domain rows
  url: string; status: "live"|"taken_down"|"failed"|"untracked";
  origin: string | null; category: "ready"|"manual"|"live"|"other";
  leadId: string | null; leadName: string | null; leadStatus: string | null;
  deployedAt: string | null; isCustomDomain: boolean;
};
```

Pure categorizer (`categorize.ts`, tested):
- `ready`: tracked, status live, lead_id set, subdomain on daDomain
- `manual`: tracked, origin='manual', not custom
- `live`: custom domain (url NOT under daDomain) — tracked transfers PLUS every Hostinger `listDomains()` entry (untracked domains appear as `live`/untracked)
- `other`: hosting subdomains not matching any tracked row + tracked-but-unlinked non-manual rows
- Board data = union of DB rows, DirectAdmin `listSubdomains()`, Hostinger `listDomains()` (fail-soft: hosting fetch failure ⇒ DB rows only + `hostingWarning`).
- `?view=` param filters server-side; `all` = subdomain rows (ready+manual+other); `live` = custom domains.

- [ ] TDD the categorizer; wire route; commit.

### Task B3: Link subdomain to lead — `POST /api/site-studio/deployments/link`

**Files:** Create `app/api/site-studio/deployments/link/route.ts`.

Body `{ subdomain?, deploymentId?, leadId }`, perm `studio.manage`. If untracked subdomain: adopt — insert `studio_deployments` row (origin `manual`, status `live`, url `https://{sub}.{daDomain}`, docroot via `docrootFor`). Set `lead_id`, retire other live rows for that lead (reuse retirement pattern from `lib/site-builder/deploy.ts:207-231`), update `leads.website_link`, `notify("website_link_added", …, { websiteUrl: url })`, activity_log `studio.deployment.linked`.

- [ ] Implement; commit.

### Task B4: Shuffle — `POST /api/site-studio/deployments/[id]/shuffle`

**Files:** Create `app/api/site-studio/deployments/[id]/shuffle/route.ts`.

Flow (row must be live, subdomain-based, perm `studio.manage`):
1. `archiveDocroot(oldSub)` → zip of live files (captures manual edits).
2. New name: if row has lead → `versionedSubdomain(baseSubdomain(leadName), next free version ≠ old)`; else `nextVersionSubdomain(oldSub)`; bump while `subdomainExists`.
3. `createSubdomain(newSub)` → `uploadZipAndExtract(newSub, zip)` → reachability probe.
4. Only after success: `deleteSubdomain(oldSub, contents=yes)`.
5. Update row (subdomain, docroot, url), `leads.website_link` (if lead), `builder_runs.deployed_url where deployed_url=oldUrl`, activity_log `studio.deployment.shuffled`, `notify("website_link_added")` with new URL + `website_url`.
Failure before step 4 ⇒ delete the new subdomain (rollback), 502.

- [ ] Implement; commit.

### Task B5: Upload (new / override / new-version) — `POST /api/site-studio/deployments/upload`

**Files:** Create `app/api/site-studio/deployments/upload/route.ts` (supersedes template-engine upload route, which stays but UI moves off it).

Multipart `{ file, mode: "new"|"override"|"version", subdomain?, name? }`, 60MB cap, perm `studio.manage`.
- `new`: subdomain from `name` via naming helpers (first free version); refuse existing; create+upload; **insert `studio_deployments` row origin='manual', lead_id=null**. Response includes `{ deploymentId, url, subdomain }` so UI can prompt optional link-to-lead (Task B3 endpoint).
- `override`: target existing subdomain (tracked or untracked — adopt untracked as origin 'manual'); `clearDocroot` + upload; update row `deployed_at`.
- `version`: like shuffle but with uploaded files: create `{prev}vN+1`, upload, delete previous subdomain, update/adopt row + lead link + notify if linked.

- [ ] Implement; commit.

### Task B6: Override any live row via upload — `POST /api/site-studio/deployments/[id]/upload`

**Files:** Create `app/api/site-studio/deployments/[id]/upload/route.ts`.

If row is custom-domain: `getWebsite(domain)` → `deployZipToDir(zip, root_directory)` (covers item 9: override live .com via file upload). Else subdomain: `clearDocroot` + `uploadZipAndExtract`.

- [ ] Implement; commit.

### Task B7: Bulk delete — `POST /api/site-studio/deployments/bulk-delete`

**Files:** Create `app/api/site-studio/deployments/bulk-delete/route.ts`.

Body `{ subdomains: string[] }` (max 50). For each: `deleteSubdomain(contents=yes)`; tracked rows → status `taken_down` + clear matching `leads.website_link` (reuse `[id]/route.ts:116-127` logic). Per-item result array (fail-soft). Never deletes custom domains via this route.

- [ ] Implement; commit.

### Task B8: Transfer hardening + admin notify

**Files:** Modify `app/api/site-studio/deployments/[id]/transfer/route.ts`, `lib/notifications/notify.ts` call sites.

- Switch transfer notification to new event `website_custom_domain` ("Website live on custom domain") with `website_url` set → reaches lead_agent + Management dept per seeded rule.
- Allow transferring `manual`-origin and adopted rows (currently keyed to deployment rows already — verify no origin gate).
- `notify()` signature gains optional `websiteUrl` → writes `notifications.website_url`.
- Also populate `website_url` at the other website call sites: leads route (`website_ready` = lead.website_link; `website_link_added` = newLink), template-engine deploy/transfer.

- [ ] Implement; run existing notification tests; commit.

---

## Phase C — Deployment UI + legacy retirement

### Task C1: Rebuild `DeploymentsBoard`

**Files:** Rewrite `components/site-studio/DeploymentsBoard.tsx` (+ small subcomponents `components/site-studio/board/` as needed: `UploadModal.tsx`, `LinkLeadModal.tsx`, `ShuffleButton`, existing `TransferToDomainModal` reused).

- Category tabs with counts: **All · Ready · Manual · Others · Live Websites** (`?view=` → server filter; `useViewState` for tab + search).
- Search box filters by subdomain/lead name.
- Checkbox column + "Delete selected" bulk bar (subdomain rows only; confirm dialog listing names; calls B7).
- Row actions by category: Shuffle (ready/linked, confirm dialog explains old link is replaced + agent notified), Upload/Override (opens UploadModal prefilled `override` on that target; for Live rows uses B6), Transfer to domain (existing modal → B8), Link to lead (untracked/manual → LinkLeadModal with lead search), Take down / Delete record (existing).
- UploadModal: file input + mode radio (new subdomain / existing subdomain) — when "existing", a **searchable subdomain picker** (filter-as-you-type over board rows) and a second choice: **Override** vs **New version (`{prev}vN`)**; when "new", business-name input showing computed `{base}v1.dmviral.com` preview. On success with no lead linked → inline prompt "Link this site to a lead?" (optional, skippable) → LinkLeadModal.
- LinkLeadModal: debounced lead search (`GET /api/leads` client-filtered or lightweight search param), confirm → B3.

- [ ] Build; verify in dev browser; commit.

### Task C2: Retire legacy Deployed Sites

**Files:** Modify `components/layout/Sidebar.tsx` (remove :58 entry), `app/(app)/ai-tools/template-engine/deployments/page.tsx` → `redirect("/ai-tools/site-builder/deployments")`; template-engine overview page link (`app/(app)/ai-tools/template-engine/page.tsx:63`) repointed.

- [ ] Implement; commit.

---

## Phase D — Sidebar submenus

### Task D1: NavItem children + accordion

**Files:** Modify `components/layout/Sidebar.tsx`, `components/layout/NavItemContent.tsx` (chevron affordance).

```ts
type NavItem = { href: string; label: string; icon: LucideIcon; perm?: string; children?: { href: string; label: string }[] };
```

- Children for: Site Builder (Templates `/ai-tools/site-builder`, New Site `/new`, Runs `/runs`, Deployments `/deployments`), Site Studio (Templates, Runs, Library, Deployments, SOPs), Pre-Leads stays a section, Template Engine (Generate, Templates) if applicable.
- Expanded when parent or any child is the active longest-prefix match; chevron toggles manual expand (local state). Collapsed rail (w-16) shows parent icon only; submenu renders only when rail expanded. Mobile overlay renders children too.
- Active-match logic: children participate in longest-prefix; parent row highlights when a child is active but exact-match rule for root child (Templates) preserved (`pathname === href`).

- [ ] Implement; verify all sections/permissions unaffected; commit.

---

## Phase E — Follow-ups

### Task E1: Follow Up page filters, Ready default

**Files:** Rewrite `components/leads/FollowUpQueue.tsx`; Modify `app/(app)/leads/follow-ups/page.tsx` (pass tag catalog/profiles like leads page if needed).

- `useViewState(FOLLOWUPS_DEFAULTS)` with `{ q, status: "Ready", agent, type, region, tags, bucket: "all" }`.
- Toolbar: search, status **MultiSelect** (Ready preselected; options Ready/Long Term — the follow-up-eligible set, but allow any status the user may view for completeness of "all the filters"? No — page logic is follow-up-specific: keep eligible statuses), agent MultiSelect, type MultiSelect, `RegionFilter`, `TagFilter`, bucket filter pills (All / Overdue / Due today / Upcoming / Not set), Clear filters.
- Keep grouped bucket sections; groups respect filters.

- [ ] Implement; commit.

### Task E2: Follow-up modal custom days/hours

**Files:** Modify `components/leads/FollowUpModal.tsx`, `components/preleads/FollowUpModal.tsx`, `lib/dates/datetimeLocal.ts`.

Add `inOffset({days, hours, minutes})` helper. UI: replace single "In … min" input with three compact numeric inputs **Days / Hours / Min** + existing preset chips; any change applies combined offset to the datetime field (one-way as today; manual datetime edit clears them).

- [ ] Implement both modals; commit.

---

## Phase F — Tickets

### Task F1: Closed-lead ticket eligibility

**Files:** Modify `lib/tickets/logic.ts:16-18`, `app/api/leads/[id]/tickets/route.ts:136-140` (message), `tests/tickets.test.ts`.

```ts
export const TICKET_ELIGIBLE_STATUSES = ["Ready", "Long Term", "Closed"] as const;
export function isTicketEligible(s: string) { return (TICKET_ELIGIBLE_STATUSES as readonly string[]).includes(s); }
```
Error message → "Tickets apply only to Ready, Long Term, or Closed leads."

- [ ] TDD; commit.

### Task F2: Tickets page like Leads

**Files:** Rewrite `components/tickets/TicketQueue.tsx` (status tabs w/ counts + toolbar + paginated TanStack table), keep `app/(app)/tickets/page.tsx` data shape.

- Tabs `["All", ...TICKET_STATUSES]` with counts; toolbar: search (title/lead/assignee), category MultiSelect, priority MultiSelect, assignee MultiSelect, "Assigned to me" checkbox; pagination (15/25/50) + `useViewState` defaults `{ q, status:"Open", category, priority, assignee, mine, lead, page:"0", size:"15" }` (status default Open tab? default "All" — match leads: default "All").
- Columns: title, lead (link), category, priority pill, assignee, created, due/escalated indicator, open→detail.

- [ ] Implement; commit.

### Task F3: Ticket detail website link

**Files:** Modify `app/(app)/tickets/[id]/page.tsx:78-82` (add `website_link` to select), `components/tickets/TicketDetail.tsx` (LeadInfo type + render link with `ExternalLink` icon, `target="_blank" rel="noreferrer"`).

- [ ] Implement; commit.

### Task F4: Realtime-ish tickets counter

**Files:** Modify `hooks/useNavCounts.ts`.

Add mail-badge parity: 60s `setInterval` bump + `focus`/`visibilitychange` refetch listeners (cleanup on unmount), keep realtime channel; `fetch(..., { cache: "no-store" })`.

- [ ] Implement; commit.

---

## Phase G — Notifications

### Task G1: Per-user follow-up reminder statuses

**Files:** Modify `app/api/notifications/generate/route.ts`; Create `app/api/me/notification-settings/route.ts` (GET/PUT `{ followupStatuses: string[] | null }` → `user_notification_settings` row `event_key='followup_reminder'`, column `statuses`); UI card in `components/notifications/NotificationInbox.tsx` (or `ReminderSettingsCard.tsx`) with MultiSelect of `FOLLOWUP_STATUSES` (empty/null = all).

Generate route: after building candidate rows, load `user_notification_settings` for distinct agent ids (`event_key='followup_reminder'`); drop rows where `enabled=false` or (`statuses` non-null AND not containing lead.status).

- [ ] TDD the filter as pure function (`lib/notifications/logic.ts` + tests); wire; commit.

### Task G2: Bell shows all unread

**Files:** Modify `components/layout/BellBase.tsx`, `app/api/notifications/route.ts`.

API limit 50 → 200 when `unread=1`. BellBase: remove `slice(0,8)`; panel body `max-h-[70vh] overflow-y-auto`; footer link "View all" → `/notifications`.

- [ ] Implement; commit.

### Task G3: Website notification open-in-new-tab

**Files:** Modify `components/layout/BellBase.tsx`, `components/notifications/NotificationInbox.tsx`, `lib/notifications/types.ts` (AppNotification + `website_url`), API select columns.

Row gains trailing `ExternalLink` icon-button when `website_url` present: `window.open(website_url, "_blank", "noopener")` + `markRead(id)`. (Column populated by B8 call-site changes.)

- [ ] Implement; commit.

---

## Phase H — Multiselect conversions

### Task H1: Convert filter dropdowns (client-side pages)

**Files:** `components/leads/LeadsTable.tsx` (agent :490, type :498 → MultiSelect; filterFn swap to array-includes at :214/:227 — status tabs stay), `components/preleads/PreLeadsTable.tsx` (:310 follow-up, :319 status), `components/dashboard/DashboardBoard.tsx` (:241 agent), `components/feedback/FeedbackList.tsx` (:93 status), `components/admin/LogsViewer.tsx` (:77 actor), `components/notifications/NotificationInbox.tsx` (:81 bell type). Keep comma-join `useViewState` convention. Sort/rows-per-page/form selects untouched.

- [ ] Convert page-by-page, verifying each compiles; commit per page or grouped.

### Task H2: API `.eq` → `.in` (comma-tolerant)

**Files:** `app/api/tickets/route.ts:34`, `app/api/notifications/route.ts:23`, `app/api/site-studio/deployments/route.ts` (already reworked in B2).

`status.split(",")` → `.in()`; single value stays compatible.

- [ ] Implement; commit.

---

## Phase I — Verify & deploy

- [ ] `npx vitest run` full suite green.
- [ ] `npx next lint` / `tsc` via build.
- [ ] Confirm migration 0066 applied to Supabase (MCP `list_migrations` / `execute_sql` check) BEFORE restart; also verify 0065 status (reports memory says operator action pending — do not block on it, but report).
- [ ] Middleware check: no new secret routes added (all new routes are user-authed under /api/site-studio) — confirm none need `isPublic` allowlist.
- [ ] Dev-server smoke test of each surface via browser pane.
- [ ] `git push` main; `NODE_OPTIONS=--max-old-space-size=8192 npm run build`; `pm2 restart sed-lms`; live curl smoke checks.

## Phase J — UX review

- [ ] Browse the live app end-to-end (leads, follow-ups, tickets, deployments, notifications, admin) and write a prioritized list of concrete UX improvements.
