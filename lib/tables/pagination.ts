// Why this exists: TanStack Table auto-resets pageIndex to 0 whenever the
// `data` array identity changes (autoResetPageIndex defaults to true for
// client-side pagination). Our tables refresh data constantly — the mutation
// modals call router.refresh() and useRealtimeRefresh() refreshes on ANY
// Postgres change — so every refresh pushed page 0 through onPaginationChange
// into the URL state, yanking the user back to page 1 mid-work.
// Tables spread `noAutoPageReset` so a data refresh NEVER touches pagination;
// the filter/search/sort handlers still reset the page explicitly (that reset
// is intentional). Pair with usePageClamp so a shrinking dataset can't strand
// the user past the last page.
export const noAutoPageReset = { autoResetPageIndex: false } as const;

/**
 * With auto-reset off, a shrinking dataset (delete, realtime refresh, filters
 * changed elsewhere) can leave pageIndex beyond the last page, rendering an
 * empty page. Returns the corrected page index, or null when no fix is needed.
 */
export function clampPageIndex(pageIndex: number, pageCount: number): number | null {
  if (pageCount <= 0) return null; // empty table: nothing to clamp to
  return pageIndex >= pageCount ? pageCount - 1 : null;
}
