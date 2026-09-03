import { describe, it, expect } from "vitest";
import { emptyNewLead, buildLeadPayload, cleanSocialProfiles } from "@/lib/leads/newLeadForm";
import { createLeadSchema } from "@/lib/leads/schema";
import { blamesLateColumn, withoutLateColumns, LATE_LEAD_COLUMNS } from "@/lib/leads/lateColumns";

/** A form state that passes validation, so payload shape is the only variable. */
function filled() {
  return {
    ...emptyNewLead("Ready"),
    business_name: "Acme Roofing",
    business_phone: "(252) 401-2775",
    business_email: "hi@acme.com",
    platform: "Google",
    business_profile_link: "https://maps.google.com/acme",
    has_service_areas: "No" as const,
    services: ["Roofing"],
    client_experience: "12",
    color_scheme: "navy, white",
    follow_up_time: new Date(Date.now() + 86_400_000).toISOString().slice(0, 16),
    price_quoted: "500",
    comments: "Keen",
    rating: 8,
    fresh_or_followup: "Fresh",
  };
}

describe("owner name", () => {
  it("travels to the payload, trimmed", () => {
    expect(buildLeadPayload({ ...filled(), owner_name: "  Maria Alvarez " }).owner_name).toBe("Maria Alvarez");
  });

  it("is optional — blank becomes null, never an empty string", () => {
    expect(buildLeadPayload(filled()).owner_name).toBeNull();
  });
});

describe("instructions for developer", () => {
  it("travels to the payload, trimmed", () => {
    const p = buildLeadPayload({ ...filled(), developer_instructions: "  Keep booking in the header \n" });
    expect(p.developer_instructions).toBe("Keep booking in the header");
  });

  it("is optional", () => {
    expect(buildLeadPayload(filled()).developer_instructions).toBeNull();
  });
});

describe("social profiles", () => {
  it("keeps every profile the agent added, in order", () => {
    const p = buildLeadPayload({
      ...filled(),
      social_profiles: [
        { platform: "Facebook", url: "https://fb.com/acme" },
        { platform: "Instagram", url: "https://instagram.com/acme" },
        { platform: "TikTok", url: "https://tiktok.com/@acme" },
        { platform: "X", url: "https://x.com/acme" },
      ],
    });
    expect(p.social_profiles).toHaveLength(4);
    expect(p.social_profiles?.map((s) => s.platform)).toEqual(["Facebook", "Instagram", "TikTok", "X"]);
  });

  it("carries the network name for Other in `label`, leaving platform canonical", () => {
    // Storing the typed name AS the platform would stop the select matching it
    // on a later edit, so the canonical five stay in `platform`.
    const [only] = cleanSocialProfiles([{ platform: "Other", url: "https://pin.it/acme", label: " Pinterest " }]);
    expect(only).toEqual({ platform: "Other", url: "https://pin.it/acme", label: "Pinterest" });
  });

  it("drops the half-filled rows a repeater leaves behind", () => {
    const cleaned = cleanSocialProfiles([
      { platform: "Facebook", url: "https://fb.com/acme" },
      { platform: "Instagram", url: "   " },
      { platform: "Other", url: "https://somewhere.example", label: "" },
    ]);
    expect(cleaned).toEqual([{ platform: "Facebook", url: "https://fb.com/acme", label: null }]);
  });

  it("sends null rather than an empty array when none were added", () => {
    expect(buildLeadPayload(filled()).social_profiles).toBeNull();
  });

  it("clears `label` when the platform is switched away from Other", () => {
    const [only] = cleanSocialProfiles([{ platform: "Facebook", url: "https://fb.com/a", label: "Pinterest" }]);
    expect(only.label).toBeNull();
  });
});

describe("createLeadSchema", () => {
  it("accepts the three new fields", () => {
    const parsed = createLeadSchema.safeParse({
      business_name: "Acme",
      status: "Ready",
      owner_name: "Maria",
      developer_instructions: "Header stays sticky",
      social_profiles: [{ platform: "Facebook", url: "https://fb.com/acme", label: null }],
    });
    expect(parsed.success).toBe(true);
  });

  it("still accepts a lead that omits them entirely", () => {
    expect(createLeadSchema.safeParse({ business_name: "Acme", status: "Ready" }).success).toBe(true);
  });

  it("rejects a social profile with no url", () => {
    const parsed = createLeadSchema.safeParse({
      business_name: "Acme",
      status: "Ready",
      social_profiles: [{ platform: "Facebook", url: "" }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("late-column tolerance", () => {
  it("recognises PostgREST's schema-cache complaint", () => {
    expect(
      blamesLateColumn("Could not find the 'owner_name' column of 'leads' in the schema cache"),
    ).toBe(true);
  });

  it("recognises Postgres's own wording", () => {
    expect(blamesLateColumn('column "social_profiles" of relation "leads" does not exist')).toBe(true);
  });

  it("covers every column migration 0073 adds", () => {
    for (const c of LATE_LEAD_COLUMNS) {
      expect(blamesLateColumn(`column "${c}" does not exist`)).toBe(true);
    }
  });

  it("does not swallow an unrelated failure", () => {
    // A retry that strips columns must not paper over a real constraint error.
    expect(blamesLateColumn("new row violates row-level security policy")).toBe(false);
    expect(blamesLateColumn(null)).toBe(false);
  });

  it("strips all late columns at once, keeping everything else", () => {
    const row = {
      business_name: "Acme",
      owner_name: "Maria",
      developer_instructions: "x",
      social_profiles: [],
      follow_up_set_at: "2026-09-04T00:00:00Z",
      rating: 8,
    };
    expect(withoutLateColumns(row)).toEqual({ business_name: "Acme", rating: 8 });
  });
});
