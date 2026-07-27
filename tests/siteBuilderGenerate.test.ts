// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  extractHtml,
  extractFileSource,
  stripReasoningBlocks,
  generatePage,
  generateNewPage,
  generateComponents,
} from "@/lib/site-builder/generate";
import type { BusinessBrief } from "@/lib/site-builder/prompt";

const brief: BusinessBrief = {
  business_name: "Acme Plumbing",
  services: ["Sewer Repair"],
  service_areas: ["Denver"],
};

const RAW_PAGE = "<!DOCTYPE html><html><head><title>Demo</title></head><body>Hello</body></html>";

describe("stripReasoningBlocks", () => {
  it("removes a <think> block, the shape MiniMax-M3 really returns", () => {
    // Verified live 2026-07-28: M3 returns its chain-of-thought inside the
    // ordinary `content` string, wrapped in <think>…</think>.
    const raw = `<think>\nThe user wants the page rewritten. Let me plan.\n</think>\n\n${RAW_PAGE}`;
    expect(stripReasoningBlocks(raw)).toBe(RAW_PAGE);
  });

  it("removes several blocks and tolerates <thinking>/<reasoning> spellings", () => {
    const raw = `<think>one</think>${RAW_PAGE}<reasoning>two</reasoning><thinking>three</thinking>`;
    expect(stripReasoningBlocks(raw)).toBe(RAW_PAGE);
  });

  it("drops everything after an UNCLOSED block — a reply cut off mid-thought has no file", () => {
    expect(stripReasoningBlocks("<think>I was still planning when the budget ran ou")).toBe("");
  });

  it("leaves a reply with no reasoning block untouched", () => {
    expect(stripReasoningBlocks(`  ${RAW_PAGE}  `)).toBe(RAW_PAGE);
  });
});

describe("extractHtml", () => {
  it("discards a <think> block and returns only the page", () => {
    const raw = `<think>Let me rewrite the hero. Actually, let me reconsider the nav.</think>\n${RAW_PAGE}`;
    const r = extractHtml(raw, "index.html");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe(RAW_PAGE);
  });

  it("a reply that is ONLY an unterminated think block fails cleanly", () => {
    const r = extractHtml("<think>planning, planning, and then the budget ran out", "index.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no HTML/i);
  });

  it("takes a clean reply as-is", () => {
    const r = extractHtml(RAW_PAGE, "index.html");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe(RAW_PAGE);
  });

  it("strips a ```html fence around the reply", () => {
    const raw = "```html\n" + RAW_PAGE + "\n```";
    const r = extractHtml(raw, "index.html");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe(RAW_PAGE);
  });

  it("strips a plain ``` fence (no language tag)", () => {
    const raw = "```\n" + RAW_PAGE + "\n```";
    const r = extractHtml(raw, "index.html");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe(RAW_PAGE);
  });

  it("strips a sentence of preamble before the doctype", () => {
    const raw = "Here is the rewritten page:\n\n" + RAW_PAGE;
    const r = extractHtml(raw, "about.html");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe(RAW_PAGE);
  });

  it("strips trailing commentary after </html>", () => {
    const raw = RAW_PAGE + "\n\nLet me know if you'd like any changes!";
    const r = extractHtml(raw, "about.html");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe(RAW_PAGE);
  });

  it("strips a fence AND preamble AND trailing commentary together", () => {
    const raw = "Sure, here you go:\n\n```html\n" + RAW_PAGE + "\n```\n\nHope that helps!";
    const r = extractHtml(raw, "contact.html");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe(RAW_PAGE);
  });

  it("accepts a reply with no doctype, just an opening <html> tag", () => {
    const raw = "<html><body>fine</body></html>";
    const r = extractHtml(raw, "index.html");
    expect(r.ok).toBe(true);
  });

  it("fails, naming the page and reply length, when there is no HTML at all", () => {
    const r = extractHtml("I'm sorry, I can't help with that request.", "services.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("services.html");
    expect(r.error).toMatch(/no HTML/i);
    expect(r.error).toMatch(/\d+ chars/);
  });

  it("fails as truncated when there's an opening tag but no closing </html>", () => {
    const raw = "<!DOCTYPE html><html><head><title>Demo</title></head><body>Hello, this just cuts off mid";
    const r = extractHtml(raw, "index.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("index.html");
    expect(r.error).toMatch(/truncated/i);
  });

  it("empty reply fails as no-HTML, not as truncated", () => {
    const r = extractHtml("", "index.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/no HTML/i);
  });

  it("prefers the FILE START/END markers over everything else in the reply", () => {
    const raw = [
      "Let me think about the header first.",
      "```html",
      "<html><body>a draft snippet, NOT the page</body></html>",
      "```",
      "Actually, that's wrong. Here's the final page:",
      "===FILE START===",
      RAW_PAGE,
      "===FILE END===",
      "Done! Let me know if you'd like changes.",
    ].join("\n");
    const r = extractHtml(raw, "index.html");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe(RAW_PAGE);
  });

  it("REGRESSION: a narrating reply that interleaves reasoning with HTML snippets must fail, never ship", () => {
    // Shape of the real production failure: prose planning + fenced snippets
    // + the page, no markers. The old first-<html>-to-last-</html> slice
    // swallowed all the narration into the shipped file.
    const raw = [
      "Let me analyze the template structure.",
      "```html",
      "<html><body>snippet one</body></html>",
      "```",
      "Actually, I should reconsider the hero section.",
      "Wait, the brief says no license claims. Let me remove those.",
      "I'll now write the final page:",
      RAW_PAGE,
    ].join("\n");
    const r = extractHtml(raw, "services.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("services.html");
    expect(r.error).toMatch(/regenerate/i);
  });

  it("a FILE START marker with no FILE END fails as truncation", () => {
    const raw = "===FILE START===\n<!DOCTYPE html><html><body>cut off mid-";
    const r = extractHtml(raw, "index.html");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/FILE END|cut off/i);
  });
});

describe("extractFileSource", () => {
  const SOURCE = "const NAME = 'Acme';\nexport { NAME };";

  it("returns a bare source reply as-is, trimmed", () => {
    const r = extractFileSource(`\n${SOURCE}\n`, "components.js");
    expect(r).toEqual({ ok: true, html: SOURCE });
  });

  it("strips a markdown fence, plus prose before it and commentary after it", () => {
    const raw = `Here is the rewritten file:\n\n\`\`\`js\n${SOURCE}\n\`\`\`\n\nLet me know if you'd like changes!`;
    const r = extractFileSource(raw, "components.js");
    expect(r).toEqual({ ok: true, html: SOURCE });
  });

  it("discards a <think> block and returns only the file source", () => {
    const raw = `<think>The header needs the new business name. Let me write it.</think>\n${SOURCE}`;
    expect(extractFileSource(raw, "components.js")).toEqual({ ok: true, html: SOURCE });
  });

  it("fails on an empty reply with the file's name in the error", () => {
    const r = extractFileSource("   ", "components.js");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("components.js");
  });

  it("prefers the FILE START/END markers, ignoring narration and snippet fences around them", () => {
    const raw = [
      "Let me plan the rewrite.",
      "```js",
      "// a small draft snippet",
      "```",
      "Actually, here is the final file:",
      "===FILE START===",
      SOURCE,
      "===FILE END===",
      "That covers everything.",
    ].join("\n");
    const r = extractFileSource(raw, "components.js");
    expect(r).toEqual({ ok: true, html: SOURCE });
  });

  it("unwraps a single fence INSIDE the markers instead of calling it contamination", () => {
    const raw = ["===FILE START===", "```js", SOURCE, "```", "===FILE END==="].join("\n");
    const r = extractFileSource(raw, "components.js");
    expect(r).toEqual({ ok: true, html: SOURCE });
  });

  it("REGRESSION: a marker-less narrating reply picks the LARGEST fenced block, not first-to-last", () => {
    // Shape of the real production failure: the old slicer took everything
    // from the first fence to the last, shipping the whole thought process
    // as the deployed components.js.
    const realFile = `class SiteHeader extends HTMLElement {\n  connectedCallback() { this.innerHTML = "<header>Acme</header>"; }\n}\ncustomElements.define("site-header", SiteHeader);\n// ${"x".repeat(400)}`;
    const raw = [
      "Looking at the template, the header uses a wordmark.",
      "```html",
      "<span>NORTHPOINT</span>",
      "```",
      "The final file:",
      "```javascript",
      realFile,
      "```",
    ].join("\n");
    const r = extractFileSource(raw, "components.js");
    expect(r).toEqual({ ok: true, html: realFile });
  });

  it("REGRESSION: a truncated narration-only reply (no markers, no closed final fence) must fail, never ship", () => {
    // The production components.js ended mid-sentence: hundreds of lines of
    // planning, quoted snippets, then "OK, writing the final file now. Hmm
    // one issue -" and the output limit hit. Nothing in it is the file, and
    // the only COMPLETE fenced block is a tiny quoted snippet — which must
    // not be mistaken for the deliverable.
    const planning = Array.from(
      { length: 60 },
      (_, i) => `The template's section ${i} needs its copy rewritten for the new trade before anything ships.`,
    ).join("\n");
    const raw = [
      "Let me work through the components one by one.",
      planning,
      "```html",
      "<span>NORTHPOINT</span>",
      "```",
      "I should replace this with an image tag.",
      "Actually, licensing claims must go. Let me remove those.",
      "Wait, the testimonials need generic names too.",
      "OK, writing the final file now. Hmm one issue -",
    ].join("\n");
    const r = extractFileSource(raw, "components.js");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/regenerate/i);
  });

  it("a FILE START marker with no FILE END fails as truncation", () => {
    const raw = "===FILE START===\nclass X extends HTMLElement {} // cut off";
    const r = extractFileSource(raw, "components.js");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/FILE END|cut off/i);
  });
});

describe("generateComponents", () => {
  const brief2: BusinessBrief = { business_name: "Acme Plumbing", services: ["Drains"], service_areas: ["Denver"] };

  it("sends the components prompt (site pages included) and returns the extracted source", async () => {
    let seenSystem = "";
    let seenUser = "";
    const call = async (system: string, user: string) => {
      seenSystem = system;
      seenUser = user;
      return { text: "const NAME = 'Acme Plumbing';" };
    };
    const r = await generateComponents({ aiCall: call }, {
      brief: brief2,
      images: [],
      file: "js/components.js",
      source: "const NAME = 'Demo Kitchens';",
      siteFiles: ["index.html", "about.html"],
    });
    expect(r).toEqual({ ok: true, html: "const NAME = 'Acme Plumbing';" });
    expect(seenSystem).toContain("shared-components file");
    expect(seenUser).toContain("js/components.js");
    expect(seenUser).toContain("Demo Kitchens");
    expect(seenUser).toContain("index.html, about.html");
  });

  it("fails when the rewrite lost the original's customElements.define registrations", async () => {
    const original = `class SiteHeader extends HTMLElement {}\ncustomElements.define("site-header", SiteHeader);`;
    const call = async () => ({ text: "// I rewrote the header colours\nconst ACCENT = '#0C5AA0';" });
    const r = await generateComponents({ aiCall: call }, {
      brief: brief2,
      images: [],
      file: "components.js",
      source: original,
      siteFiles: ["index.html"],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("customElements.define");
  });

  it("fails when the rewrite is implausibly short next to the original", async () => {
    const original = `// shared components\n${"const filler = 1;\n".repeat(200)}`;
    const call = async () => ({ text: "const stub = true;" });
    const r = await generateComponents({ aiCall: call }, {
      brief: brief2,
      images: [],
      file: "components.js",
      source: original,
      siteFiles: ["index.html"],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/implausibly short/i);
  });
});

describe("generatePage", () => {
  it("sends the page prompt and returns the extracted HTML", async () => {
    let seenSystem = "";
    let seenUser = "";
    const call = async (system: string, user: string) => {
      seenSystem = system;
      seenUser = user;
      return { text: RAW_PAGE };
    };
    const r = await generatePage({ aiCall: call }, {
      brief,
      images: [],
      pageFile: "index.html",
      pageHtml: "<html>old demo page</html>",
      siteFiles: ["index.html", "about.html"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toBe(RAW_PAGE);
    expect(seenSystem).toMatch(/rewrite one page/i);
    expect(seenUser).toContain("Acme Plumbing");
    expect(seenUser).toContain("index.html");
  });

  it("appends an operator instruction without touching the prompt's own text", async () => {
    let seenUser = "";
    const call = async (_system: string, user: string) => {
      seenUser = user;
      return { text: RAW_PAGE };
    };
    await generatePage({ aiCall: call }, {
      brief,
      images: [],
      pageFile: "index.html",
      pageHtml: "<html>old</html>",
      siteFiles: ["index.html"],
      instruction: "Make the hero shorter",
    });
    expect(seenUser).toContain("Make the hero shorter");
    expect(seenUser).toContain("OPERATOR INSTRUCTION");
  });

  it("surfaces a page-labelled, actionable failure when the model returns no HTML", async () => {
    const call = async () => ({ text: "sorry, cannot do that" });
    const r = await generatePage({ aiCall: call }, {
      brief,
      images: [],
      pageFile: "gallery.html",
      pageHtml: "<html>old</html>",
      siteFiles: ["gallery.html"],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("gallery.html");
  });
});

describe("generateNewPage", () => {
  it("sends the new-page prompt with references and returns the extracted HTML", async () => {
    let seenUser = "";
    const call = async (_system: string, user: string) => {
      seenUser = user;
      return { text: RAW_PAGE };
    };
    const r = await generateNewPage({ aiCall: call }, {
      brief,
      images: [],
      pageName: "About Us",
      newFile: "about-us.html",
      references: [{ file: "index.html", html: "<html>home</html>" }],
      siteFiles: ["index.html", "about-us.html"],
    });
    expect(r.ok).toBe(true);
    expect(seenUser).toContain("About Us");
    expect(seenUser).toContain("about-us.html");
    expect(seenUser).toContain("DESIGN REFERENCE");
  });
});
