// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The site-keyed shuffle door (POST /api/site-studio/deployments/shuffle?site=)
 * that the lead screen, ticket screen and lead table icons call. Pinned:
 *   - lead viewers who can download must NOT be able to shuffle (it deletes
 *     the old address);
 *   - the site is resolved to its LIVE deployment row by host, however the
 *     link was written;
 *   - an untracked site is refused before anything touches the hosting.
 */

const holder = vi.hoisted(() => ({
  user: null as { id: string } | null,
  perms: new Set<string>(),
  rows: [] as { id: string; url: string; status: string }[],
  shuffleCalls: [] as { id: string; actorId: string }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: holder.user } }) } }),
}));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => holder.perms }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => {
        const filters: [string, string][] = [];
        const chain = {
          eq: (col: string, val: string) => {
            filters.push([col, val]);
            return chain;
          },
          maybeSingle: async () => ({
            data: holder.rows.find((r) => filters.every(([c, v]) => (r as Record<string, string>)[c] === v)) ?? null,
          }),
        };
        return chain;
      },
    }),
  }),
}));
// The shuffle itself is the board route's proven implementation; here only
// the door is under test, so record the call instead of touching DirectAdmin.
vi.mock("@/lib/site-studio/deploy/shuffle", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/site-studio/deploy/shuffle")>();
  return {
    ...actual,
    shuffleDeployment: async (_admin: unknown, args: { id: string; actorId: string }) => {
      holder.shuffleCalls.push(args);
      return { ok: true, url: "https://green-lawnv2.dmviral.com", subdomain: "green-lawnv2", oldDeleted: true };
    },
  };
});

import { POST } from "@/app/api/site-studio/deployments/shuffle/route";

const call = (site: string) =>
  POST(new Request(`http://x/api/site-studio/deployments/shuffle?site=${encodeURIComponent(site)}`, { method: "POST" }));

beforeEach(() => {
  holder.user = { id: "tech-1" };
  holder.perms = new Set(["tickets.resolve"]);
  holder.rows = [{ id: "dep-1", url: "https://green-lawnv1.dmviral.com", status: "live" }];
  holder.shuffleCalls = [];
});

describe("POST /api/site-studio/deployments/shuffle", () => {
  it("401s without a session", async () => {
    holder.user = null;
    expect((await call("https://green-lawnv1.dmviral.com")).status).toBe(401);
  });

  it("refuses a lead viewer — download rights are not move rights", async () => {
    holder.perms = new Set(["leads.view", "leads.view_all"]);
    expect((await call("https://green-lawnv1.dmviral.com")).status).toBe(403);
    expect(holder.shuffleCalls).toEqual([]);
  });

  it("resolves the lead's website link to its live deployment and shuffles that", async () => {
    const res = await call("HTTPS://Green-Lawnv1.dmviral.com/");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, url: "https://green-lawnv2.dmviral.com" });
    expect(holder.shuffleCalls).toEqual([{ id: "dep-1", actorId: "tech-1" }]);
  });

  it("404s a site that is not a live deployment, before anything is moved", async () => {
    holder.rows = [{ id: "dep-1", url: "https://green-lawnv1.dmviral.com", status: "taken_down" }];
    const res = await call("https://green-lawnv1.dmviral.com");
    expect(res.status).toBe(404);
    expect(holder.shuffleCalls).toEqual([]);
  });

  it("a studio manager may shuffle too", async () => {
    holder.perms = new Set(["studio.manage"]);
    expect((await call("green-lawnv1.dmviral.com")).status).toBe(200);
  });
});
