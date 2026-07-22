import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { ensureSiteIntegrity, redirectStub } from "@/lib/template-engine/integrity";
import { selectContentFiles, type ManifestPage } from "@/lib/template-engine/pageSelect";
import { pruneNavToBuiltPages } from "@/lib/template-engine/nav";

/** Run the pass over a text-file map, where the text files ARE the whole site. */
function run(textFiles: Record<string, string>, businessName = "Acme Roofing") {
  return ensureSiteIntegrity({ textFiles, allPaths: Object.keys(textFiles), businessName });
}

describe("ensureSiteIntegrity", () => {
  // THE production failure: the Northpoint template renders its header nav from
  // components.js custom elements, so the "Service Areas" anchor lives in a JS
  // string literal that no static nav prune can see.
  it("stubs a page referenced only from a JS nav array", () => {
    const componentsJs = `
      const NAV = [
        { label: "Home", href: "index.html" },
        { label: "About Us", href: "about.html" },
        { label: "Service Areas", href: "service-areas.html" },
      ];
      class SiteHeader extends HTMLElement {}
      customElements.define("site-header", SiteHeader);
    `;
    const { added, report } = run({
      "index.html": "<html><body><h1>Home</h1></body></html>",
      "about.html": "<html><body><h1>About</h1></body></html>",
      "components.js": componentsJs,
    });
    expect(report.stubs).toEqual(["service-areas.html"]);
    expect(report.referencedBy["service-areas.html"]).toEqual(["components.js"]);
    expect(added["service-areas.html"]).toBeTruthy();
  });

  it("emits a stub that parses, redirects to index.html, and carries the business name", () => {
    const { added } = run({
      "index.html": "<html><body>Home</body></html>",
      "main.js": `const go = "gallery.html";`,
    });
    const stub = added["gallery.html"];
    const root = parse(stub);
    const meta = root.querySelectorAll("meta").find((m) => m.getAttribute("http-equiv") === "refresh");
    expect(meta?.getAttribute("content")).toBe("0;url=index.html");
    expect(stub).toContain('location.replace("index.html")');
    const a = root.querySelector("a");
    expect(a?.getAttribute("href")).toBe("index.html");
    expect(root.querySelector("title")?.text).toBe("Acme Roofing");
    expect(stub).toContain("Acme Roofing");
  });

  it("stubs an HTML <a href> to a missing page (post-prune edge, e.g. body copy or empty-guarded menu)", () => {
    const { report, added } = run({
      "index.html": '<html><body><p>See our <a href="./gallery.html">gallery</a>.</p></body></html>',
    });
    expect(report.stubs).toEqual(["gallery.html"]);
    expect(report.referencedBy["gallery.html"]).toEqual(["index.html"]);
    expect(added["gallery.html"]).toContain("url=index.html");
  });

  it("never stubs externals, anchors, mailto/tel, assets, or prose mentioning a filename", () => {
    const { report } = run({
      "index.html": `<html><body>
        <a href="https://example.com/other.html">ext</a>
        <a href="//cdn.example.com/x.html">proto-relative</a>
        <a href="#quote">anchor</a>
        <a href="mailto:hi@acme.com">mail</a>
        <a href="tel:+15551234567">tel</a>
        <img src="images/hero.jpg">
        <script src="script.js"></script>
      </body></html>`,
      "script.js": `
        const ext = "https://example.com/missing.html";
        const asset = "images/photo.png";
        const cls = "is-open";
        const prose = "Read the guide in setup.html before you start";
      `,
    });
    expect(report.stubs).toEqual([]);
  });

  it("is idempotent: a second run over the stubbed site adds nothing", () => {
    const files: Record<string, string> = {
      "index.html": "<html><body>Home</body></html>",
      "components.js": `const nav = ["index.html", "service-areas.html"];`,
    };
    const first = run(files);
    expect(first.report.stubs).toEqual(["service-areas.html"]);
    const after = { ...files, ...first.added };
    const second = run(after);
    expect(second.report.stubs).toEqual([]);
    expect(Object.keys(second.added)).toEqual([]);
  });

  it("adds no stub when every internal reference resolves (case- and ./-insensitively)", () => {
    const { report } = run({
      "index.html": '<html><body><a href="./About.html">about</a></body></html>',
      "about.html": "<html><body>About</body></html>",
      "script.js": `const pages = ["index.html", "/about.html"];`,
    });
    expect(report.stubs).toEqual([]);
  });

  it("counts binary passthrough paths as present via allPaths", () => {
    const { report } = ensureSiteIntegrity({
      textFiles: { "index.html": '<html><body><a href="legacy.html">old</a></body></html>' },
      allPaths: ["index.html", "legacy.html", "images/logo.png"], // legacy.html ships as passthrough
      businessName: "Acme",
    });
    expect(report.stubs).toEqual([]);
  });

  it("a nested stub climbs back to the site root", () => {
    const { added } = run({
      "index.html": '<html><body><a href="pages/deep.html">deep</a></body></html>',
    });
    expect(added["pages/deep.html"]).toContain("url=../index.html");
    expect(added["pages/deep.html"]).toContain('location.replace("../index.html")');
  });

  it("dedupes referencing files and sorts stub paths", () => {
    const { report } = run({
      "index.html": '<html><body><a href="b.html">b</a><a href="b.html">b again</a><a href="a.html">a</a></body></html>',
    });
    expect(report.stubs).toEqual(["a.html", "b.html"]);
    expect(report.referencedBy["b.html"]).toEqual(["index.html"]);
  });
});

describe("redirectStub", () => {
  it("escapes the business name", () => {
    const stub = redirectStub({ redirectTo: "index.html", businessName: 'A "&" B <Roofing>' });
    expect(stub).toContain("A &quot;&amp;&quot; B &lt;Roofing&gt;");
    expect(stub).not.toContain("<Roofing>");
  });
});

// End-to-end shape of the real failure: a Northpoint-shaped template (JS
// custom-element nav in components.js) and a no-areas lead that explicitly
// requested the service-areas hub. After selection + prune + integrity the
// areas page is IN the final set and no internal reference dangles.
describe("integration: requested areas hub, no areas data, JS-rendered nav", () => {
  const manifestPages: ManifestPage[] = [
    { file: "index.html", kind: "home" },
    { file: "about.html", kind: "about" },
    { file: "contact.html", kind: "contact" },
    { file: "services.html", kind: "services" },
    { file: "service-areas.html", kind: "areas_hub" },
    { file: "gallery.html", kind: "gallery" },
    { file: "area-cherry-creek.html", kind: "area_detail" },
  ];
  const requestedPages = ["index.html", "about.html", "contact.html", "services.html", "service-areas.html", "gallery.html"];
  const pageHtml = (title: string) =>
    `<html><body><nav class="navbar"><a href="index.html">Home</a><a href="about.html">About</a><a href="service-areas.html">Service Areas</a><a href="area-cherry-creek.html">Cherry Creek</a></nav><h1>${title}</h1></body></html>`;
  const componentsJs = `const NAV = ["index.html","about.html","contact.html","services.html","service-areas.html","gallery.html"];`;

  it("builds the areas hub and leaves zero dangling internal references", () => {
    const sel = selectContentFiles({
      contentFiles: [...manifestPages.map((p) => p.file), "script.js", "components.js"],
      manifestPages,
      requestedPages,
    });
    // The page the lead asked for is built even though service_areas is null...
    expect(sel.build).toContain("service-areas.html");
    // ...and the unrequested demo area-detail page still is not.
    expect(sel.dropped).toEqual([{ file: "area-cherry-creek.html", reason: "not requested" }]);

    // Finalize order: nav prune (static menus), then integrity (everything else).
    const finalText: Record<string, string> = {};
    for (const f of sel.build) {
      finalText[f] = f.endsWith(".js") ? componentsJs : pageHtml(f);
    }
    const builtPages = Object.keys(finalText).filter((f) => /\.html?$/i.test(f));
    for (const f of builtPages) {
      finalText[f] = pruneNavToBuiltPages(finalText[f], builtPages).html;
    }
    const integrity = ensureSiteIntegrity({
      textFiles: finalText,
      allPaths: Object.keys(finalText),
      businessName: "Northpoint HVAC",
    });
    for (const [path, html] of Object.entries(integrity.added)) finalText[path] = html;

    // The static menus were pruned of the dropped area-detail link, and the
    // JS nav references only pages that exist — nothing needed stubbing.
    expect(integrity.report.stubs).toEqual([]);
    // A re-scan of the completed site finds nothing dangling either.
    const recheck = ensureSiteIntegrity({
      textFiles: finalText,
      allPaths: Object.keys(finalText),
      businessName: "Northpoint HVAC",
    });
    expect(recheck.report.stubs).toEqual([]);
  });

  it("with the OLD behaviour's output (areas hub missing), integrity still saves the click", () => {
    // Simulate what production shipped: the hub dropped, the JS nav untouched.
    const finalText: Record<string, string> = {
      "index.html": pruneNavToBuiltPages(pageHtml("Home"), ["index.html", "about.html"]).html,
      "about.html": pruneNavToBuiltPages(pageHtml("About"), ["index.html", "about.html"]).html,
      "components.js": componentsJs,
    };
    const integrity = ensureSiteIntegrity({
      textFiles: finalText,
      allPaths: Object.keys(finalText),
      businessName: "Northpoint HVAC",
    });
    // Every page the JS nav still points at gets a stub — no click can 404.
    expect(integrity.report.stubs).toEqual(["contact.html", "gallery.html", "service-areas.html", "services.html"]);
    expect(integrity.report.referencedBy["service-areas.html"]).toContain("components.js");
    expect(integrity.added["service-areas.html"]).toContain("url=index.html");
  });
});
