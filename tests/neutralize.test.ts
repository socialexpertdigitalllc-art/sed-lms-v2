import { describe, it, expect } from "vitest";
import { neutralizeAppIdentifier } from "@/lib/template-engine/neutralize";

describe("neutralizeAppIdentifier", () => {
  const files = {
    "script.js": `class NorthpointApp {\n  init() {}\n}\nwindow.northpointApp = new NorthpointApp();`,
    "index.html": `<script>window.northpointApp.init();</script>`,
  };

  it("renames the class, the window global, and the `new` call to SiteApp/siteApp, consistently across ALL files", () => {
    const out = neutralizeAppIdentifier(files);
    expect(out.files["script.js"]).toContain("class SiteApp {");
    expect(out.files["script.js"]).toContain("window.siteApp = new SiteApp();");
    expect(out.files["script.js"]).not.toMatch(/northpoint/i);
    expect(out.files["index.html"]).toContain("window.siteApp.init();");
    expect(out.files["index.html"]).not.toMatch(/northpoint/i);
  });

  it("reports the renames applied", () => {
    const out = neutralizeAppIdentifier(files);
    expect(out.renames).toEqual(
      expect.arrayContaining([
        { from: "NorthpointApp", to: "SiteApp" },
        { from: "northpointApp", to: "siteApp" },
      ]),
    );
    expect(out.renames.length).toBeGreaterThan(0);
  });

  it("leaves a bare `class App` (no prefix) untouched", () => {
    const bare = { "app.js": `class App {\n  constructor() {}\n}\nwindow.app = new App();` };
    const out = neutralizeAppIdentifier(bare);
    expect(out.files["app.js"]).toBe(bare["app.js"]);
    expect(out.renames).toEqual([]);
  });

  it("leaves files with no App class unchanged, with empty renames", () => {
    const plain = { "style.css": `.hero { color: red; }`, "readme.txt": "no app here" };
    const out = neutralizeAppIdentifier(plain);
    expect(out.files).toEqual(plain);
    expect(out.renames).toEqual([]);
  });
});
