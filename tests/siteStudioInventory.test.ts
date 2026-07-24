import { describe, it, expect } from "vitest";
import { inventory } from "@/lib/site-studio/compiler/inventory";
import { fixtureFiles } from "./helpers/siteStudioFixtures";

describe("inventory", () => {
  it("classifies pages vs assets and assigns ids/kinds", () => {
    const inv = inventory(fixtureFiles("plumberpro"));
    expect(inv.pages.map((p) => p.file)).toEqual(["index.html", "about.html", "contact.html", "services.html"]);
    expect(inv.pages[0]).toMatchObject({ id: "index", kind: "home" });
    expect(inv.pages.find((p) => p.id === "services")!.kind).toBe("services_hub");
    expect(Object.keys(inv.assets)).toEqual(["css/style.css"]);
  });
  it("strips HTML comments from parsed pages (v2 lesson: comments carry identity)", () => {
    const files = fixtureFiles("bakery");
    files["index.html"] = new TextEncoder().encode(
      new TextDecoder().decode(files["index.html"]).replace("<h1>", "<!-- Golden Crust internal note --><h1>")
    );
    const inv = inventory(files);
    expect(inv.pages[0].root.toString()).not.toContain("internal note");
    expect(inv.diagnostics.some((d) => d.code === "comments_stripped")).toBe(true);
  });
  it("reports a blocker when no html pages exist", () => {
    const inv = inventory({ "style.css": new Uint8Array([1]) });
    expect(inv.pages).toEqual([]);
    expect(inv.diagnostics.some((d) => d.level === "blocker" && d.code === "no_pages")).toBe(true);
  });
  it("unwraps a legacy-wrapped script comment without warning", () => {
    const html = "<html><body><script><!--\nvar x=1;\n//--></script></body></html>";
    const inv = inventory({ "index.html": new TextEncoder().encode(html) });
    const out = inv.pages[0].root.toString();
    expect(out).toContain("var x=1;");
    expect(out).not.toContain("<!--");
    expect(inv.diagnostics.some((d) => d.code === "script_comment_content")).toBe(false);
  });
  it("warns when a script body embeds HTML-comment content mid-script", () => {
    const html = '<html><body><script>var a=1; /* x */ var s="<!-- note -->";</script></body></html>';
    const inv = inventory({ "index.html": new TextEncoder().encode(html) });
    expect(inv.diagnostics.some((d) => d.code === "script_comment_content")).toBe(true);
    expect(inv.pages[0].root.toString()).toContain('var a=1; /* x */ var s="<!-- note -->";');
  });
  it("flags suspect encoding when decoded bytes contain replacement characters", () => {
    const bytes = new Uint8Array([0x3c, 0x68, 0x31, 0x3e, 0x43, 0x61, 0x66, 0xe9, 0x3c, 0x2f, 0x68, 0x31, 0x3e]);
    const inv = inventory({ "bad.html": bytes });
    expect(inv.diagnostics.some((d) => d.code === "encoding_suspect")).toBe(true);
  });
  it("reports a blocker and keeps the first file on page id collision", () => {
    const files = fixtureFiles("bakery");
    const inv = inventory({ "about.html": files["index.html"], "About.HTML": files["index.html"] });
    expect(inv.pages.map((p) => p.file)).toEqual(["about.html"]);
    expect(inv.diagnostics.some((d) => d.level === "blocker" && d.code === "page_id_collision")).toBe(true);
  });
});
