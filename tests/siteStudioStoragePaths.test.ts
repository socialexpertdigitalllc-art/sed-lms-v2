import { describe, it, expect } from "vitest";
import { sourcePath, packageFilePath, packageIndex, INDEX_PATH } from "@/lib/site-studio/service/templates";
import type { CompiledTemplate } from "@/lib/site-studio/schema";

const tpl: CompiledTemplate = {
  manifest: { engine: 3, name: "t", version: 1, identity: {}, theme: { mode: "none", roles: {} }, nav: [], pages: [
    { id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "", slots: [], repeats: [] },
  ] },
  pages: { "index.html": "<html></html>" },
  fragments: { nav_header: "<li></li>" },
  assets: { "css/style.css": new TextEncoder().encode("body{}") },
};

describe("storage layout", () => {
  it("builds spec §3 paths", () => {
    expect(sourcePath("abc")).toBe("abc/source.zip");
    expect(INDEX_PATH("abc")).toBe("abc/package/index.json");
    expect(packageFilePath("abc", "pages", "index.html")).toBe("abc/package/pages/index.html");
    expect(packageFilePath("abc", "assets", "css/style.css")).toBe("abc/package/assets/css/style.css");
  });
  it("indexes every package file", () => {
    expect(packageIndex(tpl)).toEqual({
      pages: ["index.html"],
      fragments: ["nav_header"],
      assets: ["css/style.css"],
    });
  });
});
