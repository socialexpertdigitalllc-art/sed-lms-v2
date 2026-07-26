import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { fixtureZip } from "./helpers/siteStudioFixtures";
import { sampleContentDoc } from "@/lib/site-studio/sample";
import { renderSite } from "@/lib/site-studio/render/renderer";

/**
 * A byte-level pin on the PRODUCTION render output.
 *
 * Every deployed client site is produced by `renderSite(tpl, doc)` with no
 * options. Phase 4a adds an annotated build for the editable preview, and the
 * one outcome that phase may not cause is a change to what gets deployed.
 * `tests/siteStudioAnnotate.test.ts` proves the default equals `annotate:false`
 * — but both of those run the SAME current code, so together they cannot
 * detect a change to production output; they only prove the two entry points
 * agree with each other.
 *
 * These hashes were captured from the render output immediately BEFORE the
 * annotation work landed (verified by rendering both fixtures at the prior
 * commit in a separate worktree and diffing: identical).
 *
 * If this test fails, production render bytes changed. That is not
 * automatically wrong — but it must be a deliberate, reviewed decision, not a
 * side effect of preview work. Update a hash only once you have confirmed the
 * new output is intended, and say so in the commit message.
 */
const GOLDEN: Record<string, string> = {
  "bakery/index.html": "10dfb5923a0eae1e",
  "bakery/menu.html": "9488fe64ec1c965a",
  "bakery/style.css": "52ce633f8c96be9d",
  // plumberpro was compiled and rendered by this test all along, but never
  // asserted — the GOLDEN map only ever covered half of what this file's
  // header claims. These hashes were computed AFTER the fix in
  // tokens.ts's fillSlotValue (attribute-bound slots — plumberpro's <img
  // alt="…"> — now escape via escapeHtml, not escapeText); they happen to
  // be byte-identical to what shipped before that fix, because plumberpro's
  // demo alt-text sample ("Plumber fixing a sink") contains none of the
  // characters (" ') the two escape functions treat differently. See
  // tests/siteStudioRenderer.test.ts's "escapes attribute-bound slots"
  // suite for coverage of a value that DOES differ.
  "plumberpro/index.html": "65dad52e82ce5440",
  "plumberpro/about.html": "c89f5196d73a2e27",
  "plumberpro/contact.html": "a97fd0e60d10daa7",
  "plumberpro/services.html": "71977d0a46ff94ac",
  "plumberpro/css/style.css": "88eda6cba827514a",
};

describe("production render output is pinned", () => {
  it("renders both fixtures to the exact bytes that shipped before the preview work", () => {
    const actual: Record<string, string> = {};
    for (const name of ["plumberpro", "bakery"]) {
      const { template } = compileTemplate(fixtureZip(name), name);
      const result = renderSite(template, sampleContentDoc(template.manifest));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const path of Object.keys(result.files)) {
        actual[`${name}/${path}`] = createHash("sha256")
          .update(result.files[path])
          .digest("hex")
          .slice(0, 16);
      }
    }
    for (const [key, hash] of Object.entries(GOLDEN)) {
      expect(actual[key], `${key} changed — see this file's header before updating`).toBe(hash);
    }
  });

  it("the annotated build does NOT match those hashes (it is a different build)", () => {
    const { template } = compileTemplate(fixtureZip("bakery"), "bakery");
    const doc = sampleContentDoc(template.manifest);
    const annotated = renderSite(template, doc, { annotate: true });
    expect(annotated.ok).toBe(true);
    if (!annotated.ok) return;
    const hash = createHash("sha256")
      .update(annotated.files["index.html"])
      .digest("hex")
      .slice(0, 16);
    // guards against `annotate: true` silently becoming a no-op, which would
    // make every preview unclickable while every other test still passed
    expect(hash).not.toBe(GOLDEN["bakery/index.html"]);
  });
});
