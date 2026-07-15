import { describe, it, expect } from "vitest";
import { classifyFiles } from "@/lib/template-engine/classify";

describe("classifyFiles", () => {
  const files = ["index.html","about.html","style.css","script.js","components.js",
                 "images/hero-1.jpg",".thumbnail","vendor/gsap.min.js"];
  it("treats EVERY html and content js as regenerable (v1 skipped script.js)", () => {
    const c = classifyFiles(files);
    expect(c.content).toContain("index.html");
    expect(c.content).toContain("about.html");
    expect(c.content).toContain("script.js");     // the v1 bug
    expect(c.content).toContain("components.js");
  });
  it("never regenerates CSS — the design is preserved by construction", () => {
    const c = classifyFiles(files);
    expect(c.content).not.toContain("style.css");
    expect(c.passthrough).toContain("style.css");
  });
  it("passes through binaries and minified vendor bundles", () => {
    const c = classifyFiles(files);
    expect(c.passthrough).toContain("images/hero-1.jpg");
    expect(c.passthrough).toContain("vendor/gsap.min.js"); // .min.js is vendor, not content
    expect(c.passthrough).toContain(".thumbnail");
  });
  it("classifies every input exactly once", () => {
    const c = classifyFiles(files);
    expect([...c.content, ...c.passthrough].sort()).toEqual([...files].sort());
  });
});
