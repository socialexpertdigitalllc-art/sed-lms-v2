import { describe, it, expect } from "vitest";
import { compileTemplate } from "@/lib/site-studio/compiler/compile";
import { fixtureZip } from "./helpers/siteStudioFixtures";
import { sampleContentDoc } from "@/lib/site-studio/sample";
import { renderSite } from "@/lib/site-studio/render/renderer";
import { CompiledTemplate, ContentDoc } from "@/lib/site-studio/schema";
import { SLOT_ATTR, PAGE_ATTR, ALT_ATTR } from "@/lib/site-studio/render/annotate";

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
      expect(html).not.toContain(ALT_ATTR);
    }
  });

  it("annotated build marks every text and image slot with page:slot keys", () => {
    const r = renderSite(template, doc, { annotate: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const home = new TextDecoder().decode(r.files["index.html"]);
    expect(home).toContain(`${PAGE_ATTR}="0"`);
    // every slot on page 0 is addressable by the SAME key the images route
    // and ImagePicker already use: "${docPageIndex}:${slotId}" — an
    // attribute-bound slot (plumberpro's <img alt="…">, SlotDef.attr set)
    // is the one exception: it gets ALT_ATTR on the <img> itself instead of
    // SLOT_ATTR (see annotate.ts's ALT_ATTR note for why), so it's asserted
    // separately below rather than folded into the generic SLOT_ATTR loop.
    const pageDef = template.manifest.pages.find((p) => p.id === "index")!;
    let attrBoundCount = 0;
    for (const slot of pageDef.slots) {
      if (slot.attr) {
        attrBoundCount++;
        expect(home).toContain(`${ALT_ATTR}="0:${slot.id}"`);
        expect(home).not.toContain(`${SLOT_ATTR}="0:${slot.id}"`);
      } else {
        expect(home).toContain(`${SLOT_ATTR}="0:${slot.id}"`);
      }
    }
    // the fixture's <img alt="Plumber fixing a sink"> is exactly this case —
    // guard against the loop above vacuously passing if slots.ts ever stops
    // producing an attr-bound slot for it
    expect(attrBoundCount).toBeGreaterThan(0);
  });

  it("does not introduce an extra DOM node adjacent to any <img> for its alt text", () => {
    // an inserted marker span would become img's nextElementSibling, which
    // is a REAL fidelity difference from production (e.g. `img + p` CSS
    // matches in prod but not in the preview) — alt text must be marked on
    // the <img> itself, never via a sibling
    const r = renderSite(template, doc, { annotate: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const home = new TextDecoder().decode(r.files["index.html"]);
    expect(home).not.toMatch(/<img[^>]*>\s*<span/);
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

/**
 * Repeat-region content (services lists, testimonials, team grids — the
 * compiler auto-detects any run of ≥3 congruent siblings as a repeat) was
 * entirely unreachable from Gate 2 before this: the repeat-substitution loop
 * in renderer.ts ran unconditionally BEFORE the annotate branch, so a row's
 * tokens were already resolved to plain values by the time annotatePageHtml
 * ran. Key format: "${docPageIndex}:${repeatId}#${rowIndex}:${slotId}" — see
 * annotate.ts's SLOT_ATTR note for the full rationale (same leading
 * "docIndex:" segment as a plain slot key; "#" never appears in a plain key,
 * so a consumer can tell the two shapes apart before parsing further).
 */
describe("annotated build marks repeat rows individually", () => {
  const repeatTpl: CompiledTemplate = {
    manifest: {
      engine: 3, name: "repeat-mini", version: 1,
      identity: {},
      theme: { mode: "none", roles: {} },
      nav: [],
      pages: [{
        id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Index",
        slots: [],
        repeats: [{
          id: "cards", fragment: "cards", min: 1, max: 12,
          slots: [
            { id: "cards_s1", type: "text", sample: "Title", html: false, max_chars: 40 },
            { id: "cards_s2", type: "text", sample: "Body", html: false, max_chars: 80 },
          ],
          samples: [{ cards_s1: "Title", cards_s2: "Body" }],
        }],
      }],
    },
    pages: {
      "index.html": `<html><head><title>{{title}}</title></head><body><section><!--@repeat:cards--></section></body></html>`,
    },
    fragments: {
      cards: `<div class="card"><h3>{{slot:cards_s1}}</h3><p>{{slot:cards_s2}}</p></div>`,
    },
    assets: {},
  };

  const repeatDoc: ContentDoc = {
    identity: {},
    theme: {},
    pages: [{
      page_id: "index", title: "Index",
      slots: {},
      repeats: {
        cards: [
          { cards_s1: "Drain Cleaning", cards_s2: "Clogged drains cleared fast." },
          { cards_s1: "Water Heaters", cards_s2: "Repair and replacement done right." },
          { cards_s1: "Leak Repair", cards_s2: "We find leaks before they find you." },
        ],
      },
    }],
  };

  it("marks every row's slots with a distinct, collision-free key", () => {
    const r = renderSite(repeatTpl, repeatDoc, { annotate: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const html = new TextDecoder().decode(r.files["index.html"]);
    for (let row = 0; row < 3; row++) {
      expect(html).toContain(`${SLOT_ATTR}="0:cards#${row}:cards_s1"`);
      expect(html).toContain(`${SLOT_ATTR}="0:cards#${row}:cards_s2"`);
    }
    // all 6 keys across the 3 rows are distinct — two rows never collide
    const keys = [...html.matchAll(new RegExp(`${SLOT_ATTR}="([^"]+)"`, "g"))].map((m) => m[1]);
    expect(new Set(keys).size).toBe(6);
  });

  it("still renders the right row content under each key", () => {
    const r = renderSite(repeatTpl, repeatDoc, { annotate: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const html = new TextDecoder().decode(r.files["index.html"]);
    expect(html).toContain(`data-ss-slot="0:cards#0:cards_s1">Drain Cleaning<`);
    expect(html).toContain(`data-ss-slot="0:cards#1:cards_s1">Water Heaters<`);
    expect(html).toContain(`data-ss-slot="0:cards#2:cards_s1">Leak Repair<`);
  });

  it("production build for the same repeat carries no annotation attributes", () => {
    const r = renderSite(repeatTpl, repeatDoc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const html = new TextDecoder().decode(r.files["index.html"]);
    expect(html).not.toContain(SLOT_ATTR);
    expect(html).toContain("Drain Cleaning");
    expect(html).toContain("Water Heaters");
    expect(html).toContain("Leak Repair");
  });
});
