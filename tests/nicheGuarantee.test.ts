import { describe, it, expect, vi } from "vitest";

// nicheGuarantee imports personalize.ts (for the scrub/classification machinery)
// which imports the provider seam — mock it so no live AI call is possible.
vi.mock("@/lib/ai-tools/providers/run", () => ({
  callForTask: vi.fn(async () => {
    throw new Error("no live AI calls in nicheGuarantee tests");
  }),
}));

const {
  findNicheDrift,
  isNicheTermClientSafe,
  repairNoteForNiche,
  guaranteeNoNicheDrift,
  describeNicheGuarantee,
  nicheDriftFingerprint,
} = await import("@/lib/template-engine/nicheGuarantee");

/** The recurring remodeling-service phrases nicheTerms.ts would derive from "First template". */
const NICHE_TERMS = [
  "kitchen remodeling",
  "bathroom remodeling",
  "kitchen remodel",
  "custom cabinetry",
  "every subcontractor",
];

/** The real failing client: window tinting, NOT remodeling. */
const TINT_MODEL = {
  identity: { name: "Knights Auto Window Tint", areas: ["Denver"] },
  services: [
    { name: "Auto Window Tinting" },
    { name: "Ceramic Coating" },
    { name: "PPF" },
    { name: "Vehicle Wraps" },
  ],
};

/** A REAL remodeler, for whom "Kitchen Remodeling" is legitimate, not drift. */
const REMODELER_MODEL = {
  identity: { name: "Warrior Contracting", areas: ["Aurora"] },
  services: [{ name: "Kitchen Remodeling" }, { name: "Bathroom Remodeling" }],
};

// The exact quoted excerpts from the real failing index.html.
const REAL_FAILURE_HTML = `<!doctype html>
<html><body>
<h1>Knights Auto Window Tint</h1>
<p>Full-service remodeling, start to finish.</p>
<p>Two decades turning houses into the home you actually wanted.</p>
<img src="img/kitchen.jpg" alt="Kitchen remodeling">
<img src="img/bath.jpg" alt="Bathroom remodeling">
<select><option>Kitchen remodel</option><option>Bathroom remodel</option></select>
</body></html>`;

describe("isNicheTermClientSafe", () => {
  it("a term the client's OWN services do not include is NOT client-safe", () => {
    expect(isNicheTermClientSafe("kitchen remodeling", TINT_MODEL)).toBe(false);
  });
  it("a term the client's OWN services DO include is client-safe", () => {
    expect(isNicheTermClientSafe("kitchen remodeling", REMODELER_MODEL)).toBe(true);
    expect(isNicheTermClientSafe("bathroom remodeling", REMODELER_MODEL)).toBe(true);
  });
  it("is case-insensitive and whole-phrase", () => {
    expect(isNicheTermClientSafe("KITCHEN REMODELING", REMODELER_MODEL)).toBe(true);
    // "kitchen" alone appearing nowhere in "Kitchen Remodeling"'s neighbour word
    // "remodel" should not falsely satisfy a DIFFERENT, longer niche term.
    expect(isNicheTermClientSafe("kitchen remodel", REMODELER_MODEL)).toBe(false);
  });
  it("also checks the brief's raw services/about_business/site_type when supplied", () => {
    const brief = {
      business_name: "Knights Auto Window Tint",
      site_type: "Auto Tinting",
      services: ["Auto Window Tinting", "Ceramic Coating", "PPF"],
      about_business: "We specialize in ceramic coating and paint protection film.",
    };
    expect(isNicheTermClientSafe("ceramic coating", null, brief)).toBe(true);
    expect(isNicheTermClientSafe("kitchen remodeling", null, brief)).toBe(false);
  });
});

describe("findNicheDrift", () => {
  it("flags a drifted term for a client whose services do not include it", () => {
    const hits = findNicheDrift({
      files: { "index.html": REAL_FAILURE_HTML },
      nicheTerms: NICHE_TERMS,
      contentModel: TINT_MODEL,
    });
    const terms = new Set(hits.map((h) => h.term));
    expect(terms.has("kitchen remodeling")).toBe(true);
    expect(terms.has("bathroom remodeling")).toBe(true);
    expect(terms.has("kitchen remodel")).toBe(true);
  });

  it("does NOT flag a term the client's own services legitimately include", () => {
    const hits = findNicheDrift({
      files: { "index.html": REAL_FAILURE_HTML },
      nicheTerms: NICHE_TERMS,
      contentModel: REMODELER_MODEL,
    });
    const terms = new Set(hits.map((h) => h.term));
    expect(terms.has("kitchen remodeling")).toBe(false);
    expect(terms.has("bathroom remodeling")).toBe(false);
  });

  it("reuses the extraction surface — never flags a contact href or a structural attribute", () => {
    const html = `<div class="kitchen-remodeling-card" data-service="kitchen remodeling"><a href="tel:5551234567">Kitchen remodeling</a></div>`;
    const hits = findNicheDrift({
      files: { "index.html": html },
      nicheTerms: ["kitchen remodeling"],
      contentModel: TINT_MODEL,
    });
    // The visible <a> text (not the tel: href itself) is the one real occurrence.
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("Kitchen remodeling");
  });

  it("returns [] when there are no niche terms to check", () => {
    expect(findNicheDrift({ files: { "index.html": REAL_FAILURE_HTML }, nicheTerms: [], contentModel: TINT_MODEL })).toEqual(
      [],
    );
  });
});

describe("repairNoteForNiche", () => {
  it("names the drifted terms and the client's actual business/services", () => {
    const hits = findNicheDrift({
      files: { "index.html": REAL_FAILURE_HTML },
      nicheTerms: NICHE_TERMS,
      contentModel: TINT_MODEL,
    });
    const note = repairNoteForNiche(hits, TINT_MODEL);
    expect(note).toContain("Knights Auto Window Tint");
    expect(note).toMatch(/kitchen remodeling/i);
    expect(note).toMatch(/Auto Window Tinting/);
  });

  it("is empty when there is nothing to repair", () => {
    expect(repairNoteForNiche([], TINT_MODEL)).toBe("");
  });
});

describe("guaranteeNoNicheDrift — the end-to-end postcondition", () => {
  it("neutralizes every drifted niche term for the Knights Auto Window Tint content model", () => {
    const { files, report } = guaranteeNoNicheDrift({
      files: { "index.html": REAL_FAILURE_HTML },
      nicheTerms: NICHE_TERMS,
      contentModel: TINT_MODEL,
    });
    // Postcondition: after the guarantee, findNicheDrift reports nothing left.
    expect(findNicheDrift({ files, nicheTerms: NICHE_TERMS, contentModel: TINT_MODEL })).toEqual([]);
    const out = files["index.html"];
    expect(out).not.toMatch(/kitchen remodeling/i);
    expect(out).not.toMatch(/bathroom remodeling/i);
    expect(out).not.toMatch(/kitchen remodel\b/i);
    // Neutralized with one of the CLIENT's own services, not blanked.
    expect(out).toMatch(/Auto Window Tinting|Ceramic Coating|PPF|Vehicle Wraps/);
    expect(report.fixes.length).toBeGreaterThan(0);
    expect(describeNicheGuarantee(report)).toMatch(/^category-drift guarantee fixed \d+ occurrence\(s\) across \d+ file\(s\)$/);
  });

  it("never touches vocabulary the client legitimately shares with the template", () => {
    // Restricted to the two terms the remodeler's OWN services name exactly
    // ("Kitchen Remodeling" / "Bathroom Remodeling") — "kitchen remodel" (the
    // dropdown option, without the "-ing") is deliberately excluded here: it is
    // a whole-phrase near-miss against the client's real service name, which
    // this guarantee (like every other whole-word/phrase check in this
    // pipeline) does not fuzz-match, so it is neutralized rather than left —
    // never LEFT WRONG, which is the property this guarantee exists to prove.
    const terms = ["kitchen remodeling", "bathroom remodeling"];
    const { files, report } = guaranteeNoNicheDrift({
      files: { "index.html": REAL_FAILURE_HTML },
      nicheTerms: terms,
      contentModel: REMODELER_MODEL,
    });
    // A real remodeler's "Kitchen remodeling" / "Bathroom remodeling" survive untouched.
    expect(files["index.html"]).toContain("Kitchen remodeling");
    expect(files["index.html"]).toContain("Bathroom remodeling");
    expect(report.fixes).toEqual([]);
    expect(describeNicheGuarantee(report)).toBe("");
  });

  it("preserves markup — tag counts are unchanged", () => {
    const before = (REAL_FAILURE_HTML.match(/<img/g) ?? []).length;
    const { files } = guaranteeNoNicheDrift({
      files: { "index.html": REAL_FAILURE_HTML },
      nicheTerms: NICHE_TERMS,
      contentModel: TINT_MODEL,
    });
    const after = (files["index.html"].match(/<img/g) ?? []).length;
    expect(after).toBe(before);
  });

  it("is idempotent and a no-op on clean input", () => {
    const clean = { "index.html": `<p>Auto window tinting and ceramic coating done right.</p>` };
    const { files, report } = guaranteeNoNicheDrift({ files: clean, nicheTerms: NICHE_TERMS, contentModel: TINT_MODEL });
    expect(files).toEqual(clean);
    expect(report).toEqual({ fixes: [], skipped: [] });

    const first = guaranteeNoNicheDrift({
      files: { "index.html": REAL_FAILURE_HTML },
      nicheTerms: NICHE_TERMS,
      contentModel: TINT_MODEL,
    });
    const second = guaranteeNoNicheDrift({ files: first.files, nicheTerms: NICHE_TERMS, contentModel: TINT_MODEL });
    expect(second.files).toEqual(first.files);
    expect(second.report.fixes).toEqual([]);
  });

  it("returns [] fixes when nicheTerms is empty", () => {
    const { files, report } = guaranteeNoNicheDrift({
      files: { "index.html": REAL_FAILURE_HTML },
      nicheTerms: [],
      contentModel: TINT_MODEL,
    });
    expect(files["index.html"]).toBe(REAL_FAILURE_HTML);
    expect(report.fixes).toEqual([]);
  });
});

describe("nicheDriftFingerprint", () => {
  it("is stable regardless of hit order", () => {
    const a = findNicheDrift({ files: { "index.html": REAL_FAILURE_HTML }, nicheTerms: NICHE_TERMS, contentModel: TINT_MODEL });
    const b = [...a].reverse();
    expect(nicheDriftFingerprint(a)).toBe(nicheDriftFingerprint(b));
  });
  it("differs when the drift set differs", () => {
    const a = findNicheDrift({ files: { "index.html": REAL_FAILURE_HTML }, nicheTerms: NICHE_TERMS, contentModel: TINT_MODEL });
    const b = findNicheDrift({
      files: { "index.html": REAL_FAILURE_HTML },
      nicheTerms: NICHE_TERMS,
      contentModel: REMODELER_MODEL,
    });
    expect(nicheDriftFingerprint(a)).not.toBe(nicheDriftFingerprint(b));
  });
});
