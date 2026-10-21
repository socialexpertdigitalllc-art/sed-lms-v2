// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/** GET/POST /api/leads/[id]/domain-check: domains.view, and only for a lead the person can see. */

const state = vi.hoisted(() => ({ auth: { userId: "u1", admin: {} } as unknown, leadVisible: true }));
const lc = vi.hoisted(() => ({
  loadLeadDomainCheck: vi.fn(async () => ({ lead_id: "L1", domain: "abc.com", available: true })),
  checkLeadDomain: vi.fn(async () => ({ lead_id: "L1", domain: "abc.com", available: false, reason: "Taken" })),
  checkRegistrar: vi.fn(() => "cloudflare"),
}));
vi.mock("@/lib/domains/guard", () => ({
  requireDomains: vi.fn(async () => state.auth),
  domainsAuthError: (s: number) => Response.json({ error: "no" }, { status: s }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: state.leadVisible ? { id: "L1" } : null });
      return b;
    },
  }),
}));
vi.mock("@/lib/domains/leadCheck", () => lc);

import { GET, POST } from "@/app/api/leads/[id]/domain-check/route";
import { resetDomainChecks, CHECKS_PER_WINDOW } from "@/lib/domains/checkRate";

const ctx = { params: Promise.resolve({ id: "L1" }) };
const req = (method = "GET") => new Request("http://x/api/leads/L1/domain-check", { method });

beforeEach(() => {
  state.auth = { userId: "u1", admin: {} };
  state.leadVisible = true;
  resetDomainChecks();
  vi.clearAllMocks();
});

describe("/api/leads/[id]/domain-check", () => {
  it("GET reads the stored answer; POST checks again now", async () => {
    expect(await (await GET(req(), ctx)).json()).toEqual({ check: expect.objectContaining({ available: true }) });
    const res = await POST(req("POST"), ctx);
    expect(res.status).toBe(200);
    expect(lc.checkLeadDomain).toHaveBeenCalledWith({}, "L1");
  });

  it("no domains access → the guard's answer; a lead the person can't see → 404", async () => {
    state.auth = { error: 403 };
    expect((await GET(req(), ctx)).status).toBe(403);
    state.auth = { userId: "u1", admin: {} };
    state.leadVisible = false;
    expect((await POST(req("POST"), ctx)).status).toBe(404);
    expect(lc.checkLeadDomain).not.toHaveBeenCalled();
  });

  it("too many checks in a few minutes → 429", async () => {
    for (let i = 0; i < CHECKS_PER_WINDOW; i++) expect((await POST(req("POST"), ctx)).status).toBe(200);
    expect((await POST(req("POST"), ctx)).status).toBe(429);
  });
});
