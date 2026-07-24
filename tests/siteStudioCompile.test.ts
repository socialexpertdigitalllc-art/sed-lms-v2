import { describe, it, expect } from "vitest";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { manifestSchema } from "@/lib/site-studio/schema";
import { zipFromMap } from "@/lib/site-studio/zip";
import { fixtureZip } from "./helpers/siteStudioFixtures";

describe("compileTemplate (plumberpro)", () => {
  const result = compileTemplate(fixtureZip("plumberpro"), "plumberpro");

  it("produces a schema-valid manifest", () => {
    expect(() => manifestSchema.parse(result.template.manifest)).not.toThrow();
    expect(result.template.manifest.name).toBe("plumberpro");
    expect(result.template.manifest.version).toBe(1);
  });
  it("compiled pages carry zero demo identity or copy", () => {
    const all = Object.values(result.template.pages).join("\n");
    expect(all).not.toContain("PlumberPro");
    expect(all).not.toContain("512");
    expect(all).not.toContain("Drain Cleaning");
    expect(all).not.toContain("Fast, Friendly");
  });
  it("manifest carries the samples instead (identity inside samples stays tokenized)", () => {
    const index = result.template.manifest.pages.find((p) => p.id === "index")!;
    expect(index.title_sample).toContain("{{id:business_name}}");
    expect(index.slots.some((s) => s.sample.includes("Fast, Friendly"))).toBe(true);
    expect(index.repeats[0].samples.map((r) => Object.values(r)[0])).toContain("Drain Cleaning");
  });
  it("internal body links are tokenized (pass 4b)", () => {
    expect(result.template.pages["index.html"]).toContain(`href="{{link:index}}"`);
    expect(result.template.pages["index.html"]).not.toContain(`href="index.html"`);
  });
  it("has nav regions, theme, assets and no blockers", () => {
    expect(result.template.manifest.nav.length).toBeGreaterThan(0);
    expect(result.template.manifest.theme.mode).toBe("css_vars");
    expect(Object.keys(result.template.assets)).toContain("css/style.css");
    expect(result.diagnostics.filter((d) => d.level === "blocker")).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("compileTemplate (empty zip)", () => {
  it("returns ok:false with the no_pages blocker", () => {
    const result = compileTemplate(zipFromMap({ "style.css": new TextEncoder().encode("body{}") }), "empty");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "no_pages")).toBe(true);
  });
});

const enc = (s: string) => new TextEncoder().encode(s);

describe("tokenizeInternalLinks (pass 4b hardening)", () => {
  it("preserves a #fragment suffix on the token", () => {
    const result = compileTemplate(zipFromMap({
      "index.html": enc(`<html><head><title>Home</title></head><body><a href="about.html#team">Team</a></body></html>`),
      "about.html": enc(`<html><head><title>About</title></head><body><p>About us</p></body></html>`),
    }), "frag-fixture");
    expect(result.template.pages["index.html"]).toContain("{{link:about}}#team");
  });

  it("resolves a page link case-insensitively instead of leaving it raw", () => {
    const result = compileTemplate(zipFromMap({
      "index.html": enc(`<html><head><title>Home</title></head><body><a href="About.html">About</a></body></html>`),
      "about.html": enc(`<html><head><title>About</title></head><body><p>About us</p></body></html>`),
    }), "case-fixture");
    expect(result.template.pages["index.html"]).toContain("{{link:about}}");
    expect(result.template.pages["index.html"]).not.toContain('href="About.html"');
  });

  it("flags an unresolved internal page link with an info diagnostic", () => {
    const result = compileTemplate(zipFromMap({
      "index.html": enc(`<html><head><title>Home</title></head><body><a href="nonexistent.html">Nowhere</a></body></html>`),
    }), "unresolved-fixture");
    expect(result.diagnostics.some((d) => d.level === "info" && d.code === "link_unresolved")).toBe(true);
  });
});
