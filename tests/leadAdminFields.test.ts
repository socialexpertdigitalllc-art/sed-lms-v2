// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Agent / Closed by / Rating are admin-only, and a lead saved with "no email"
 * must still accept an address later. Both rules are enforced SERVER-side
 * here — the UI gating is only a hint.
 */

const holder = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  perms: new Set<string>(),
  isAdmin: false,
  before: {} as Record<string, unknown>,
  updated: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: holder.user } }) } }),
}));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => holder.perms }));
vi.mock("@/lib/permissions/isAdminMember", () => ({ isAdminMember: async () => holder.isAdmin }));
vi.mock("@/lib/notifications/notify", () => ({ notify: async () => {} }));
vi.mock("@/lib/leads/statusEvents", () => ({ recordStatusChange: async () => {} }));
vi.mock("@/lib/template-engine/forceResolve", () => ({ cancelGenerationsForLeads: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    ({
      from: () => {
        const chain: Record<string, unknown> = {};
        Object.assign(chain, {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          maybeSingle: async () => ({ data: holder.before, error: null }),
          single: async () => ({ data: holder.before, error: null }),
          insert: async () => ({ error: null }),
          update: (patch: Record<string, unknown>) => {
            holder.updated = patch;
            return { eq: async () => ({ error: null }) };
          },
        });
        return chain;
      },
    }) as unknown as SupabaseClient,
}));

import { PATCH } from "@/app/api/leads/[id]/route";

const ctx = { params: Promise.resolve({ id: "lead-1" }) };
const patch = (body: Record<string, unknown>) =>
  PATCH(new Request("http://test.local/api/leads/lead-1", { method: "PATCH", body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  holder.user = { id: "user-1" };
  holder.perms = new Set(["leads.edit", "leads.view_all", "leads.assign"]);
  holder.isAdmin = false;
  holder.updated = null;
  holder.before = {
    id: "lead-1",
    agent_id: "11111111-1111-4111-8111-111111111111",
    closed_by: null,
    rating: 5,
    business_email: null,
    no_email: true,
    status: "Ready",
  };
});

describe("admin-only lead fields", () => {
  for (const [field, value] of [
    ["agent_id", "22222222-2222-4222-8222-222222222222"],
    ["closed_by", "33333333-3333-4333-8333-333333333333"],
    ["rating", 9],
  ] as const) {
    it(`rejects ${field} from a non-admin even with leads.edit + leads.assign`, async () => {
      const res = await patch({ [field]: value });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toMatch(/only an admin/i);
      expect(holder.updated).toBeNull();
    });

    it(`allows ${field} for an admin`, async () => {
      holder.isAdmin = true;
      const res = await patch({ [field]: value });
      expect(res.status).toBe(200);
      expect(holder.updated).toMatchObject({ [field]: value });
    });
  }

  it("lets a non-admin resubmit the SAME admin-field value (no-op is not a change)", async () => {
    const res = await patch({ rating: 5, business_phone: "555" });
    expect(res.status).toBe(200);
  });

  it("still lets a non-admin edit ordinary fields", async () => {
    const res = await patch({ business_name: "Acme Renamed" });
    expect(res.status).toBe(200);
    expect(holder.updated).toMatchObject({ business_name: "Acme Renamed" });
  });
});

describe("no_email leads accept an address later", () => {
  it("saves an email onto a no_email lead and clears the flag", async () => {
    const res = await patch({ business_email: "hi@acme.test", no_email: false });
    expect(res.status).toBe(200);
    expect(holder.updated).toMatchObject({ business_email: "hi@acme.test", no_email: false });
  });
});
