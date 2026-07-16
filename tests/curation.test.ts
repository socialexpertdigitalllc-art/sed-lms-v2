import { describe, it, expect } from "vitest";
import {
  validateSelection,
  addCustomSelection,
  contentTypeIsImage,
  sizeIsSane,
  isHttpUrl,
  emptySlots,
  MAX_CUSTOM_IMAGE_BYTES,
} from "@/lib/template-engine/curation";
import type { ImageSlot, ImageCandidate } from "@/lib/template-engine/imageSlots";

const candidate = (over: Partial<ImageCandidate> = {}): ImageCandidate => ({
  url: "https://example.com/a.jpg",
  thumb: "https://example.com/a-thumb.jpg",
  source: "pexels",
  ...over,
});

const slot = (over: Partial<ImageSlot> = {}): ImageSlot => ({
  id: "hero-1",
  kind: "hero",
  label: "Hero",
  pick_max: 3,
  present_max: 6,
  candidates: [candidate({ url: "a" }), candidate({ url: "b" }), candidate({ url: "c" })],
  selected: [],
  seen_pexels_ids: [],
  ...over,
});

describe("validateSelection", () => {
  it("accepts urls that are all existing candidates within pick_max", () => {
    expect(validateSelection(slot(), ["a", "b"])).toBeNull();
  });

  it("rejects a url that isn't a candidate on the slot", () => {
    expect(validateSelection(slot(), ["a", "nope"])).toMatch(/not a candidate/i);
  });

  it("rejects more urls than pick_max allows", () => {
    expect(validateSelection(slot({ pick_max: 1 }), ["a", "b"])).toMatch(/too many/i);
  });

  it("accepts an empty selection (clearing a pick)", () => {
    expect(validateSelection(slot(), [])).toBeNull();
  });
});

describe("addCustomSelection", () => {
  it("adds a url when under pick_max", () => {
    expect(addCustomSelection([], "new", 3)).toEqual(["new"]);
    expect(addCustomSelection(["a"], "new", 3)).toEqual(["a", "new"]);
  });

  it("evicts the oldest pick (front) when already at pick_max", () => {
    expect(addCustomSelection(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"]);
  });

  it("is a no-op when the url is already selected", () => {
    expect(addCustomSelection(["a", "b"], "a", 3)).toEqual(["a", "b"]);
  });

  it("handles pick_max 1 by replacing the sole pick", () => {
    expect(addCustomSelection(["a"], "b", 1)).toEqual(["b"]);
  });
});

describe("contentTypeIsImage", () => {
  it("accepts any image/* content-type", () => {
    expect(contentTypeIsImage("image/jpeg")).toBe(true);
    expect(contentTypeIsImage("image/png; charset=binary")).toBe(true);
  });

  it("rejects non-image content-types", () => {
    expect(contentTypeIsImage("text/html")).toBe(false);
    expect(contentTypeIsImage("application/pdf")).toBe(false);
  });

  it("rejects null/undefined/empty", () => {
    expect(contentTypeIsImage(null)).toBe(false);
    expect(contentTypeIsImage(undefined)).toBe(false);
    expect(contentTypeIsImage("")).toBe(false);
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(contentTypeIsImage("IMAGE/JPEG")).toBe(true);
    expect(contentTypeIsImage("  image/webp  ")).toBe(true);
  });
});

describe("sizeIsSane", () => {
  it("accepts a null size (unknown — many CDNs omit content-length)", () => {
    expect(sizeIsSane(null)).toBe(true);
  });

  it("accepts sizes at or under the ceiling", () => {
    expect(sizeIsSane(1024)).toBe(true);
    expect(sizeIsSane(MAX_CUSTOM_IMAGE_BYTES)).toBe(true);
  });

  it("rejects sizes over the ceiling", () => {
    expect(sizeIsSane(MAX_CUSTOM_IMAGE_BYTES + 1)).toBe(false);
  });

  it("respects a custom ceiling override", () => {
    expect(sizeIsSane(2000, 1000)).toBe(false);
    expect(sizeIsSane(500, 1000)).toBe(true);
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https urls", () => {
    expect(isHttpUrl("http://example.com/a.jpg")).toBe(true);
    expect(isHttpUrl("https://example.com/a.jpg")).toBe(true);
  });

  it("rejects non-http(s) schemes a server-side fetch should never touch", () => {
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isHttpUrl("ftp://example.com/a.jpg")).toBe(false);
  });

  it("rejects unparseable strings", () => {
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("emptySlots", () => {
  it("lists slots with no selected images", () => {
    const s1 = slot({ id: "hero", label: "Hero", selected: [] });
    const s2 = slot({ id: "kitchen", label: "Kitchen", selected: ["a"] });
    expect(emptySlots([s1, s2])).toEqual([{ id: "hero", label: "Hero" }]);
  });

  it("is empty when every slot has a pick", () => {
    expect(emptySlots([slot({ selected: ["a"] })])).toEqual([]);
  });

  it("is empty for an empty slots array (vacuously satisfied)", () => {
    expect(emptySlots([])).toEqual([]);
  });
});
