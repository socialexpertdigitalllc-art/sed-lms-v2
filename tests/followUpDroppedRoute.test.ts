// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Dropped rule has to hold on the SERVER too. The modal stopped requiring
 * a next follow-up time when the lead is being dropped, but the route kept
 * its own "A future next follow-up time is required" check — so dropping a
 * lead from the modal would have failed with a 422 the operator could not act
 * on. This pins both halves of the rule.
 */

const holder = vi.hoisted(() => ({
  user: { id: "agent-1" } as { id: string } | null,
  perms: new Set<string>(),
  lead: {} as Record<string, unknown>,
  inserted: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: holder.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ single: async () => ({ data: holder.lead, error: null }) }) }),
      }),
    }),
  }),
}));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => holder.perms }));
vi.mock("@/lib/notifications/notify", () => ({ notify: async () => {} }));
vi.mock("@/lib/leads/statusEvents", () => ({ recordStatusChange: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    ({
      from: (table: string) => {
        const chain: Record<string, unknown> = {};
        Object.assign(chain, {
          insert: (row: Record<string, unknown>) => {
            holder.inserted.push({ table, ...row });
            return {
              select: () => ({ single: async () => ({ data: { id: "fu-1", created_at: "now" }, error: null }) }),
            };
          },
          update: () => ({ eq: async () => ({ error: null }), is: () => ({ eq: async () => ({ error: null }) }) }),
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: null, error: null }),
        });
        return chain;
      },
    }) as unknown as SupabaseClient,
}));

import { POST } from "@/app/api/leads/[id]/follow-ups/route";

const ctx = { params: Promise.resolve({ id: "lead-1" }) };
const post = (body: Record<string, unknown>) =>
  POST(new Request("http://test.local/x", { method: "POST", body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  holder.user = { id: "agent-1" };
  holder.perms = new Set(["leads.followup", "leads.cat_set.dropped"]);
  holder.lead = { id: "lead-1", status: "Ready", no_pickup_streak: 0, first_touch_at: "earlier" };
  holder.inserted = [];
});

describe("POST follow-ups — Dropped needs no next time", () => {
  it("accepts a Dropped follow-up with no next_follow_up_time", async () => {
    const res = await post({ fu_status: "Pickup", status_change: "Dropped", next_follow_up_time: "" });
    expect(res.status).toBe(201); // created
  });

  it("still rejects a non-terminal follow-up with no time", async () => {
    const res = await post({ fu_status: "No Pickup", next_follow_up_time: "" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/future next follow-up time/i);
  });

  it("still rejects a time in the past", async () => {
    const res = await post({ fu_status: "Pickup", next_follow_up_time: "2020-01-01T00:00:00.000Z" });
    expect(res.status).toBe(422);
  });

  it("records is_specific_time only when a time was actually set", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await post({ fu_status: "Pickup", next_follow_up_time: future, is_specific_time: true });
    expect(holder.inserted[0]).toMatchObject({ table: "lead_follow_ups", is_specific_time: true });

    holder.inserted = [];
    await post({ fu_status: "Pickup", status_change: "Dropped", next_follow_up_time: "", is_specific_time: true });
    expect(holder.inserted[0]).toMatchObject({ is_specific_time: false });
  });
});
