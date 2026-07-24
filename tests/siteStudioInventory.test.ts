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
});
