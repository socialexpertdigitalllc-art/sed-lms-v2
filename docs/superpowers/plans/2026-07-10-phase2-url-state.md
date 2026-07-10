# Phase 2 — URL table state + history-aware back — Plan

> Execute via subagent-driven-development. Branch `ux-url-state` off main.

**Goal:** Table filters/sort/search/page live in the URL so Back (button or link) restores the exact filtered view; a `BackLink` returns users to where they actually came from.

**Approach:** A generic `useUrlState(defaults)` hook where the URL query IS the state (no dual useState to desync). LeadsTable migrates first (the user's example), then PreLeads/Tickets/Generations. `BackLink` uses `router.back()` with an href fallback, replacing hardcoded `← Foo` links.

**Env:** `D:/sed-lms-v2` only; `npx tsc --noEmit` + `npm run build` + `npx vitest run`; commits end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Task 1 — `hooks/useUrlState.ts` + `tests/urlState.test.ts`
Pure-ish serialize/parse; TDD the query round-trip.
- Hook: reads `useSearchParams` → typed string state (falling back to `defaults`); `setState(patch)` writes via `router.replace(pathname?qs, {scroll:false})`, deleting keys equal to default/empty.
- Test a pure helper `buildQuery(current, defaults, patch)` → URLSearchParams string (default/empty keys omitted; others set; region csv preserved).

## Task 2 — migrate `components/leads/LeadsTable.tsx` to useUrlState
Keys: `q, status(All), agent, type, region(csv), sort(id:dir, default created_at:desc), page(0)`. Derive `regionSel`, `sorting`, `pagination`, `columnFilters` from URL state. Controlled search input + status tabs + agent/type selects + RegionFilter + sort dropdown (id:dir options + a "Custom" option when a header-click sort isn't a preset). react-table `state` fully controlled; `onGlobalFilterChange/onSortingChange/onPaginationChange` write to URL (resetting `page` to 0 on filter/sort change). Remove old region `useEffect` + `SORTS` map + `initialState.pagination` (keep `columnVisibility:{region:false}`). Keep `modalLead`/`followUpLead` as local state.

## Task 3 — `components/common/BackLink.tsx` + swap hardcoded back links
`router.back()` when `window.history.length > 1` else `router.push(href)`. Replace the `← Foo` links in `app/(app)/admin/users/[id]/page.tsx`, `app/(app)/admin/departments/[id]/page.tsx`, `app/(app)/ai-tools/generations/[id]/page.tsx`.

## Task 4 — extend useUrlState to `PreLeadsTable`, `TicketQueue`, `GenerationsTable`
Same pattern, each table's own filter keys (PreLeads: q/category/follow/sort/page; Tickets + Generations: their existing filters). Keep ephemeral modal state local.

## Verify
tsc + build + vitest green. Live: filter Leads (status+agent+region+search), open a lead, browser Back → filters intact; a detail BackLink returns to the filtered list; deep-link `/leads?status=Ready&region=California` renders pre-filtered. Merge to main, push.
