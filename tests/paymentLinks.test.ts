import { describe, it, expect } from "vitest";
import { paymentLinkSchema, paymentLinkPatchSchema } from "@/lib/payments/schema";
import { groupLinks } from "@/lib/payments/board";
import type { PaymentLink } from "@/lib/payments/types";

const base = { label: "Website $250", amount: 250, category: "Website", url: "https://buy.stripe.com/abc123" };

describe("paymentLinkSchema", () => {
  it("accepts a valid link", () => expect(paymentLinkSchema.safeParse(base).success).toBe(true));
  it("rejects non-https urls", () => {
    expect(paymentLinkSchema.safeParse({ ...base, url: "http://buy.stripe.com/x" }).success).toBe(false);
    expect(paymentLinkSchema.safeParse({ ...base, url: "not-a-url" }).success).toBe(false);
  });
  it("rejects zero/negative amounts", () => {
    expect(paymentLinkSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(paymentLinkSchema.safeParse({ ...base, amount: -5 }).success).toBe(false);
  });
  it("rejects bad category + long label", () => {
    expect(paymentLinkSchema.safeParse({ ...base, category: "Nope" }).success).toBe(false);
    expect(paymentLinkSchema.safeParse({ ...base, label: "x".repeat(121) }).success).toBe(false);
  });
  it("patch allows partial + is_active", () => {
    expect(paymentLinkPatchSchema.safeParse({ is_active: false }).success).toBe(true);
    expect(paymentLinkPatchSchema.safeParse({}).success).toBe(true);
  });
});

const mk = (p: Partial<PaymentLink>): PaymentLink => ({
  id: Math.random().toString(), label: "L", amount: 100, currency: "USD", category: "Website",
  url: "https://x.co", notes: null, provider: "stripe", external_id: null, is_active: true,
  sort: 0, created_by: null, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z", ...p,
});

describe("groupLinks", () => {
  const links = [
    mk({ label: "Site 250", amount: 250, category: "Website", sort: 1 }),
    mk({ label: "Site 200", amount: 200, category: "Website", sort: 0 }),
    mk({ label: "Yearly 100", amount: 100, category: "Yearly" }),
    mk({ label: "Old 500", amount: 500, category: "Website", is_active: false }),
  ];
  it("groups in fixed category order, sorts within", () => {
    const g = groupLinks(links, {});
    expect(g[0].category).toBe("Website");
    expect(g[0].links.map((l) => l.label)).toEqual(["Site 200", "Site 250"]);
    expect(g[1].category).toBe("Yearly");
  });
  it("excludes archived by default, includes on demand", () => {
    expect(groupLinks(links, {}).flatMap((s) => s.links).some((l) => !l.is_active)).toBe(false);
    expect(groupLinks(links, { includeArchived: true }).flatMap((s) => s.links).some((l) => !l.is_active)).toBe(true);
  });
  it("searches by label and by amount digits", () => {
    expect(groupLinks(links, { query: "site 2" }).flatMap((s) => s.links)).toHaveLength(2);
    expect(groupLinks(links, { query: "250" }).flatMap((s) => s.links).map((l) => l.label)).toEqual(["Site 250"]);
  });
  it("filters by category", () => {
    const g = groupLinks(links, { category: "Yearly" });
    expect(g).toHaveLength(1);
    expect(g[0].links[0].label).toBe("Yearly 100");
  });
});
