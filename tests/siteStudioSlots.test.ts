import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { extractSlots, isSlottableLeaf } from "@/lib/site-studio/compiler/slots";
import { PageSource } from "@/lib/site-studio/compiler/inventory";

const page = (html: string): PageSource =>
  ({ file: "index.html", id: "index", kind: "home", root: parse(html) });

describe("isSlottableLeaf", () => {
  it("accepts a plain paragraph and one with inline formatting", () => {
    const root = parse("<p>Hello world</p><p>Hi <strong>there</strong></p><div><p>x</p></div>");
    const [a, b, c] = root.querySelectorAll("p, div");
    expect(isSlottableLeaf(a)).toBe(true);
    expect(isSlottableLeaf(b)).toBe(true);
    expect(isSlottableLeaf(c)).toBe(false);
  });
  it("rejects short text and structural containers", () => {
    expect(isSlottableLeaf(parse("<span>ok</span>").querySelector("span")!)).toBe(false);
    expect(isSlottableLeaf(parse("<p><a href='x.html'>Go</a></p>").querySelector("p")!)).toBe(false);
  });
  it("rejects leaves whose non-inline descendant is nested inside an inline wrapper", () => {
    expect(isSlottableLeaf(parse(`<p>Hi <span><a href="x.html">link</a></span> there</p>`).querySelector("p")!)).toBe(false);
    expect(isSlottableLeaf(parse(`<p>Hi <span><img src="x.jpg"></span></p>`).querySelector("p")!)).toBe(false);
  });
});

describe("extractSlots", () => {
  it("tokenizes text, records samples and html flag, and derives max_chars", () => {
    const p = page("<html><head><title>Acme | Home</title></head><body><h1>Big Headline</h1><p>Hi <strong>there</strong> friend</p></body></html>");
    const { slots, titleSample } = extractSlots(p);
    expect(titleSample).toBe("Acme | Home");
    expect(p.root.querySelector("title")!.innerHTML).toBe("{{title}}");
    const h1 = slots.find((s) => s.sample === "Big Headline")!;
    expect(h1.html).toBe(false);
    expect(h1.max_chars).toBe(Math.max(40, Math.ceil("Big Headline".length * 1.5)));
    const rich = slots.find((s) => s.sample.includes("strong"))!;
    expect(rich.html).toBe(true);
    expect(p.root.querySelector("h1")!.innerHTML).toBe(`{{slot:${h1.id}}}`);
  });
  it("tokenizes images with paired alt slots", () => {
    const p = page(`<body><img src="img/a.jpg" alt="A plumber" width="800" height="450"></body>`);
    const { slots } = extractSlots(p);
    const img = slots.find((s) => s.type === "image")!;
    expect(img.sample).toBe("img/a.jpg");
    expect(img.aspect).toBe("16:9");
    const alt = slots.find((s) => s.id === `${img.id}_alt`)!;
    expect(alt.sample).toBe("A plumber");
    const el = p.root.querySelector("img")!;
    expect(el.getAttribute("src")).toBe(`{{img:${img.id}}}`);
    expect(el.getAttribute("alt")).toBe(`{{slot:${alt.id}}}`);
  });
  it("never slots identity tokens as standalone text", () => {
    const p = page("<body><p>{{id:phone}}</p><p>Call {{id:phone}} now for help</p></body>");
    const { slots } = extractSlots(p);
    expect(slots).toHaveLength(1);
    expect(slots[0].sample).toBe("Call {{id:phone}} now for help");
  });
  it("tokenizes an img stranded between sibling text and warns stranded_text", () => {
    const p = page(`<body><p>Call us <img src="i.jpg" alt="Phone"> now</p></body>`);
    const { slots, diagnostics } = extractSlots(p);
    const img = slots.find((s) => s.type === "image")!;
    expect(p.root.querySelector("img")!.getAttribute("src")).toBe(`{{img:${img.id}}}`);
    expect(diagnostics.some((d) => d.code === "stranded_text")).toBe(true);
  });
  it("warns and inserts a title token when the page has no <title>", () => {
    const p = page("<html><head></head><body><h1>Hello there</h1></body></html>");
    const { titleSample, diagnostics } = extractSlots(p);
    expect(titleSample).toBe("");
    expect(diagnostics.some((d) => d.code === "title_missing")).toBe(true);
    expect(p.root.querySelector("head")!.toString()).toContain("<title>{{title}}</title>");
  });
  it("keeps only the first of multiple <title> elements and warns title_duplicate", () => {
    const p = page("<html><head><title>First</title><title>Second</title></head><body></body></html>");
    const { titleSample, diagnostics } = extractSlots(p);
    expect(titleSample).toBe("First");
    expect(p.root.querySelectorAll("title")).toHaveLength(1);
    expect(p.root.querySelector("title")!.innerHTML).toBe("{{title}}");
    expect(diagnostics.some((d) => d.code === "title_duplicate")).toBe(true);
  });
  it("flags an img with no alt attribute", () => {
    const p = page(`<body><img src="x.jpg"></body>`);
    const { diagnostics } = extractSlots(p);
    expect(diagnostics.some((d) => d.code === "img_alt_missing")).toBe(true);
  });
  it("does not slot a nav/repeat marker container", () => {
    // The shared page() helper uses bare parse(html), which drops comments
    // entirely (options.comment defaults to false) — the marker wouldn't
    // survive into the DOM and this test would pass for the wrong reason.
    // Parse with { comment: true } here so the marker is a real CommentNode,
    // matching what extractNav/extractRepeats leave behind before extractSlots runs.
    const root = parse(
      `<body><ul><!--@nav:nav_header--></ul><div class="cards"><!--@repeat:index_r1--></div><p>Real body copy here</p></body>`,
      { comment: true },
    );
    const p: PageSource = { file: "index.html", id: "index", kind: "home", root };
    const { slots } = extractSlots(p);
    expect(slots).toHaveLength(1);
    expect(slots[0].sample).toBe("Real body copy here");
    expect(slots.some((s) => s.sample.includes("<!--@"))).toBe(false);
  });
});
