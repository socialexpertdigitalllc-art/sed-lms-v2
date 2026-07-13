# SED LMS v2 — Polish 4 (11 items, priority-grouped)

**Date:** 2026-07-13 · **Branch:** `polish-4` (off main @ 7b2276a) · **Order:** A access control → B notifications → C lead form/modals → D dashboard → E skeletons.

## Group A — access control (items 11, 1)

### A1 Ticket user-scoping (item 11)
Today `/tickets` + `/api/tickets` fetch ALL tickets via the admin client, gated only on `tickets.view`. Wanted: non-managers see only tickets they created OR tickets on leads assigned to them (`leads.agent_id = user.id`); managers keep the global queue.
- **Migration `0029_tickets_scope_byagent.sql`:** insert permission `('tickets.view_all','View All Tickets',null,'tickets',true)`; grant to depts `tech`, `management`, `admin` (mirror the 0017 grant block pattern). (Admin also has the blanket grant.)
- **Shared helper `lib/tickets/scope.ts`:** `export async function allowedTicketScope(admin, userId, perms): Promise<{ all: true } | { all: false; leadIds: string[] }>` — if `perms.has("tickets.view_all")` → `{all:true}`; else fetch `leads.id where agent_id = userId` (admin client, `is_deleted=false` if that column gates elsewhere — mirror existing lead queries) → `{all:false, leadIds}`.
- **Apply in:** `app/(app)/tickets/page.tsx` (filter the fetched tickets: `t.created_by === user.id || leadIds.includes(t.lead_id)` — or add `.or()` to the query), `app/api/tickets/route.ts` GET (same), `app/(app)/tickets/[id]/page.tsx` (if the ticket is out of scope → redirect `/tickets`), `app/(app)/leads/[id]/tickets/page.tsx` + lead-detail tickets load in `app/(app)/leads/[id]/page.tsx` (filter that lead's tickets the same way — a user who can open a colleague's lead may not see others' tickets on it unless view_all).
- Keep: ticket CRUD APIs' existing gates; notifications unchanged.

### A2 By-Agent permission (item 1)
- Same migration: insert `('analytics.by_agent','View By-Agent Analytics',null,'analytics',true)`; grant to `management` + `admin`.
- `app/(app)/by-agent/page.tsx`: server gate — `getUserPermissions`, `if (!perms.has("analytics.by_agent")) redirect("/dashboard")`.
- `components/layout/Sidebar.tsx` MAIN: By Agent entry `perm: "analytics.by_agent"` (was `analytics.view`).
- Admin can then scope per department/user via the existing permission grids. Add both new keys to `lib/permissions/constants.ts` (keep catalog + seed in sync).

### A3 Latent bug check
`app/api/leads/route.ts` (~62-63) tests `perms.has("leads.set_status")`. VERIFY via grep whether any migration seeds `leads.set_status` (polish-2 intended it). If it exists in DB migrations but not `constants.ts` → add to constants. If it exists nowhere → insert it in 0029 (name "Set Status on Submit", category leads, grant `sales`, `admin`) since the code + polish-2 spec expect it. Do NOT rename the code to `leads.status_change` (that would widen create-time status rights).

## Group B — notifications (items 9, 8)

### B1 `website_link_added` event (item 9)
- `lib/notifications/events.ts`: add `{ key: "website_link_added", label: "Website link added", description: "A website link was set on a lead — the website is live.", bell: "website", availableRoles: ["lead_agent","lead_closer"], timingMode: "delay", defaultLeadTimeMinutes: 0, hasTiming: <match website_ready's shape> }` (mirror `website_ready`'s exact field set).
- Migration (same 0029 or 0030): seed a `notification_rules` row for `website_link_added` mirroring how 0020 seeded `website_ready` (enabled + same default targets) — without a rule row `notify()` no-ops.
- Fire-sites (fire when `website_link` transitions to a non-empty value that differs from before):
  1. `app/api/leads/[id]/route.ts` PATCH — after update, if `parsed.data.website_link !== undefined && parsed.data.website_link?.trim() && parsed.data.website_link !== before.website_link` → `notify("website_link_added", { leadId: id, lead: { agent_id: before.agent_id, closed_by: before.closed_by }, actorId: user.id }, { title: "Website live", body: \`${before.business_name}'s website is live: ${link}\`, dedupKey: \`website_link_added:${id}:${nonce}\`, targetUrl: \`/leads/${id}\` })` (try/catch like the others).
  2. `app/api/template-engine/generations/[id]/deploy/route.ts` after the auto-set (~line 160) — same notify (actorId = the deploying user id available in that route; body with the deployed URL).
  - NOT on bulk import (avoid a notification storm).
- Admin routing UI: nothing else needed — the settings page projects `NOTIFICATION_EVENTS`.

### B2 Browser-tab dots (item 8)
WhatsApp-Web-style favicon badge + title count. New client component `components/layout/TabBadge.tsx`, rendered once in `app/(app)/layout.tsx` (inside providers, next to `<NotificationToaster />`).
- Data: fetch `/api/notifications?bell=general&unread=1` + `?bell=website&unread=1` on mount; subscribe to `postgres_changes` on `notifications` (copy BellBase's realtime + 400ms debounce + JWT `setAuth` pattern) to refetch. Track `{ generalUnread, websiteUnread }` counts.
- Favicon: draw on a 64×64 canvas — base = image loaded from `/favicon.ico` (fallback: filled rounded square with the brand accent if load fails); if `websiteUnread > 0` draw a **blue** dot (`#2563eb`, r≈14) bottom-right; if `generalUnread > 0` draw an **orange** dot (`#f59e0b`) top-right. Swap by replacing/adding `<link rel="icon">` href with `canvas.toDataURL("image/png")`. Restore the original favicon when both counts are 0.
- Title: prefix `(${total}) ` onto the base `document.title` when total > 0 (strip any existing `(n) ` prefix first; keep the branding title otherwise). Clean up on unmount.

## Group C — lead form + modals (items 4, 6, 5, 7)

### C1 Add-on quoted price (item 4)
`add_ons` is already `jsonb` of `{id,label,price:number|null}` — the catalog price is copied on toggle. Change: when an add-on is toggled ON in `components/leads/NewLeadForm.tsx` (~574-607), render beneath the chip row one small labeled row per selected add-on: `<addon label> — quoted price` with a number input, value defaulting to the catalog price, editable; writes to that entry's `price` in `f.add_ons`. Zod already allows `price: number|null` — no schema/migration change. Also show prices in the lead detail add-ons display (`LeadDetail.tsx` — find where add_ons render; show `label — $price`). PATCH path already accepts add_ons (verify `updateLeadSchema` includes it; if not, display-only).

### C2 Comma-split services / service areas (item 6)
`components/forms/DynamicList.tsx`: add `onBlur` per row input — if the value contains a comma: split on `,`, trim, drop empties, replace that row with the first part and INSERT the rest as new rows after it (preserving later rows). Also apply the same split inside the `+ Add`/change handler on paste (blur covers the stated flow — blur is the requirement: "at the glance the user goes out of that field"). This automatically fixes BOTH Services and Service Areas in NewLeadForm (both use DynamicList). Add a vitest for the pure split-merge helper (extract `splitCommaRow(values, index): string[]` into `lib/forms/dynamicList.ts` or similar).

### C3 Star rating (item 5)
`components/forms/RatingGroup.tsx`: restyle as **stars with the number inside, 2 rows of 5** (grid `grid-cols-5 gap-1.5 max-w-[260px]`, 10 cells). Each cell: a lucide `Star` icon as the button background with the number centered inside (wrap: relative button, `<Star className="w-9 h-9" fill>` + absolute centered number). Selected state: stars 1..n filled (accent fill `text-accent fill-accent-soft` style), unselected outline `text-border`. Hover previews fill. Keep the same props (`value`, `onChange`) so NewLeadForm is untouched. NO emojis — lucide `Star` only.
- `components/leads/LeadDetail.tsx` rating row (~216): keep the numeric edit BUT change the display to a compact star strip: 10 mini stars (two rows of 5 on narrow, one row is fine if space allows) with filled count = rating, plus `n/10` text. Simplest: a small `RatingStars` display component in `components/common/` used by FieldRow's `display` prop.

### C4 Follow-up "in X minutes" (item 7)
Both `components/leads/FollowUpModal.tsx` (~122-130) and `components/preleads/FollowUpModal.tsx` (~114-119): above/beside the `datetime-local` input add a compact row: `In <number input> min` + preset chips `15` `30` `60` `120` (buttons). Entering/choosing minutes sets the datetime field to `now + minutes` (format via a `toDateTimeLocal(new Date(Date.now()+m*60000))` — a local yyyy-MM-ddTHH:mm formatter; preleads already has `toDateTimeLocal` — reuse/extract shared `lib/dates/datetimeLocal.ts` if duplicating). Editing the datetime manually clears the minutes box (one-way sync, mirroring TicketModal's `dueTouched` pattern). Keep existing validation.

## Group D — dashboard (items 2, 10)

### D1 No gaps + compact cards (item 2)
- Gaps come from `DashboardBoard.tsx` chart rows: fixed `lg:grid-cols-3`/`lg:grid-cols-2` grids with `{flags.x && <ChartCard/>}` children. Rebuild the charts section as ONE flowing grid: build `const charts = [ {key:"leadsOverTime", show:flags.leadsOverTime, span:2, el:<.../>}, ... ].filter(c=>c.show)` and render `<div className="grid grid-cols-1 lg:grid-cols-6 gap-4">` with spans mapped to `lg:col-span-{2|3|6}` equivalents (use a static class map, NOT template strings — Tailwind can't see dynamic classes): leadsOverTime span4, pipelineByStatus span2, leadsByAgent/siteTypeSplit/ratingDistribution span2 each, revenueByStatus/ticketStatusSplit span3 each, freshVsFollowup span6. Result: any disabled chart lets the rest pack (`grid-flow-dense` optional).
- Compact: `KpiHero` cards `p-4→p-3`, value `text-3xl→text-2xl`, sub `mt-2→mt-1`; `StatGrid` tiles `p-3→p-2.5`, value sizes one step down; `ChartCard` `p-4→p-3` and chart heights ~`h-64→h-56` where hardcoded. Keep typography hierarchy; don't crowd (this is "too big and spacious" tuning, not cramming).

### D2 Drag-and-drop KPI order (item 10)
Per-user card order persisted to `profiles.ui_preferences.dashboardOrder` (two arrays: `hero: string[]`, `tiles: string[]` of card keys).
- `app/api/me/preferences/route.ts`: ALLOWED += `"dashboardOrder"`.
- `providers/UiPrefsProvider.tsx`: add `dashboardOrder` (`{hero: string[]; tiles: string[]}` default `{hero:[],tiles:[]}`) + `setDashboardOrder(next)` with the same write-through; seed from layout like density/columns (`app/(app)/layout.tsx` uiInitial).
- `KpiHero.tsx` + `StatGrid.tsx`: give every card a stable `key` string (they exist conceptually — totalLeads, quotedRevenue, ...). Order visible cards by the pref (unknown/new keys append in default order). Native HTML5 DnD: card `draggable`, `onDragStart` stores key, `onDragOver` preventDefault, `onDrop` reorders (move dragged before target) → `setDashboardOrder`. Add a subtle `GripVertical` lucide handle top-right visible on hover + `cursor-grab`. Reordering only within each grid (hero↔hero, tiles↔tiles).

## Group E — per-screen skeletons (item 3)
Rewrite the 7 `app/(app)/*/loading.tsx` to structurally mirror each real page (dossier layouts):
- **leads:** header row (title+subtitle skeleton left, button skeleton right) → status-tab pill row (~6 `h-8 w-20` rounded) → toolbar (wide search + 5-6 `h-9 w-28` controls) → table card (keep TableSkeleton body) → footer row.
- **pre-leads:** title/subtitle → `lg:grid-cols-[1fr_280px]` two-col: left `space-y-5` (6-tile KPI grid `grid-cols-2 lg:grid-cols-6`, then 2×2 card grid with bar-chart-ish skeleton lines), right a tall clock card.
- **tickets:** header (title + right controls) → 3 sections: `h-4 w-32` section label + 3 row cards (`h-14 rounded-lg border`).
- **by-agent:** title/subtitle → `lg:grid-cols-2` grid of 4 cards, each: avatar circle + name line, 3-stat mini grid, 3 table lines.
- **ai-tools:** title/subtitle → `sm:grid-cols-2` 4 tool cards (icon square + 2 lines + button) → list card with 5 divided rows.
- **payments:** header (title + search + pills + button) → 2 sections: label + list card with 4 divided rows.
- **dashboard:** filter row (2 small selects right) → title → KpiHero `grid-cols-2 lg:grid-cols-4` (4 compact cards matching D1 sizing) → StatGrid `grid-cols-2 sm:grid-cols-3 xl:grid-cols-5` (10 tiles) → status strip bar → chart grid matching D1's flowing grid (a span-4 + span-2 row, a 3×span-2 row): `h-56` chart boxes.
Reuse `Skeleton`; add tiny local helpers per file rather than over-abstracting. Keep `TableSkeleton` for the leads body only.

## Gates & rollout
Each group: subagent implements + `npx tsc --noEmit` + `npx vitest run` green (NO `npm run build` per group; controller runs one final build). Commit per group on `polish-4`. Final: full build, ff-merge to main, push. Live verify deferred (login). Migrations applied to the shared Supabase project by the controller via MCP alongside group A/B commits.
