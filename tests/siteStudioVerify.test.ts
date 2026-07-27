import { describe, it, expect } from "vitest";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { normalizeHtml, verifyTemplate } from "@/lib/site-studio/compiler/verify";
import { unzipToMap } from "@/lib/site-studio/zip";
import { fixtureZip } from "./helpers/siteStudioFixtures";
import { manifestSchema } from "@/lib/site-studio/schema";

describe("normalizeHtml", () => {
  it("cancels whitespace and entity formatting differences", () => {
    expect(normalizeHtml("<p>  Hello   &amp; hi </p>")).toBe(normalizeHtml("<p>Hello &#38; hi</p>"));
  });
  it("still distinguishes real content differences", () => {
    expect(normalizeHtml("<p>Hello</p>")).not.toBe(normalizeHtml("<p>Goodbye</p>"));
  });
  it("does not collide when an attribute value contains an embedded quote (injectivity)", () => {
    // one attribute whose value contains a quote vs two genuinely distinct attributes
    const oneAttr = `<a data-x='b" onclick="evil()'>x</a>`;
    const twoAttr = `<a data-x="b" onclick="evil()">x</a>`;
    expect(normalizeHtml(oneAttr)).not.toBe(normalizeHtml(twoAttr));
  });
});

describe("round-trip property: render(compile(zip), samples) ≈ original", () => {
  // gearhead is the only fixture with tokenized text assets (js/css carrying
  // demo identity baked in by a runtime-built header widget) — it's the one
  // that actually exercises verifyTemplate's asset round-trip check below;
  // plumberpro/bakery have no text assets identity ever touches.
  for (const name of ["plumberpro", "bakery", "gearhead"] as const) {
    it(`${name} round-trips with zero blockers`, () => {
      const result = compileTemplate(fixtureZip(name), name);
      expect(result.ok).toBe(true);
      expect(() => manifestSchema.parse(result.template.manifest)).not.toThrow();
      const blockers = result.diagnostics.filter((d) => d.level === "blocker");
      expect(blockers).toEqual([]);
    });
  }
});

describe("verifyTemplate catches corruption", () => {
  it("a package whose skeleton lost content fails verification", () => {
    const result = compileTemplate(fixtureZip("bakery"), "bakery");
    const broken = {
      ...result.template,
      pages: { ...result.template.pages, "menu.html": result.template.pages["menu.html"].replace("{{slot:", "{{slot:GONE_") },
    };
    const diags = verifyTemplate(broken, unzipToMap(fixtureZip("bakery")));
    // The mangled token ({{slot:GONE_menu_s1}}) is unknown to the manifest, so renderSite's
    // leftover-token check refuses the render (roundtrip_render_refused) before verifyTemplate
    // ever reaches the normalizeHtml comparison that would otherwise report roundtrip_mismatch.
    // Either code represents "corruption was caught as a blocker" — accept both.
    expect(diags.some((d) => d.level === "blocker" && (d.code === "roundtrip_mismatch" || d.code === "roundtrip_render_refused"))).toBe(true);
  });

  it("a tokenized asset whose skeleton bytes got corrupted fails verification too — manifest.pages alone would never have looked at it", () => {
    const result = compileTemplate(fixtureZip("gearhead"), "gearhead");
    expect(result.template.manifest.tokenizedAssets).toContain("js/site.js");
    const broken = {
      ...result.template,
      assets: {
        ...result.template.assets,
        // corrupt the tokenized asset's skeleton so it can no longer
        // reproduce the original bytes once re-rendered from samples
        "js/site.js": new TextEncoder().encode(
          new TextDecoder().decode(result.template.assets["js/site.js"]).replace("{{id:business_name}}", "{{id:business_name}}_CORRUPTED"),
        ),
      },
    };
    const diags = verifyTemplate(broken, unzipToMap(fixtureZip("gearhead")));
    expect(diags.some((d) => d.level === "blocker" && d.code === "roundtrip_mismatch" && d.page === "js/site.js")).toBe(true);
  });
});
