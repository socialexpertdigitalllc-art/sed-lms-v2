import { describe, it, expect, vi } from "vitest";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

/** PostgREST silently returns at most max_rows (1,000) per call; the leads
 *  table is past that. fetchAllRows pages until a short page. */
describe("fetchAllRows", () => {
  const source = (total: number) => (from: number, to: number) =>
    Promise.resolve({ data: Array.from({ length: Math.max(0, Math.min(total, to + 1) - from) }, (_, i) => from + i), error: null });

  it("returns every row across pages", async () => {
    const page = vi.fn(source(1017));
    const { data, error } = await fetchAllRows(page);
    expect(error).toBeNull();
    expect(data).toHaveLength(1017);
    expect(data![1016]).toBe(1016);
    expect(page).toHaveBeenCalledTimes(2);
    expect(page).toHaveBeenNthCalledWith(1, 0, 999);
    expect(page).toHaveBeenNthCalledWith(2, 1000, 1999);
  });

  it("stops after one call when the first page is short", async () => {
    const page = vi.fn(source(42));
    const { data } = await fetchAllRows(page);
    expect(data).toHaveLength(42);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("needs one extra (empty) call when the total is an exact multiple", async () => {
    const page = vi.fn(source(2000));
    const { data } = await fetchAllRows(page);
    expect(data).toHaveLength(2000);
    expect(page).toHaveBeenCalledTimes(3);
  });

  it("surfaces a page error as the supabase shape (data null)", async () => {
    const { data, error } = await fetchAllRows<number>(() => Promise.resolve({ data: null, error: { message: "boom" } }));
    expect(data).toBeNull();
    expect(error?.message).toBe("boom");
  });
});
