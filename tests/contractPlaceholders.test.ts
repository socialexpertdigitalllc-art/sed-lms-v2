import { describe, it, expect } from "vitest";
import type { ContractSnapshot } from "@/lib/contracts/types";
import {
  extractPlaceholders,
  buildReplacements,
  SUPPORTED_PLACEHOLDERS,
  unmappedPlaceholders,
} from "@/lib/contracts/placeholders";

const snapshot: ContractSnapshot = {
  business_name: "Acme Plumbing",
  business_phone: "+1 555 111 2222",
  business_email: "owner@acme.test",
  one_time_price: 1200,
  yearly_price: 300,
  agent_name: "Jordan",
  contract_date: "2026-07-19",
};

describe("extractPlaceholders", () => {
  it("returns unique {{token}} strings in first-seen order", () => {
    const text = "Hi {{business_name}}, total {{one_time_price}} for {{business_name}}.";
    expect(extractPlaceholders(text)).toEqual(["{{business_name}}", "{{one_time_price}}"]);
  });
  it("tolerates internal whitespace and normalizes to {{token}}", () => {
    expect(extractPlaceholders("{{ agent_name }}")).toEqual(["{{agent_name}}"]);
  });
  it("returns [] when there are no placeholders", () => {
    expect(extractPlaceholders("no tokens here")).toEqual([]);
  });
});

describe("buildReplacements", () => {
  it("maps every supported token to a formatted snapshot value", () => {
    const map = new Map(buildReplacements(snapshot).map((r) => [r.token, r.value]));
    expect(map.get("{{business_name}}")).toBe("Acme Plumbing");
    expect(map.get("{{one_time_price}}")).toBe("$1,200.00");
    expect(map.get("{{yearly_price}}")).toBe("$300.00");
    expect(map.get("{{date}}")).toBe("2026-07-19");
    expect(map.get("{{provider_name}}")).toBe("Social Expert Digital");
    expect(map.get("{{provider_phone}}")).toBe("(252) 401-2775");
    expect(map.get("{{provider_email}}")).toBe("socialexpertdigitalllc@gmail.com");
  });
  it("covers exactly the SUPPORTED_PLACEHOLDERS set", () => {
    const tokens = buildReplacements(snapshot).map((r) => r.token).sort();
    expect(tokens).toEqual([...SUPPORTED_PLACEHOLDERS].sort());
  });
  it("renders null prices as an em dash", () => {
    const map = new Map(
      buildReplacements({ ...snapshot, one_time_price: null, yearly_price: null }).map((r) => [r.token, r.value])
    );
    expect(map.get("{{one_time_price}}")).toBe("—");
  });
});

describe("unmappedPlaceholders", () => {
  it("flags tokens a template uses that we don't support", () => {
    const found = ["{{business_name}}", "{{signature_image}}", "{{date}}"];
    expect(unmappedPlaceholders(found)).toEqual(["{{signature_image}}"]);
  });
});
