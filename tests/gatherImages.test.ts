import { describe, it, expect } from "vitest";
import { pexelsToCandidate, capImageBriefs } from "@/lib/template-engine/gatherImages";
import type { PexelsPhoto } from "@/lib/template-engine/pexels";
import type { ImageBrief } from "@/lib/template-engine/contentModel";

const brief = (slot_id: string, kind: "hero" | "service"): ImageBrief => ({
  slot_id, kind, query: `${slot_id} photo`, must_show: "", avoid: "people, text overlays, watermarks",
});

describe("capImageBriefs", () => {
  it("keeps the hero + caps service briefs (the 54-slot bug)", () => {
    const briefs = [brief("hero-1", "hero"), ...Array.from({ length: 53 }, (_, i) => brief(`svc-${i}`, "service"))];
    const capped = capImageBriefs(briefs, 8);
    expect(capped.filter((b) => b.kind === "hero")).toHaveLength(1);
    expect(capped.filter((b) => b.kind === "service")).toHaveLength(8);
    expect(capped).toHaveLength(9);
  });
  it("keeps every non-service brief and preserves order", () => {
    const briefs = [brief("hero-1", "hero"), brief("a", "service"), brief("b", "service"), brief("c", "service")];
    expect(capImageBriefs(briefs, 2).map((b) => b.slot_id)).toEqual(["hero-1", "a", "b"]);
  });
  it("leaves a small set untouched", () => {
    const briefs = [brief("hero-1", "hero"), brief("a", "service"), brief("b", "service")];
    expect(capImageBriefs(briefs)).toHaveLength(3);
  });
});

const photo = (over: Partial<PexelsPhoto> = {}): PexelsPhoto => ({
  id: 42,
  width: 3000,
  height: 2000,
  alt: "a roof",
  photographer: "Jane Doe",
  src: {
    original: "https://p.com/o.jpg",
    large2x: "https://p.com/l2x.jpg",
    large: "https://p.com/l.jpg",
    medium: "https://p.com/m.jpg",
  },
  ...over,
});

describe("pexelsToCandidate", () => {
  it("maps id/dims/photographer, and prefers large2x for url, medium for thumb", () => {
    const c = pexelsToCandidate(photo());
    expect(c).toEqual({
      url: "https://p.com/l2x.jpg",
      thumb: "https://p.com/m.jpg",
      source: "pexels",
      photographer: "Jane Doe",
      width: 3000,
      height: 2000,
      pexelsId: 42,
    });
  });

  it("falls back through the url preference chain when large2x is missing", () => {
    const c = pexelsToCandidate(
      photo({ src: { original: "https://p.com/o.jpg", large2x: "", large: "https://p.com/l.jpg", medium: "https://p.com/m.jpg" } }),
    );
    expect(c.url).toBe("https://p.com/o.jpg");
  });

  it("falls back all the way to medium when only medium is present", () => {
    const c = pexelsToCandidate(photo({ src: { original: "", large2x: "", large: "", medium: "https://p.com/m.jpg" } }));
    expect(c.url).toBe("https://p.com/m.jpg");
    expect(c.thumb).toBe("https://p.com/m.jpg");
  });

  it("omits photographer when the photo has none", () => {
    const c = pexelsToCandidate(photo({ photographer: undefined }));
    expect(c.photographer).toBeUndefined();
  });

  it("never sets a vision verdict up front — that's the vision pass's job", () => {
    expect(pexelsToCandidate(photo()).vision).toBeUndefined();
  });
});
