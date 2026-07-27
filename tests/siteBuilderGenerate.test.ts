// @vitest-environment node
import { describe, it, expect } from "vitest";
import { extractHtml, generatePage, generateNewPage } from "@/lib/site-builder/generate";
import type { BusinessBrief } from "@/lib/site-builder/prompt";

const brief: BusinessBrief = {
  business_name: "Acme Plumbing",
  services: ["Sewer Repair"],
  service_areas: ["Denver"],
};

const RAW_PAGE = "<!DOCTYPE html><html><head><title>Demo</title></head><body>Hello</body></html>";

describe("extractHtml", () => {
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
