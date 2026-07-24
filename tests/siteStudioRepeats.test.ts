import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { extractRepeats } from "@/lib/site-studio/compiler/repeats";
import { PageSource } from "@/lib/site-studio/compiler/inventory";

const page = (html: string): PageSource =>
  ({ file: "index.html", id: "index", kind: "home", root: parse(html) });

const CARDS = `
<section class="cards">
  <div class="card"><h3>Drain Cleaning</h3><p>Clogged drains cleared fast.</p></div>
  <div class="card"><h3>Water Heaters</h3><p>Repair and replacement done right.</p></div>
  <div class="card"><h3>Leak Repair</h3><p>We find leaks before they find you.</p></div>
</section>`;

describe("extractRepeats", () => {
  it("detects a 3-card run: fragment, marker, samples per instance", () => {
    const p = page(`<body>${CARDS}</body>`);
    const { repeats, fragments } = extractRepeats(p);
    expect(repeats).toHaveLength(1);
    const r = repeats[0];
    expect(r.min).toBe(1);
    expect(r.max).toBe(12);
    expect(r.slots).toHaveLength(2);
    expect(r.samples).toHaveLength(3);
    expect(r.samples[1][r.slots[0].id]).toBe("Water Heaters");
    expect(fragments[r.fragment]).toContain(`{{slot:${r.slots[0].id}}}`);
    const html = p.root.toString();
    expect(html).toContain(`<!--@repeat:${r.id}-->`);
    expect(html).not.toContain("Drain Cleaning");
  });
  it("ignores runs of two and non-congruent siblings", () => {
    const two = page(`<body><ul><li class="x"><p>Item one</p></li><li class="x"><p>Item two</p></li></ul></body>`);
    expect(extractRepeats(two).repeats).toHaveLength(0);
    const mixed = page(`<body><div>
      <div class="card"><h3>One title</h3><p>Body text</p></div>
      <div class="card"><h3>Two title</h3></div>
      <div class="card"><h3>Three title</h3><p>Body text</p></div>
    </div></body>`);
    expect(extractRepeats(mixed).repeats).toHaveLength(0);
  });
});
