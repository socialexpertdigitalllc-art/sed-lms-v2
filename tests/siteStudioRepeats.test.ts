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

  it("drops orphaned RepeatDefs left by a subtree an outer repeat already consumed", () => {
    const group = (n: number) => `
      <div class="group">
        <div class="card"><h3>G${n} Title A</h3><p>G${n} body text A here.</p></div>
        <div class="card"><h3>G${n} Title B</h3><p>G${n} body text B here.</p></div>
        <div class="card"><h3>G${n} Title C</h3><p>G${n} body text C here.</p></div>
      </div>`;
    const p = page(`<body><div class="groups">${group(1)}${group(2)}${group(3)}</div></body>`);
    const { repeats, diagnostics } = extractRepeats(p);
    const html = p.root.toString();
    const markerCount = (html.match(/<!--@repeat:/g) ?? []).length;
    // No RepeatDef survives whose marker isn't actually in the page, and no
    // marker in the page lacks a RepeatDef — the two must match exactly.
    expect(markerCount).toBe(repeats.length);
    for (const r of repeats) expect(html).toContain(`<!--@repeat:${r.id}-->`);
    expect(repeats).toHaveLength(1);
    const dropped = diagnostics.filter((d) => d.code === "repeat_dropped_orphan");
    expect(dropped.length).toBe(2);
  });

  it("keeps a short-text instance in lockstep — slots decided once from the first instance", () => {
    const p = page(`<body><div class="cards">
      <div class="card"><h3>Drain Cleaning</h3><p>Clogged drains cleared fast.</p></div>
      <div class="card"><h3>Water Heaters</h3><p>OK</p></div>
      <div class="card"><h3>Leak Repair</h3><p>We find leaks before they find you.</p></div>
    </div></body>`);
    const { repeats } = extractRepeats(p);
    expect(repeats).toHaveLength(1);
    const r = repeats[0];
    expect(r.slots).toHaveLength(2);
    expect(Object.keys(r.samples[1])).toHaveLength(2);
    expect(r.samples[1][r.slots[0].id]).toBe("Water Heaters");
    expect(r.samples[1][r.slots[1].id]).toBe("OK");
  });

  it("derives max from the instance count when it exceeds the default of 12", () => {
    const cards = Array.from(
      { length: 13 },
      (_, i) => `<div class="card"><h3>Service ${i + 1}</h3><p>Description number ${i + 1} here.</p></div>`,
    ).join("");
    const p = page(`<body><div class="cards">${cards}</div></body>`);
    const { repeats } = extractRepeats(p);
    expect(repeats).toHaveLength(1);
    expect(repeats[0].max).toBe(13);
    expect(repeats[0].samples).toHaveLength(13);
  });

  it("flags a same-signature run that fails structural congruence", () => {
    const p = page(`<body><div class="wrap">
      <div class="card"><h3>Title <strong>Extra</strong></h3><p>Body text one here.</p></div>
      <div class="card"><h3>Title Two</h3><p>Body text two here.</p></div>
      <div class="card"><h3>Title Three</h3><p>Body text three here.</p></div>
    </div></body>`);
    const { repeats, diagnostics } = extractRepeats(p);
    expect(repeats).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === "repeat_congruence_failed")).toBe(true);
  });
});
