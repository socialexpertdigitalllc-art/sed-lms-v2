import { describe, it, expect } from "vitest";
import { pexelsToCandidate } from "@/lib/template-engine/gatherImages";
import type { PexelsPhoto } from "@/lib/template-engine/pexels";

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
