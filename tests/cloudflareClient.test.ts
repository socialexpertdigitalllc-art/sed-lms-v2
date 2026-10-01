// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkDomains,
  findZone,
  listDnsRecords,
  listRegistrations,
  registerDomain,
  searchDomains,
} from "@/lib/cloudflare/client";

/**
 * Cloudflare Registrar API (beta) + zones/DNS, contracts verified live
 * 2026-10-02. The load-bearing rules: a purchase always sends auto_renew:true
 * (the API can't renew and defaults it to false), and the sandbox switch moves
 * every registrar call to /registrar-sandbox (no charges).
 */

const KEYS = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_REGISTRAR_SANDBOX"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.CLOUDFLARE_API_TOKEN = "tok";
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct1";
  delete process.env.CLOUDFLARE_REGISTRAR_SANDBOX;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function stub(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const c: Call = {
        url: String(input),
        method: init?.method ?? "GET",
        headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(c);
      return respond(c);
    }),
  );
  return calls;
}
const ok = (result: unknown, extra: Record<string, unknown> = {}) => Response.json({ success: true, errors: [], result, ...extra });

describe("registrar", () => {
  it("checks availability with the documented body and parses the result", async () => {
    const calls = stub(() =>
      ok({ domains: [{ name: "acme.com", registrable: true, tier: "standard", pricing: { currency: "USD", registration_cost: "10.46", renewal_cost: "10.46" } }] }),
    );
    const res = await checkDomains(["acme.com"]);
    expect(res?.[0]).toMatchObject({ name: "acme.com", registrable: true });
    expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/accounts/acct1/registrar/domain-check");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toEqual({ domains: ["acme.com"] });
    expect(calls[0].headers.authorization).toBe("Bearer tok");
  });

  it("caps a check at 20 names (the API's limit)", async () => {
    const calls = stub(() => ok({ domains: [] }));
    await checkDomains(Array.from({ length: 30 }, (_, i) => `n${i}.com`));
    expect((calls[0].body as { domains: string[] }).domains).toHaveLength(20);
  });

  it("buys with auto_renew FORCED on, privacy on, one year, and asks to return at once", async () => {
    const calls = stub(() => ok({ state: "in_progress", completed: false }));
    const r = await registerDomain("acme.com");
    expect(r).toMatchObject({ ok: true, workflow: { state: "in_progress" } });
    expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/accounts/acct1/registrar/registrations");
    expect(calls[0].body).toEqual({ domain_name: "acme.com", auto_renew: true, years: 1, privacy_mode: "redaction" });
    expect(calls[0].headers.prefer).toBe("respond-async");
  });

  it("never retries a purchase, even on a network error (it may have gone through)", async () => {
    const calls = stub(() => {
      throw new Error("socket hang up");
    });
    const r = await registerDomain("acme.com");
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect(calls).toHaveLength(1);
  });

  it("routes every registrar call to the sandbox when CLOUDFLARE_REGISTRAR_SANDBOX=1", async () => {
    process.env.CLOUDFLARE_REGISTRAR_SANDBOX = "1";
    const calls = stub(() => ok({ domains: [] }));
    await searchDomains("acme");
    await checkDomains(["acme.com"]);
    await registerDomain("acme.com");
    expect(calls.map((c) => new URL(c.url).pathname.split("/")[5])).toEqual(["registrar-sandbox", "registrar-sandbox", "registrar-sandbox"]);
  });

  it("follows the cursor through every page of registrations", async () => {
    let page = 0;
    const calls = stub(() => {
      page++;
      return ok([{ domain_name: `d${page}.com`, status: "active", auto_renew: true }], {
        result_info: { cursor: page < 2 ? "next-cursor" : "" },
      });
    });
    const regs = await listRegistrations();
    expect(regs?.map((r) => r.domain_name)).toEqual(["d1.com", "d2.com"]);
    expect(calls[1].url).toContain("cursor=next-cursor");
  });
});

describe("zones + DNS", () => {
  it("findZone distinguishes 'no zone' (null) from 'could not ask' (error)", async () => {
    stub(() => ok([]));
    expect(await findZone("acme.com")).toBeNull();
    stub(() => new Response("down", { status: 500 }));
    expect(await findZone("acme.com")).toBe("error");
  });

  it("lists every page of DNS records", async () => {
    stub((c) => {
      const page = Number(new URL(c.url).searchParams.get("page"));
      return ok([{ id: `r${page}`, type: "A", name: "acme.com", content: "1.2.3.4" }], { result_info: { total_pages: 2 } });
    });
    expect((await listDnsRecords("z1"))?.map((r) => r.id)).toEqual(["r1", "r2"]);
  });
});
