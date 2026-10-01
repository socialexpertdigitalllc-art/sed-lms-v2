import { describe, it, expect, vi, afterEach } from "vitest";
import { dnsUse, planDns, planIsEmpty } from "@/lib/domains/dns";
import type { DnsRecord } from "@/lib/cloudflare/client";

/**
 * The DNS recipe read off the 16 domains set up by hand: apex A -> the client
 * hosting server (proxy off), www CNAME -> apex (proxy off). Everything else
 * in the zone is left alone.
 */
const IP = "76.13.203.71";
const D = "acme.com";
let n = 0;
const rec = (type: string, name: string, content: string, proxied = false): DnsRecord => ({ id: `r${++n}`, type, name, content, proxied });

describe("planDns", () => {
  it("an empty zone gets the apex A and the www CNAME, both unproxied", () => {
    const plan = planDns(D, IP, []);
    expect(plan.create).toEqual([
      expect.objectContaining({ type: "A", name: D, content: IP, proxied: false }),
      expect.objectContaining({ type: "CNAME", name: `www.${D}`, content: D, proxied: false }),
    ]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("a zone already matching the recipe needs nothing (the hand-made setups)", () => {
    const plan = planDns(D, IP, [rec("A", D, IP), rec("CNAME", `www.${D}`, D)]);
    expect(planIsEmpty(plan)).toBe(true);
  });

  it("a proxied apex A or www CNAME is switched to DNS-only (Hostinger's SSL needs it)", () => {
    const a = rec("A", D, IP, true);
    const w = rec("CNAME", `www.${D}`, D, true);
    const plan = planDns(D, IP, [a, w]);
    expect(plan.update.map((u) => u.id)).toEqual([a.id, w.id]);
    expect(plan.update.every((u) => u.rec.proxied === false)).toBe(true);
  });

  it("an apex A at another server is repointed in place; extra apex A/AAAA/CNAME go", () => {
    const old = rec("A", D, "1.1.1.1");
    const extraA = rec("A", D, "2.2.2.2");
    const aaaa = rec("AAAA", D, "2606::1");
    const plan = planDns(D, IP, [old, extraA, aaaa, rec("CNAME", `www.${D}`, D)]);
    expect(plan.update).toEqual([expect.objectContaining({ id: old.id, rec: expect.objectContaining({ content: IP }) })]);
    expect(plan.remove.map((r) => r.id).sort()).toEqual([extraA.id, aaaa.id].sort());
    expect(plan.create).toEqual([]);
  });

  it("www A records are replaced by the CNAME; a www CNAME elsewhere is repointed", () => {
    const wwwA = rec("A", `www.${D}`, "3.3.3.3");
    const p1 = planDns(D, IP, [rec("A", D, IP), wwwA]);
    expect(p1.remove.map((r) => r.id)).toEqual([wwwA.id]);
    expect(p1.create).toEqual([expect.objectContaining({ type: "CNAME", name: `www.${D}` })]);

    const wwwC = rec("CNAME", `www.${D}`, "parking.example.net");
    const p2 = planDns(D, IP, [rec("A", D, IP), wwwC]);
    expect(p2.update).toEqual([expect.objectContaining({ id: wwwC.id, rec: expect.objectContaining({ content: D }) })]);
  });

  it("never touches MX, TXT or other subdomains", () => {
    const plan = planDns(D, IP, [
      rec("MX", D, "mx.mail.com"),
      rec("TXT", D, "v=spf1 -all"),
      rec("A", `shop.${D}`, "9.9.9.9"),
      rec("A", D, IP),
      rec("CNAME", `www.${D}`, D),
    ]);
    expect(planIsEmpty(plan)).toBe(true);
  });

  it("a trailing-dot CNAME target counts as the apex", () => {
    expect(planIsEmpty(planDns(D, IP, [rec("A", D, IP), rec("CNAME", `www.${D}`, `${D}.`)]))).toBe(true);
  });
});

/**
 * Import decides "free to set up" vs "a live site elsewhere" from public DNS.
 * Hostinger's nameservers serve every domain on its DNS, hosted or not, so
 * only its parking ADDRESS marks a domain free; anything else is a site we
 * must never take over.
 */
describe("dnsUse", () => {
  afterEach(() => vi.unstubAllGlobals());
  const answers = (byName: Record<string, string[] | "fail">) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const name = new URL(url).searchParams.get("name") ?? "";
        const a = byName[name] ?? [];
        if (a === "fail") throw new Error("network");
        return Response.json({ Answer: a.map((data) => ({ type: 1, data })) });
      }),
    );

  it("parked on Hostinger's parking page (apex and www) is free", async () => {
    answers({ "parked.com": ["2.57.91.91"], "www.parked.com": ["2.57.91.91"] });
    expect(await dnsUse("parked.com")).toBe("free");
  });

  it("pointing nowhere is free", async () => {
    answers({});
    expect(await dnsUse("empty.com")).toBe("free");
  });

  it("an address anywhere else — apex or only www — is a live site", async () => {
    answers({ "old.com": ["216.158.229.243"] });
    expect(await dnsUse("old.com")).toBe("in_use");
    answers({ "www.wwwonly.com": ["203.0.113.9"] });
    expect(await dnsUse("wwwonly.com")).toBe("in_use");
  });

  it("an unreadable lookup decides nothing", async () => {
    answers({ "flaky.com": "fail" });
    expect(await dnsUse("flaky.com")).toBeNull();
  });
});
