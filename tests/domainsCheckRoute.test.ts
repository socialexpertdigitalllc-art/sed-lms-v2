// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * /api/domains/check is the buying search's answer for anyone with
 * domains.view (sales on a call); /api/domains/search stays purchase-only.
 */

const state = vi.hoisted(() => ({ level: "view" as "view" | "purchase" | "none" }));
const svc = vi.hoisted(() => ({
  searchDomainNames: vi.fn(async (q: string) => ({
    query: q,
    exact: { domain: "abcconstruction.com", assumedTld: true, offer: { domain: "abcconstruction.com", registrar: "cloudflare", available: true, reason: null, registrationCents: 1044, renewalCents: 1044, currency: "USD" } },
    otherEndings: [],
    similar: [],
  })),
}));
vi.mock("@/lib/domains/guard", () => ({
  requireDomains: vi.fn(async (need: string) => {
    if (state.level === "none") return { error: 403 };
    if (need === "purchase" && state.level !== "purchase") return { error: 403 };
    return { userId: "u1", admin: {}, canPurchase: state.level === "purchase" };
  }),
  domainsAuthError: (s: number) => Response.json({ error: "no" }, { status: s }),
}));
vi.mock("@/lib/domains/service", () => svc);
vi.mock("@/lib/cloudflare/client", () => ({ cloudflareConfigured: () => true }));
vi.mock("@/lib/hostinger/client", () => ({ hostingerConfigured: () => true }));

import { GET as check } from "@/app/api/domains/check/route";
import { GET as search } from "@/app/api/domains/search/route";
import { CHECKS_PER_WINDOW, resetDomainChecks } from "@/lib/domains/checkRate";

const url = (path: string, q = "ABC Construction") => new Request(`http://x${path}?q=${encodeURIComponent(q)}&registrar=cloudflare`);

beforeEach(() => {
  state.level = "view";
  resetDomainChecks();
  vi.clearAllMocks();
});

describe("/api/domains/check", () => {
  it("domains.view is enough; the answer is the same three groups as the buying search", async () => {
    const res = await check(url("/api/domains/check"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.exact).toMatchObject({ domain: "abcconstruction.com", offer: { available: true } });
    expect(j.results).toHaveLength(1);
    expect(svc.searchDomainNames).toHaveBeenCalledWith("ABC Construction", "cloudflare");
  });

  it("no domains access → 403; the buying search still needs domains.purchase", async () => {
    expect((await search(url("/api/domains/search"))).status).toBe(403);
    state.level = "none";
    expect((await check(url("/api/domains/check"))).status).toBe(403);
    state.level = "purchase";
    expect((await search(url("/api/domains/search"))).status).toBe(200);
  });

  it("a per-person brake; an empty search doesn't count against it", async () => {
    for (let i = 0; i < 5; i++) expect((await check(url("/api/domains/check", "  "))).status).toBe(200);
    for (let i = 0; i < CHECKS_PER_WINDOW; i++) expect((await check(url("/api/domains/check"))).status).toBe(200);
    expect((await check(url("/api/domains/check"))).status).toBe(429);
  });

  it("the registrar unreachable → 502, never a list of suggestions alone", async () => {
    svc.searchDomainNames.mockResolvedValueOnce(null as never);
    expect((await check(url("/api/domains/check"))).status).toBe(502);
  });
});
