import { describe, it, expect } from "vitest";
import { writePage, buildPagePrompt, WRITER_SYSTEM } from "@/lib/site-studio/run/writer";
import type { PageDef } from "@/lib/site-studio/schema";
import type { Dossier } from "@/lib/site-studio/run/dossier";

const page = {
  id: "index", file: "index.html", kind: "home", stampable: false,
  title_sample: "PlumberPro | Trusted Plumbing in Austin",
  slots: [
    { id: "index_s1", type: "text", sample: "Fast, Friendly Plumbing You Can Trust", html: false, max_chars: 60, semantic: "headline" },
    { id: "index_i1", type: "image", sample: "img/hero.jpg", html: false },
    { id: "index_s2", type: "text", sample: "We serve Austin homeowners.", html: false, max_chars: 90 },
  ],
  repeats: [{ id: "index_r1", fragment: "index_r1", min: 1, max: 12,
    slots: [{ id: "index_r1_s1", type: "text", sample: "Drain Cleaning", html: false, max_chars: 40 }],
    samples: [{ index_r1_s1: "Drain Cleaning" }, { index_r1_s1: "Water Heaters" }] }],
} as unknown as PageDef;

const dossier = {
  lead_id: "l1", business_name: "Acme Plumbing", phone: "(303) 555-1234", no_email: true,
  services: ["Sewer Repair", "Water Heaters"], service_areas: ["Denver"], years_experience: 12,
  about_business: "Family run since 2012.", requested_pages: [], design_references: [],
  add_ons: [], client_photos: [],
} as Dossier;

describe("buildPagePrompt", () => {
  const p = buildPagePrompt(page, dossier, { stampValue: undefined });
  it("sends the client's facts and the slots to fill", () => {
    expect(p).toContain("Acme Plumbing");
    expect(p).toContain("Sewer Repair");
    expect(p).toContain("index_s1");
    expect(p).toContain("60");                 // max_chars budget
    expect(p).toContain("headline");           // semantic label
  });
  it("never asks the model for image slots", () => {
    expect(p).not.toContain("index_i1");
  });
  it("includes repeat rows so cards get written", () => {
    expect(p).toContain("index_r1_s1");
  });
  it("passes the stamp value for a fan-out page", () => {
    expect(buildPagePrompt(page, dossier, { stampValue: "Sewer Repair" })).toContain("Sewer Repair");
  });
  it("the system prompt carries the non-negotiable rules", () => {
    expect(WRITER_SYSTEM).toMatch(/never invent/i);
    expect(WRITER_SYSTEM).toMatch(/plain text/i);
  });
});

describe("writePage", () => {
  it("parses a strict-JSON reply into slot values and a title", async () => {
    const call = async () => ({ text: JSON.stringify({
      title: "Acme Plumbing | Denver Plumbers",
      slots: { index_s1: "Denver Plumbing Done Right", index_s2: "We serve Denver homeowners." },
      repeats: { index_r1: [{ index_r1_s1: "Sewer Repair" }, { index_r1_s1: "Water Heaters" }] },
    }) });
    const r = await writePage(page, dossier, {}, call);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.title).toBe("Acme Plumbing | Denver Plumbers");
    expect(r.slots.index_s1).toBe("Denver Plumbing Done Right");
    expect(r.repeats.index_r1).toHaveLength(2);
  });
  it("tolerates fenced JSON", async () => {
    // Includes valid repeats — this page declares index_r1, and a complete
    // repeat is now required for ok:true (see the repeat-completeness tests
    // below), so the fixture must satisfy that to isolate what this test
    // actually checks: fenced-JSON tolerance.
    const call = async () => ({
      text:
        "```json\n{\"title\":\"T\",\"slots\":{\"index_s1\":\"A\",\"index_s2\":\"B\"}," +
        "\"repeats\":{\"index_r1\":[{\"index_r1_s1\":\"Card A\"},{\"index_r1_s1\":\"Card B\"}]}}\n```",
    });
    expect((await writePage(page, dossier, {}, call)).ok).toBe(true);
  });
  it("fails loudly on unparseable output — never silently blank", async () => {
    const r = await writePage(page, dossier, {}, async () => ({ text: "sorry!" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/json/i);
  });
  it("rejects markup and token syntax in values", async () => {
    const bad = async () => ({
      text: JSON.stringify({
        title: "T",
        slots: { index_s1: "<b>hi</b>", index_s2: "ok" },
        repeats: { index_r1: [{ index_r1_s1: "Card A" }, { index_r1_s1: "Card B" }] },
      }),
    });
    const r = await writePage(page, dossier, {}, bad);
    expect(r.ok).toBe(false);
  });
  it("truncates an over-long value rather than failing the page", async () => {
    const long = "x".repeat(500);
    const call = async () => ({
      text: JSON.stringify({
        title: "T",
        slots: { index_s1: long, index_s2: "ok" },
        repeats: { index_r1: [{ index_r1_s1: "Card A" }, { index_r1_s1: "Card B" }] },
      }),
    });
    const r = await writePage(page, dossier, {}, call);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slots.index_s1.length).toBeLessThanOrEqual(60);
  });
  it("reports missing slots instead of inventing them", async () => {
    const call = async () => ({ text: JSON.stringify({ title: "T", slots: { index_s1: "only one" } }) });
    const r = await writePage(page, dossier, {}, call);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("index_s2");
  });

  it("rejects markup, token syntax and URLs in a repeat row value — the real danger is {{id:*}} substituting the client's real data into a testimonial card", async () => {
    const bad = async () => ({
      text: JSON.stringify({
        title: "T",
        slots: { index_s1: "A", index_s2: "B" },
        repeats: {
          index_r1: [
            { index_r1_s1: "<img src=x onerror=alert(1)> visit {{id:phone}} at {{link:contact}} " + "y".repeat(500) },
            { index_r1_s1: "fine" },
          ],
        },
      }),
    });
    const r = await writePage(page, dossier, {}, bad);
    expect(r.ok).toBe(false);
  });

  it("truncates an over-long repeat row value to that repeat slot's own max_chars", async () => {
    const long = "x".repeat(500);
    const call = async () => ({
      text: JSON.stringify({
        title: "T",
        slots: { index_s1: "A", index_s2: "B" },
        repeats: { index_r1: [{ index_r1_s1: long }, { index_r1_s1: "fine" }] },
      }),
    });
    const r = await writePage(page, dossier, {}, call);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // index_r1's own slot (index_r1_s1) declares max_chars: 40 — distinct
    // from index_s1's 60, so this proves the row is truncated to ITS OWN
    // slot's budget, not the top-level slot's.
    expect(r.repeats.index_r1[0].index_r1_s1.length).toBeLessThanOrEqual(40);
  });

  it("fails when a repeat id the page declares is missing from the reply entirely — never silently blank", async () => {
    const call = async () => ({
      text: JSON.stringify({ title: "T", slots: { index_s1: "A", index_s2: "B" } }),
    });
    const r = await writePage(page, dossier, {}, call);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("index_r1");
  });

  it("fails when a repeat comes back with zero rows", async () => {
    const call = async () => ({
      text: JSON.stringify({ title: "T", slots: { index_s1: "A", index_s2: "B" }, repeats: { index_r1: [] } }),
    });
    const r = await writePage(page, dossier, {}, call);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("index_r1");
  });

  it("fails when a repeat row is missing one of its declared slot fields", async () => {
    const call = async () => ({
      text: JSON.stringify({
        title: "T",
        slots: { index_s1: "A", index_s2: "B" },
        repeats: { index_r1: [{ index_r1_s1: "Card A" }, {}] },
      }),
    });
    const r = await writePage(page, dossier, {}, call);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("index_r1");
  });
});
