import { describe, it, expect } from "vitest";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { fixtureZip } from "./helpers/siteStudioFixtures";
import { sampleContentDoc } from "@/lib/site-studio/sample";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { SLOT_ATTR, PAGE_ATTR } from "@/lib/site-studio/render/annotate";

describe("annotated build", () => {
  const { template } = compileTemplate(fixtureZip("plumberpro"), "plumberpro");
  const doc = sampleContentDoc(template.manifest);

  it("PRODUCTION BUILD IS UNCHANGED — no options, and with annotate:false", () => {
    const base = renderSite(template, doc);
    const explicit = renderSite(template, doc, { annotate: false });
    expect(base.ok).toBe(true);
    if (!base.ok || !explicit.ok) return;
    // byte-identical: preview work must never alter a deployed site
    for (const path of Object.keys(base.files)) {
      expect(explicit.files[path]).toEqual(base.files[path]);
    }
  });

  it("production build carries NO annotation attributes at all", () => {
    const r = renderSite(template, doc);
    if (!r.ok) return;
    for (const [path, bytes] of Object.entries(r.files)) {
      if (!path.endsWith(".html")) continue;
      const html = new TextDecoder().decode(bytes);
      expect(html).not.toContain(SLOT_ATTR);
      expect(html).not.toContain(PAGE_ATTR);
    }
  });

  it("annotated build marks every text and image slot with page:slot keys", () => {
    const r = renderSite(template, doc, { annotate: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const home = new TextDecoder().decode(r.files["index.html"]);
    expect(home).toContain(`${PAGE_ATTR}="0"`);
    // every text slot on page 0 is addressable by the SAME key the images
    // route and ImagePicker already use: "${docPageIndex}:${slotId}"
    const pageDef = template.manifest.pages.find((p) => p.id === "index")!;
    for (const slot of pageDef.slots) {
      expect(home).toContain(`${SLOT_ATTR}="0:${slot.id}"`);
    }
  });

  it("annotating does not change the visible text of any slot", () => {
    const plain = renderSite(template, doc);
    const marked = renderSite(template, doc, { annotate: true });
    if (!plain.ok || !marked.ok) return;
    const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(strip(new TextDecoder().decode(marked.files["index.html"])))
      .toBe(strip(new TextDecoder().decode(plain.files["index.html"])));
  });

  it("marks stamped fan-out pages with their own doc index", () => {
    // a stamped page shares a page_id but has its own doc index — the marker
    // must carry the INDEX, or edits from the preview would hit the wrong page
    const multi = { ...doc, pages: [...doc.pages, { ...doc.pages[0], output: "services/x.html" }] };
    const r = renderSite(template, multi as never, { annotate: true });
    if (!r.ok) return;
    expect(new TextDecoder().decode(r.files["services/x.html"])).toContain(`${PAGE_ATTR}="${multi.pages.length - 1}"`);
  });
});
