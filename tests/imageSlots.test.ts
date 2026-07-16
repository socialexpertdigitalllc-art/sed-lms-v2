import { describe, it, expect } from "vitest";
import {
  slotDefaults,
  rankAndTrim,
  mergeCandidates,
  parseImageSlots,
  type ImageCandidate,
} from "@/lib/template-engine/imageSlots";

const candidate = (over: Partial<ImageCandidate> = {}): ImageCandidate => ({
  url: "https://example.com/a.jpg",
  thumb: "https://example.com/a-thumb.jpg",
  source: "pexels",
  ...over,
});

describe("slotDefaults", () => {
  it("gives hero slots 3 picks / 6 presented", () => {
    expect(slotDefaults("hero")).toEqual({ pick_max: 3, present_max: 6 });
  });

  it("gives every other kind 1 pick / 5 presented", () => {
    expect(slotDefaults("service")).toEqual({ pick_max: 1, present_max: 5 });
    expect(slotDefaults("gallery")).toEqual({ pick_max: 1, present_max: 5 });
    expect(slotDefaults("about")).toEqual({ pick_max: 1, present_max: 5 });
  });
});

describe("rankAndTrim", () => {
  it("drops vision.people candidates only when excludePeople is true", () => {
    const withPerson = candidate({ url: "p", vision: { people: true, relevance: 0.9, quality: 0.9, reason: "x" } });
    const clean = candidate({ url: "c", vision: { people: false, relevance: 0.1, quality: 0.1, reason: "y" } });

    const dropped = rankAndTrim([withPerson, clean], { excludePeople: true, presentMax: 10 });
    expect(dropped.map((c) => c.url)).toEqual(["c"]);

    const kept = rankAndTrim([withPerson, clean], { excludePeople: false, presentMax: 10 });
    expect(kept.map((c) => c.url)).toEqual(["p", "c"]); // p scores 0.81 vs c's 0.01
  });

  it("sorts by relevance*quality descending", () => {
    const low = candidate({ url: "low", vision: { people: false, relevance: 0.2, quality: 0.9, reason: "" } }); // 0.18
    const high = candidate({ url: "high", vision: { people: false, relevance: 0.9, quality: 0.9, reason: "" } }); // 0.81
    const mid = candidate({ url: "mid", vision: { people: false, relevance: 0.5, quality: 0.5, reason: "" } }); // 0.25

    const out = rankAndTrim([low, high, mid], { excludePeople: true, presentMax: 10 });
    expect(out.map((c) => c.url)).toEqual(["high", "mid", "low"]);
  });

  it("keeps candidates with no vision verdict but sorts them after scored ones", () => {
    const scored = candidate({ url: "scored", vision: { people: false, relevance: 0.1, quality: 0.1, reason: "" } }); // 0.01
    const unscored = candidate({ url: "unscored" }); // no vision field at all

    const out = rankAndTrim([unscored, scored], { excludePeople: true, presentMax: 10 });
    expect(out.map((c) => c.url)).toEqual(["scored", "unscored"]);
  });

  it("never drops client photos even when they show people, and sorts them first", () => {
    const clientWithPerson = candidate({
      url: "client",
      source: "client",
      vision: { people: true, relevance: 0, quality: 0, reason: "" },
    });
    const bestPexels = candidate({ url: "pexels-best", vision: { people: false, relevance: 1, quality: 1, reason: "" } });

    const out = rankAndTrim([bestPexels, clientWithPerson], { excludePeople: true, presentMax: 10 });
    expect(out.map((c) => c.url)).toEqual(["client", "pexels-best"]);
  });

  it("respects presentMax", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      candidate({ url: `u${i}`, vision: { people: false, relevance: 1, quality: 1, reason: "" } }),
    );
    expect(rankAndTrim(many, { excludePeople: true, presentMax: 3 })).toHaveLength(3);
  });
});

describe("mergeCandidates", () => {
  it("unions by url, existing first, no duplicates", () => {
    const existing = [candidate({ url: "a" }), candidate({ url: "b" })];
    const fresh = [candidate({ url: "b" }), candidate({ url: "c" })];
    const merged = mergeCandidates(existing, fresh);
    expect(merged.map((c) => c.url)).toEqual(["a", "b", "c"]);
  });

  it("appends without duplicating across repeated 'show more' calls", () => {
    const existing = [candidate({ url: "a" })];
    const round1 = mergeCandidates(existing, [candidate({ url: "b" })]);
    const round2 = mergeCandidates(round1, [candidate({ url: "a" }), candidate({ url: "c" })]);
    expect(round2.map((c) => c.url)).toEqual(["a", "b", "c"]);
  });
});

describe("parseImageSlots", () => {
  it("returns an empty array for non-array input", () => {
    expect(parseImageSlots(null)).toEqual([]);
    expect(parseImageSlots(undefined)).toEqual([]);
    expect(parseImageSlots({})).toEqual([]);
    expect(parseImageSlots("nope")).toEqual([]);
  });

  it("keeps only entries that look like a real ImageSlot", () => {
    const good = { id: "hero", kind: "hero", label: "Hero", pick_max: 3, present_max: 6, candidates: [], selected: [] };
    const missingId = { kind: "hero", candidates: [], selected: [] };
    const candidatesNotArray = { id: "x", kind: "hero", candidates: "nope", selected: [] };
    const notAnObject = 42;
    expect(parseImageSlots([good, missingId, candidatesNotArray, null, notAnObject])).toEqual([good]);
  });

  it("passes optional fields like next_page through untouched", () => {
    const withPage = {
      id: "hero",
      kind: "hero",
      label: "Hero",
      pick_max: 3,
      present_max: 6,
      candidates: [],
      selected: [],
      next_page: 4,
    };
    expect(parseImageSlots([withPage])[0].next_page).toBe(4);
  });
});
