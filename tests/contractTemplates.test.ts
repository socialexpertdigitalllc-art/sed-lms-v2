import { describe, it, expect } from "vitest";
import { CONTRACT_TEMPLATES, isContractTemplateKey, getContractTemplate, nodeText } from "@/lib/contracts/templates";
import type { ContractSnapshot } from "@/lib/contracts/types";

const snap: ContractSnapshot = {
  business_name: "Acme Plumbing",
  business_phone: "555-1212",
  business_email: "acme@example.com",
  one_time_price: 900,
  yearly_price: 100,
  agent_name: "Jane Agent",
  contract_date: "2026-07-18",
};

describe("contract templates", () => {
  it("ships the standard template with a title and sections", () => {
    const t = CONTRACT_TEMPLATES.find((x) => x.key === "standard");
    expect(t).toBeTruthy();
    expect(t!.title).toMatch(/WEBSITE DEVELOPMENT AGREEMENT/i);
    expect(t!.sections.length).toBeGreaterThanOrEqual(9);
    // Every template exposes a selector label + intro noun.
    for (const tpl of CONTRACT_TEMPLATES) {
      expect(tpl.label).toBeTruthy();
      expect(tpl.agreementNoun).toBeTruthy();
    }
  });

  it("validates known keys and rejects unknown", () => {
    expect(isContractTemplateKey("standard")).toBe(true);
    expect(isContractTemplateKey("premium-nope")).toBe(false);
    expect(isContractTemplateKey("")).toBe(false);
  });

  it("getContractTemplate falls back to standard for an unknown key", () => {
    expect(getContractTemplate("nope").key).toBe("standard");
    expect(getContractTemplate("standard").key).toBe("standard");
  });

  it("nodeText resolves both static and dynamic (price-merged) node text", () => {
    expect(nodeText("static clause", snap)).toBe("static clause");
    // The pricing section merges the snapshot's prices into its text.
    const pricing = getContractTemplate("standard").sections.find((s) => /pricing/i.test(s.heading))!;
    const rendered = pricing.nodes.map((n) => (n.kind === "subhead" ? n.text : nodeText(n.text, snap)));
    expect(rendered.some((line) => line.includes("$900.00"))).toBe(true);
    expect(rendered.some((line) => line.includes("$100.00"))).toBe(true);
  });
});
