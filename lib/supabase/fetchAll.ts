/**
 * Read EVERY row of a query, not just the first page.
 *
 * PostgREST (Supabase's API) caps any single response at `db.max_rows`,
 * 1,000 by default, and does so silently: a `select()` with no `.range()`
 * simply returns the first 1,000 rows. The leads table crossed 1,000 live
 * rows in October 2026, so every "all leads" page — dashboard totals, the
 * leads table, by-agent, follow-ups — had quietly started dropping the tail.
 *
 * `page(from, to)` builds the query for one inclusive range; it must include
 * a deterministic `.order()` (ties broken by id) so pages do not overlap.
 * Pages are fetched until one comes back short. If the project's max_rows
 * is ever lowered BELOW `pageSize`, pass that number here — a short page is
 * the only stop signal.
 */
export const DEFAULT_PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PageResult<T>> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return { data: all, error: null };
}
