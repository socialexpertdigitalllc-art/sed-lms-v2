import { describe, it, expect } from "vitest";
import { htmlSkeleton, compareSkeleton, jsIdentifiers, compareJs } from "@/lib/template-engine/structure";

const before = `<div class="hero grid"><h1 id="t" class="title">Northpoint</h1><img src="a.jpg" alt="x"></div>`;
const okAfter = `<div class="hero grid"><h1 id="t" class="title">Inside Out</h1><img src="b.jpg" alt="y"></div>`;
const badAfter = `<div class="hero"><h2 id="t" class="title">Inside Out</h2></div>`;

describe("html structure gate", () => {
  it("passes when only text/attribute VALUES changed", () => {
    expect(compareSkeleton(htmlSkeleton(before), htmlSkeleton(okAfter)).ok).toBe(true);
  });
  it("fails when a class is dropped", () => {
    const r = compareSkeleton(htmlSkeleton(before), htmlSkeleton(badAfter));
    expect(r.ok).toBe(false);
    expect(r.missingClasses).toContain("grid");
  });
  it("fails when a tag is changed or an element removed", () => {
    const r = compareSkeleton(htmlSkeleton(before), htmlSkeleton(badAfter));
    expect(r.ok).toBe(false);
  });
});

describe("js identifier gate", () => {
  it("passes when only string data changed", () => {
    const a = `class NorthpointApp { init(){ const q='Great kitchen'; } }`;
    const b = `class NorthpointApp { init(){ const q='Great paint job'; } }`;
    expect(compareJs(jsIdentifiers(a), jsIdentifiers(b)).ok).toBe(true);
  });
  it("fails when a method disappears", () => {
    const a = `class App { init(){} bindFaq(){} }`;
    const b = `class App { init(){} }`;
    const r = compareJs(jsIdentifiers(a), jsIdentifiers(b));
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("bindFaq");
  });
});

// The gate blocks real generations, so its deliberate tolerances are pinned
// here: each of these, if it regressed, would fail a good site rather than
// catch a bad one.
describe("structure gate tolerances", () => {
  it("allows additions — a real business may have more services than the demo", () => {
    const template = htmlSkeleton(`<div class="cards"><article class="card">a</article></div>`);
    const grown = htmlSkeleton(
      `<div class="cards" id="new"><article class="card featured">a</article><article class="card">b</article></div>`
    );
    expect(compareSkeleton(template, grown).ok).toBe(true);
  });
  it("reads single-quoted and unquoted class attributes", () => {
    const s = htmlSkeleton(`<div class='hero grid'><span class=badge id='b'>x</span></div>`);
    expect([...s.classes]).toEqual(["hero", "grid", "badge"]);
    expect([...s.ids]).toEqual(["b"]);
  });
  it("ignores markup inside html comments, which models routinely drop", () => {
    const before = htmlSkeleton(`<!-- <div class="alt-hero"> --><div class="hero"><p>a</p></div>`);
    const after = htmlSkeleton(`<div class="hero"><p>b</p></div>`);
    expect(compareSkeleton(before, after).ok).toBe(true);
  });
  it("does not mistake keywords or calls for declared identifiers", () => {
    const ids = jsIdentifiers(`
      class App {
        init() { if (a) { for (let i = 0; i < 3; i++) { doIt(); } } }
        bindFaq() { try { x(); } catch (e) { while (y) { z(); } } }
      }
      window.App = App;
    `);
    expect([...ids].sort()).toEqual(["App", "bindFaq", "i", "init"]);
  });
  it("does not raise phantoms from commented-out code", () => {
    expect([...jsIdentifiers(`// const oldName = 5;\nconst real = 1;`)]).toEqual(["real"]);
  });
  it("does not let a url's // or a stray quote blank the rest of the line", () => {
    expect([...jsIdentifiers(`const url = 'http://x.com/a'; const after = 1;`)]).toEqual(["url", "after"]);
    expect([...jsIdentifiers(`const re = /['"]/g; const tail = 1;`)]).toEqual(["re", "tail"]);
  });
  it("survives a realistic data-only rewrite of script.js", () => {
    const app = (quote: string, author: string) => `
      class NorthpointApp {
        constructor() { this.testimonials = [{ quote: "${quote}", author: "${author}" }]; }
        init() { this.bindFaq(); }
        bindFaq() { document.querySelectorAll('.faq-item').forEach((el) => { el.onclick = () => {}; }); }
      }
      window.NorthpointApp = NorthpointApp;
    `;
    const a = jsIdentifiers(app("Great kitchen remodel", "Sarah M."));
    expect([...a].sort()).toEqual(["NorthpointApp", "bindFaq", "constructor", "init"]);
    expect(compareJs(a, jsIdentifiers(app("Fantastic paint job", "Dave R."))).ok).toBe(true);
  });
  it("reports plain arrays, so gate_results can be persisted as JSON", () => {
    const skeleton = compareSkeleton(htmlSkeleton(before), htmlSkeleton(badAfter));
    const js = compareJs(jsIdentifiers(`class App { init(){} bindFaq(){} }`), jsIdentifiers(`class App { init(){} }`));
    expect(JSON.parse(JSON.stringify(skeleton))).toEqual(skeleton);
    expect(JSON.parse(JSON.stringify(js))).toEqual(js);
    expect(Array.isArray(skeleton.missingClasses)).toBe(true);
    expect(Array.isArray(js.missing)).toBe(true);
  });
});
