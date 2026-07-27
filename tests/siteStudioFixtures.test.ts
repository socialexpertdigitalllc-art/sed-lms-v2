import { describe, it, expect } from "vitest";
import { fixtureFiles, fixtureZip, text } from "./helpers/siteStudioFixtures";

describe("site-studio fixtures", () => {
  it("plumberpro has 4 pages and a stylesheet", () => {
    const files = fixtureFiles("plumberpro");
    const names = Object.keys(files).sort();
    expect(names).toEqual(["about.html", "contact.html", "css/style.css", "index.html", "services.html"]);
    expect(text(files["index.html"])).toContain("PlumberPro");
  });
  it("bakery is dissimilar: 2 pages, no css variables", () => {
    const files = fixtureFiles("bakery");
    expect(Object.keys(files).sort()).toEqual(["index.html", "menu.html", "style.css"]);
    expect(text(files["style.css"])).not.toContain("--");
  });
  it("zips fixtures in-memory", () => {
    expect(fixtureZip("plumberpro").length).toBeGreaterThan(500);
  });
});
