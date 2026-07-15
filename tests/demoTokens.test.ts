import { describe, it, expect } from "vitest";
import { extractDemoTokens, findLeaks } from "@/lib/template-engine/demoTokens";

const html = `<html><head><title>Northpoint Remodeling - Denver Kitchens</title></head>
<body><h1>NORTHPOINT REMODELING</h1><p>Serving Cherry Creek and Denver.</p>
<a href="tel:+13035551234">(303) 555-1234</a>
<a href="mailto:hello@northpointremodel.com">email</a></body></html>`;
const js = `class NorthpointApp { } window.northpointApp = new NorthpointApp();`;

describe("extractDemoTokens", () => {
  it("finds the demo business name, city, phone, email and JS identifier", () => {
    const t = extractDemoTokens({ "index.html": html, "script.js": js });
    const lower = t.map((x) => x.toLowerCase());
    expect(lower).toContain("northpoint remodeling");
    expect(lower.some((x) => x.includes("cherry creek"))).toBe(true);
    expect(lower.some((x) => x.includes("denver"))).toBe(true);
    expect(t).toContain("(303) 555-1234");
    expect(t.some((x) => x.includes("northpointremodel.com"))).toBe(true);
    expect(t.some((x) => x.toLowerCase().includes("northpointapp"))).toBe(true);
  });
  it("does not emit trivially short or generic tokens", () => {
    const t = extractDemoTokens({ "index.html": html });
    expect(t.every((x) => x.length >= 4)).toBe(true);
    expect(t.map((s) => s.toLowerCase())).not.toContain("html");
  });
});

describe("findLeaks", () => {
  const tokens = ["Northpoint Remodeling", "Cherry Creek", "(303) 555-1234"];
  it("reports every file containing a demo token (case-insensitive)", () => {
    const leaks = findLeaks({ "a.html": "Welcome to northpoint remodeling!", "b.html": "clean" }, tokens);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].file).toBe("a.html");
    expect(leaks[0].token).toBe("Northpoint Remodeling");
  });
  it("returns [] when the output is clean (the pass condition)", () => {
    expect(findLeaks({ "a.html": "Inside Out Painting, Brentwood NY" }, tokens)).toEqual([]);
  });
  it("catches a leak in JS as well as HTML", () => {
    expect(findLeaks({ "script.js": "window.northpointApp" }, ["northpointApp"])).toHaveLength(1);
  });
});
