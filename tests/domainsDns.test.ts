import { describe, it, expect } from "vitest";
import { planDns, planIsEmpty } from "@/lib/domains/dns";
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
