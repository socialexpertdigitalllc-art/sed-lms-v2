// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { completeHostingerDomainSetup, getHostingerPortfolioDomain } from "@/lib/hostinger/client";

/**
 * Where a purchased domain stands at Hostinger. The domain's own page answers
 * only once it is registered; a paid order still being registered appears
 * only in the portfolio list — odneyremodeling.com sat for 45 minutes as
 * "payment processing" while the list already had it (2026-10-12).
 */

const savedToken = process.env.HOSTINGER_API_TOKEN;
beforeEach(() => {
  process.env.HOSTINGER_API_TOKEN = "test-token";
});
afterEach(() => {
  if (savedToken === undefined) delete process.env.HOSTINGER_API_TOKEN;
  else process.env.HOSTINGER_API_TOKEN = savedToken;
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stub(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input).replace("https://developers.hostinger.com", "");
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const hit = routes[`${init?.method ?? "GET"} ${url}`];
      return hit ? hit() : json({ message: "Not found" }, 404);
    }),
  );
  return calls;
}

describe("getHostingerPortfolioDomain", () => {
  it("a registered domain: its own page answers (status lowercased)", async () => {
    const calls = stub({
      "GET /api/domains/v1/portfolio/acme.com": () =>
        json({ domain: "acme.com", status: "ACTIVE", message: null, expires_at: "2027-10-12T00:00:00Z", registered_at: "2026-10-12T22:50:00Z" }),
    });
    expect(await getHostingerPortfolioDomain("Acme.com")).toEqual({
      status: "active",
      message: null,
      expiresAt: "2027-10-12T00:00:00Z",
      registeredAt: "2026-10-12T22:50:00Z",
    });
    expect(calls).toEqual(["GET /api/domains/v1/portfolio/acme.com"]);
  });

  it("paid but not registered: the domain's page says nothing, the portfolio list does", async () => {
    stub({
      "GET /api/domains/v1/portfolio": () =>
        json([
          { id: 1, domain: "other.com", type: "domain", status: "active", expires_at: "2027-01-01T00:00:00Z" },
          { id: 2, domain: "acme.com", type: "domain", status: "pending_setup", expires_at: null, created_at: "2026-10-12T22:07:30Z" },
        ]),
    });
    expect(await getHostingerPortfolioDomain("acme.com")).toEqual({
      status: "pending_setup",
      message: null,
      expiresAt: null,
      registeredAt: "2026-10-12T22:07:30Z",
    });
  });

  it("a name listed twice (a lapsed registration bought again): the new one counts", async () => {
    stub({
      "GET /api/domains/v1/portfolio": () =>
        json([
          { id: 1, domain: "acme.com", type: "domain", status: "expired", expires_at: "2025-03-01T00:00:00Z" },
          { id: 2, domain: "acme.com", type: "domain", status: "requested", expires_at: null },
        ]),
    });
    expect(await getHostingerPortfolioDomain("acme.com")).toMatchObject({ status: "requested" });
  });

  it("not in the account at all: null — and an unreadable account is an error, not 'not there'", async () => {
    stub({ "GET /api/domains/v1/portfolio": () => json([]) });
    expect(await getHostingerPortfolioDomain("acme.com")).toBeNull();
    stub({});
    expect(await getHostingerPortfolioDomain("acme.com")).toBe("error");
  });
});

describe("completeHostingerDomainSetup", () => {
  it("reports Hostinger's status on a refusal, so a definite 'no' can stop the retries", async () => {
    stub({ "POST /api/domains/v1/portfolio/acme.com/setup": () => json({ message: "Contact details are required" }, 422) });
    expect(await completeHostingerDomainSetup("acme.com")).toEqual({ ok: false, status: 422, message: "Contact details are required" });
  });
});
