import { describe, it, expect } from "vitest";
import type { ContractSnapshot } from "@/lib/contracts/types";
import type { Lead } from "@/lib/leads/types";
import {
  extractPlaceholders,
  buildReplacements,
  SUPPORTED_PLACEHOLDERS,
  BUILT_IN_PLACEHOLDERS,
  LEAD_FIELD_SOURCES,
  formatLeadField,
  normalizeToken,
  isBuiltInToken,
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

/** 2026-07-19T20:30:00Z — 4:30 PM in New York, 01:30 next day in Karachi. */
const NOW = new Date("2026-07-19T20:30:00Z");

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

describe("BUILT_IN_PLACEHOLDERS catalog", () => {
  it("is the single source of truth for SUPPORTED_PLACEHOLDERS", () => {
    expect([...SUPPORTED_PLACEHOLDERS]).toEqual(BUILT_IN_PLACEHOLDERS.map((p) => p.token));
  });
  it("has no duplicate tokens and a label + group for each", () => {
    const tokens = BUILT_IN_PLACEHOLDERS.map((p) => p.token);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const p of BUILT_IN_PLACEHOLDERS) {
      expect(p.token).toMatch(/^\{\{[a-z0-9_]+\}\}$/);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.group.length).toBeGreaterThan(0);
    }
  });
  it("matches buildReplacements exactly in both directions (drift guard)", () => {
    const produced = new Set(buildReplacements(snapshot).map((r) => r.token));
    const catalog = new Set(BUILT_IN_PLACEHOLDERS.map((p) => p.token));
    expect([...produced].sort()).toEqual([...catalog].sort());
  });
  it("keeps the original ten tokens", () => {
    const catalog = new Set(BUILT_IN_PLACEHOLDERS.map((p) => p.token));
    for (const t of [
      "{{business_name}}", "{{business_phone}}", "{{business_email}}", "{{one_time_price}}",
      "{{yearly_price}}", "{{date}}", "{{agent_name}}", "{{provider_name}}",
      "{{provider_phone}}", "{{provider_email}}",
    ]) {
      expect(catalog.has(t)).toBe(true);
    }
  });
});

describe("date & time placeholders", () => {
  function at(timeZone?: string) {
    return new Map(buildReplacements(snapshot, { now: NOW, timeZone }).map((r) => [r.token, r.value]));
  }

  it("renders UTC when no timezone is configured", () => {
    const m = at();
    expect(m.get("{{current_date}}")).toBe("2026-07-19");
    expect(m.get("{{current_time}}")).toBe("8:30 PM");
    expect(m.get("{{current_datetime}}")).toBe("2026-07-19 8:30 PM");
    expect(m.get("{{date_long}}")).toBe("July 19, 2026");
    expect(m.get("{{year}}")).toBe("2026");
    expect(m.get("{{month}}")).toBe("07");
    expect(m.get("{{day}}")).toBe("19");
  });

  it("honours the configured work timezone", () => {
    const m = at("America/New_York");
    expect(m.get("{{current_date}}")).toBe("2026-07-19");
    expect(m.get("{{current_time}}")).toBe("4:30 PM");
    expect(m.get("{{date_long}}")).toBe("July 19, 2026");
  });

  it("rolls the date over in a timezone ahead of UTC", () => {
    const m = at("Asia/Karachi");
    expect(m.get("{{current_date}}")).toBe("2026-07-20");
    expect(m.get("{{date_long}}")).toBe("July 20, 2026");
    expect(m.get("{{day}}")).toBe("20");
  });

  it("falls back to UTC for an invalid timezone", () => {
    const m = at("Not/AZone");
    expect(m.get("{{current_date}}")).toBe("2026-07-19");
  });

  it("keeps {{date}} as the snapshot contract date", () => {
    const m = at("Asia/Karachi");
    expect(m.get("{{date}}")).toBe("2026-07-19");
  });
});

const lead = {
  business_name: "Acme Plumbing",
  business_phone: "+1 555 111 2222",
  website_link: null,
  site_type: "Redesign",
  services: ["Plumbing", "Drain cleaning"],
  service_areas: [],
  specify_pages: null,
  num_webpages: 5,
  client_experience: 0,
  price_quoted: 1200,
  yearly_price: "300",
  add_ons: [
    { id: "a", label: "Logo design", price: 100 },
    { id: "b", label: "SEO", price: null },
  ],
} as unknown as Lead;

describe("formatLeadField", () => {
  it("formats text fields", () => {
    expect(formatLeadField(lead, "business_name")).toBe("Acme Plumbing");
    expect(formatLeadField(lead, "site_type")).toBe("Redesign");
  });
  it("returns '' for null/empty text", () => {
    expect(formatLeadField(lead, "website_link")).toBe("");
  });
  it("joins list fields with a comma", () => {
    expect(formatLeadField(lead, "services")).toBe("Plumbing, Drain cleaning");
  });
  it("returns '' for empty and null lists", () => {
    expect(formatLeadField(lead, "service_areas")).toBe("");
    expect(formatLeadField(lead, "specify_pages")).toBe("");
  });
  it("joins add_ons by label", () => {
    expect(formatLeadField(lead, "add_ons")).toBe("Logo design, SEO");
  });
  it("formats money fields as USD (number and string sources)", () => {
    expect(formatLeadField(lead, "price_quoted")).toBe("$1,200.00");
    expect(formatLeadField(lead, "yearly_price")).toBe("$300.00");
  });
  it("returns '' for missing money", () => {
    expect(formatLeadField({ ...lead, price_quoted: null, yearly_price: null } as Lead, "price_quoted")).toBe("");
    expect(formatLeadField({ ...lead, yearly_price: null } as Lead, "yearly_price")).toBe("");
  });
  it("stringifies numbers, including zero", () => {
    expect(formatLeadField(lead, "num_webpages")).toBe("5");
    expect(formatLeadField(lead, "client_experience")).toBe("0");
  });
  it("returns '' for an unknown / non-whitelisted field", () => {
    expect(formatLeadField(lead, "comments")).toBe("");
    expect(formatLeadField(lead, "rating")).toBe("");
  });
  it("never whitelists sensitive internal fields", () => {
    for (const k of ["rating", "comments", "agent_id", "created_by", "deleted_at", "follow_up_time", "tag_ids"]) {
      expect(Object.hasOwn(LEAD_FIELD_SOURCES, k)).toBe(false);
    }
  });
});

describe("normalizeToken", () => {
  it("accepts a bare name", () => {
    expect(normalizeToken("owner_name")).toBe("{{owner_name}}");
  });
  it("accepts an already-wrapped token and trims whitespace", () => {
    expect(normalizeToken("  {{ owner_name }}  ")).toBe("{{owner_name}}");
  });
  it("lowercases", () => {
    expect(normalizeToken("Owner_Name")).toBe("{{owner_name}}");
  });
  it("rejects empty / invalid input", () => {
    expect(normalizeToken("")).toBeNull();
    expect(normalizeToken("   ")).toBeNull();
    expect(normalizeToken("{{}}")).toBeNull();
    expect(normalizeToken("owner name")).toBeNull();
    expect(normalizeToken("owner-name")).toBeNull();
    expect(normalizeToken("owner.name")).toBeNull();
    expect(normalizeToken("{{owner")).toBeNull();
  });
  it("allows digits and underscores", () => {
    expect(normalizeToken("line_2")).toBe("{{line_2}}");
  });
  it("detects collisions with built-in tokens", () => {
    expect(isBuiltInToken(normalizeToken("business_name")!)).toBe(true);
    expect(isBuiltInToken(normalizeToken("Date")!)).toBe(true);
    expect(isBuiltInToken("{{owner_name}}")).toBe(false);
  });
});

describe("unmappedPlaceholders", () => {
  it("flags tokens a template uses that we don't support", () => {
    const found = ["{{business_name}}", "{{signature_image}}", "{{date}}"];
    expect(unmappedPlaceholders(found)).toEqual(["{{signature_image}}"]);
  });
  it("treats registered custom tokens as mapped", () => {
    const found = ["{{business_name}}", "{{owner_name}}", "{{signature_image}}"];
    expect(unmappedPlaceholders(found, ["{{owner_name}}"])).toEqual(["{{signature_image}}"]);
  });
  it("counts the new date/time tokens as mapped", () => {
    expect(unmappedPlaceholders(["{{current_date}}", "{{year}}"])).toEqual([]);
  });
});
