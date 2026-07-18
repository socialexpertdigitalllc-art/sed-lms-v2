import { describe, it, expect } from "vitest";
import { CONTRACT_TEMPLATES, isContractTemplateKey } from "@/lib/contracts/templates";

describe("contract templates", () => {
  it("ships the standard template", () => {
    expect(CONTRACT_TEMPLATES.some((t) => t.key === "standard")).toBe(true);
  });
  it("validates known keys and rejects unknown", () => {
    expect(isContractTemplateKey("standard")).toBe(true);
    expect(isContractTemplateKey("premium-nope")).toBe(false);
    expect(isContractTemplateKey("")).toBe(false);
  });
});
