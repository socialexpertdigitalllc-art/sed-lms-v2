import { describe, it, expect, vi, beforeEach } from "vitest";
import { ttlResetAll } from "@/lib/cache/ttl";

/**
 * Permission resolution is cached ACROSS requests (30s per user). It ran
 * ~5,600 times a day on prod, three round-trips each, re-reading rows that
 * change a few times a month. Writers invalidate, so a change is live at once.
 */

const fromSpy = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      fromSpy(table);
      const rows: Record<string, unknown[]> = {
        department_members: [{ department_id: "d1" }],
        department_permissions: [{ permission_key: "leads.view" }, { permission_key: "leads.edit" }],
        user_permission_overrides: [{ permission_key: "leads.edit", is_granted: false, expires_at: null }],
      };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? [] });
      return chain;
    },
  }),
}));

import { getUserPermissions, invalidateUserPermissions } from "@/lib/permissions/resolver";

beforeEach(() => {
  ttlResetAll();
  fromSpy.mockClear();
});

describe("getUserPermissions cache", () => {
  it("resolves correctly and reuses the result on the next request", async () => {
    const first = await getUserPermissions("u1");
    expect([...first].sort()).toEqual(["leads.view"]); // edit revoked by override
    expect(fromSpy).toHaveBeenCalledTimes(3);

    const second = await getUserPermissions("u1");
    expect(second).toBe(first); // same Set instance — no queries
    expect(fromSpy).toHaveBeenCalledTimes(3);
  });

  it("is per user", async () => {
    await getUserPermissions("u1");
    await getUserPermissions("u2");
    expect(fromSpy).toHaveBeenCalledTimes(6);
  });

  it("re-reads after invalidation — one user, or everyone", async () => {
    await getUserPermissions("u1");
    await getUserPermissions("u2");
    fromSpy.mockClear();

    invalidateUserPermissions("u1");
    await getUserPermissions("u1");
    await getUserPermissions("u2");
    expect(fromSpy).toHaveBeenCalledTimes(3); // only u1 refetched

    fromSpy.mockClear();
    invalidateUserPermissions();
    await getUserPermissions("u1");
    await getUserPermissions("u2");
    expect(fromSpy).toHaveBeenCalledTimes(6);
  });
});
