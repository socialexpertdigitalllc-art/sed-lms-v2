import { describe, it, expect } from "vitest";
import { extractJsStrings } from "@/lib/template-engine/jsStrings";

const SCRIPT = `// Northpoint site bootstrap
import { boot } from "./boot.js";

class SiteApp {
  constructor() {
    this.root = document.querySelector(".site-header");
    this.testimonials = [
      { quote: "They remodeled our kitchen in three weeks.", name: "Dana R." },
      { quote: 'Best crew in Denver, hands down.', name: "Marco T." },
    ];
    this.phone = "(555) 210-4400";
    this.email = "hello@northpointremodel.com";
    this.labels = { cta: "Book your free estimate", nav: "Services" };
  }
  bindFaq() {
    document.querySelectorAll("[data-faq]").forEach((el) => {
      el.addEventListener("click", () => el.classList.toggle("is-open"));
    });
    const re = /"[^"]*"/g;
    const ratio = 10 / 2;
    return re.test("x") ? ratio : 0;
  }
  greet(name) {
    return \`Hello \${name}\`;
  }
  motto() {
    return \`Craft you can see\`;
  }
}
window.siteApp = new SiteApp();
`;

describe("extractJsStrings", () => {
  const ex = extractJsStrings(SCRIPT);
  const translatable = ex.items.filter((i) => i.translatable).map((i) => i.text);
  const all = ex.items.map((i) => i.text);

  it("round-trips byte-identically with an empty or identity map", () => {
    expect(ex.apply({})).toBe(SCRIPT);
    expect(ex.apply(Object.fromEntries(ex.items.map((i) => [i.id, i.text])))).toBe(SCRIPT);
  });

  it("offers copy strings to the model", () => {
    expect(translatable).toContain("They remodeled our kitchen in three weeks.");
    expect(translatable).toContain("Best crew in Denver, hands down.");
    expect(translatable).toContain("Book your free estimate");
  });

  it("extracts contact literals but keeps them away from the model (no letters / url-ish)", () => {
    expect(all).toContain("(555) 210-4400");
    expect(all).toContain("hello@northpointremodel.com");
    expect(translatable).not.toContain("(555) 210-4400");
  });

  it("does not offer selectors, module paths, urls or code tokens", () => {
    for (const bad of ["./boot.js", ".site-header", "[data-faq]", "click", "is-open"]) {
      expect(translatable).not.toContain(bad);
    }
  });

  it("still EXTRACTS the code-shaped literals, so the deterministic pass can reach them", () => {
    expect(all).toContain("./boot.js");
    expect(all).toContain(".site-header");
    expect(all).toContain("[data-faq]");
  });

  it("takes a template literal with no interpolation and skips one with", () => {
    expect(all).toContain("Craft you can see");
    expect(all.some((t) => t.includes("${"))).toBe(false);
    expect(all.some((t) => t.startsWith("Hello "))).toBe(false);
  });

  it("does not mistake a regex literal or a division for a string", () => {
    expect(all).not.toContain('"[^"]*"');
    expect(all.some((t) => t.includes("[^"))).toBe(false);
  });

  it("never touches identifiers or control flow when strings change", () => {
    const map = Object.fromEntries(
      ex.items.filter((i) => i.translatable).map((i) => [i.id, `REWRITTEN ${i.id}`]),
    );
    const out = extractJsStrings(SCRIPT).apply(map);
    for (const marker of [
      "class SiteApp {",
      "bindFaq()",
      "window.siteApp = new SiteApp();",
      'document.querySelectorAll("[data-faq]")',
      'el.addEventListener("click"',
      "const re = /\"[^\"]*\"/g;",
      "const ratio = 10 / 2;",
      "return \`Hello \${name}\`;",
    ]) {
      expect(out).toContain(marker);
    }
    expect(out).toContain('quote: "REWRITTEN');
  });

  it("preserves the original quote style and escapes the replacement", () => {
    const src = `const a = 'single';\nconst b = "double";\nconst c = \`tick\`;`;
    const e = extractJsStrings(src);
    const map = Object.fromEntries(e.items.map((i) => [i.id, `it's a "q"\nline`]));
    const out = e.apply(map);
    expect(out).toBe(
      `const a = 'it\\'s a "q"\\nline';\nconst b = "it's a \\"q\\"\\nline";\nconst c = \`it's a "q"\nline\`;`,
    );
  });

  it("keeps original escaping for a string it does not change", () => {
    const src = `const a = "line\\n\\u00e9nd \\"quoted\\"";`;
    const e = extractJsStrings(src);
    expect(e.items[0].text).toBe('line\né' + 'nd "quoted"');
    expect(e.apply({})).toBe(src);
  });

  it("keeps the original for an omitted or blank replacement", () => {
    const src = `const a = "Keep me"; const b = "Change me";`;
    const e = extractJsStrings(src);
    const out = e.apply({ [e.items[0].id]: "   ", [e.items[1].id]: "Changed" });
    expect(out).toBe(`const a = "Keep me"; const b = "Changed";`);
  });

  it("ignores strings inside comments", () => {
    const src = `// const x = "commented out";\n/* "block" */\nconst y = "real copy here";`;
    const e = extractJsStrings(src);
    expect(e.items.map((i) => i.text)).toEqual(["real copy here"]);
  });
});
