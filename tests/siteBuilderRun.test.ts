// @vitest-environment node
import { describe, it, expect } from "vitest";
import { unzipToMap } from "@/lib/site-studio/zip";
import { buildBrief, pickReferencePages, runSite, regeneratePage, assembleZip, type PageState } from "@/lib/site-builder/run";
import type { AiCall } from "@/lib/site-builder/generate";
import type { TemplateBundle } from "@/lib/site-builder/templates";

const enc = new TextEncoder();
const dec = new TextDecoder();

const okHtml = (label: string) => `<!DOCTYPE html><html><head><title>${label}</title></head><body>${label}</body></html>`;

function bundle(pages: Record<string, string>, assets: Record<string, string> = {}): TemplateBundle {
  const assetBytes: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(assets)) assetBytes[k] = enc.encode(v);
  return { pages, assets: assetBytes, pageFiles: Object.keys(pages), assetFiles: Object.keys(assetBytes) };
}

describe("buildBrief", () => {
  it("projects a lead row onto BusinessBrief via buildDossier, excluding commercial fields", () => {
    const lead = {
      id: "l1",
      business_name: "Acme Plumbing",
      business_phone: "(303) 555-1234",
      business_email: "hi@acme.test",
      business_profile_link: "https://www.google.com/maps/place/Acme",
      map_embed_link: "https://maps.google.com/embed?x",
      logo_link: "https://example.test/logo.png",
      services: ["Sewer Repair", "Water Heaters"],
      service_areas: ["Denver"],
      client_experience: 12,
      about_business: "Family run since 2012.",
      color_scheme: "navy and orange",
      // commercial/internal fields that must never reach the site
      price_quoted: 4200,
      yearly_price: 999,
      rating: 4.8,
      comments: "haggled on price",
      platform: "internal-crm",
    };
    const brief = buildBrief(lead);
    expect(brief.business_name).toBe("Acme Plumbing");
    expect(brief.phone).toBe("(303) 555-1234");
    expect(brief.email).toBe("hi@acme.test");
    expect(brief.map_embed).toBe("https://maps.google.com/embed?x");
    expect(brief.logo).toBe("https://example.test/logo.png");
    expect(brief.services).toEqual(["Sewer Repair", "Water Heaters"]);
    expect(brief.service_areas).toEqual(["Denver"]);
    expect(brief.years_experience).toBe(12);
    expect(brief.about_business).toBe("Family run since 2012.");
    expect(brief.color_scheme).toBe("navy and orange");
    // Nothing commercial/internal leaks through — BusinessBrief has no field
    // for any of it, so this is really "the object has exactly these keys".
    expect(Object.keys(brief).sort()).toEqual(
      ["about_business", "business_name", "color_scheme", "email", "logo", "map_embed", "phone", "profile_link", "service_areas", "services", "years_experience"].sort(),
    );
  });

  it("omits optional fields cleanly when the lead has nothing for them", () => {
    const brief = buildBrief({ id: "l2", business_name: "Bare Co" });
    expect(brief.business_name).toBe("Bare Co");
    expect(brief.phone).toBeUndefined();
    expect(brief.services).toEqual([]);
    expect(brief.service_areas).toEqual([]);
  });
});

describe("pickReferencePages", () => {
  it("picks the home page plus the two most size-different others", () => {
    const pages = {
      "index.html": "x".repeat(1000),
      "about.html": "x".repeat(1050), // closest to home — least interesting
      "gallery.html": "x".repeat(5000), // very different
      "contact.html": "x".repeat(200), // very different the other way
    };
    const refs = pickReferencePages(Object.keys(pages), pages);
    expect(refs[0]).toBe("index.html");
    expect(refs).toContain("gallery.html");
    expect(refs).toContain("contact.html");
    expect(refs).not.toContain("about.html");
    expect(refs).toHaveLength(3);
  });

  it("falls back to the first page alphabetically when there is no index.html", () => {
    const pages = { "about.html": "aaa", "zzz.html": "bbb" };
    const refs = pickReferencePages(Object.keys(pages), pages);
    expect(refs[0]).toBe("about.html");
  });

  it("returns fewer than 3 when the template has fewer pages", () => {
    const pages = { "index.html": "aaa" };
    expect(pickReferencePages(Object.keys(pages), pages)).toEqual(["index.html"]);
  });

  it("returns nothing for an empty template", () => {
    expect(pickReferencePages([], {})).toEqual([]);
  });
});

describe("runSite", () => {
  const brief = { business_name: "Acme Plumbing", services: [], service_areas: [] };

  it("generates every template page in parallel and copies assets through untouched", async () => {
    const tpl = bundle(
      { "index.html": "<html>old index</html>", "about.html": "<html>old about</html>" },
      { "css/style.css": "body{color:red}" },
    );
    const call: AiCall = async (_s, u) => ({ text: okHtml(u.includes("index.html") ? "NEW INDEX" : "NEW ABOUT") });
    const result = await runSite({ aiCall: call, brief, images: [], template: tpl, requestedPages: [] });

    expect(result.ok).toBe(true);
    expect(result.pages["index.html"]).toMatchObject({ status: "ok", kind: "existing" });
    expect(result.pages["about.html"]).toMatchObject({ status: "ok", kind: "existing" });
    expect(result.pages["index.html"].html).toContain("NEW INDEX");

    const files = unzipToMap(result.zipBytes!);
    expect(dec.decode(files["css/style.css"])).toBe("body{color:red}");
    expect(dec.decode(files["index.html"])).toContain("NEW INDEX");
  });

  it("designs a lead-requested page the template lacks, using reference pages", async () => {
    const tpl = bundle({ "index.html": "<html>old index</html>" });
    const seenPrompts: string[] = [];
    const call: AiCall = async (_s, u) => {
      seenPrompts.push(u);
      return { text: okHtml("PAGE") };
    };
    const result = await runSite({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      requestedPages: ["About Us"],
    });

    expect(result.ok).toBe(true);
    expect(Object.keys(result.pages)).toContain("about-us.html");
    expect(result.pages["about-us.html"]).toMatchObject({ status: "ok", kind: "new", name: "About Us" });
    const newPagePrompt = seenPrompts.find((p) => p.includes("YOUR JOB: CREATE A NEW PAGE"));
    expect(newPagePrompt).toContain("DESIGN REFERENCE");
  });

  it("does not create a requested page that already exists on the template", async () => {
    const tpl = bundle({ "about.html": "<html>old about</html>" });
    const call: AiCall = async () => ({ text: okHtml("PAGE") });
    const result = await runSite({ aiCall: call, brief, images: [], template: tpl, requestedPages: ["About"] });
    expect(Object.keys(result.pages)).toEqual(["about.html"]);
  });

  it("records a per-page failure without killing the run or touching other pages", async () => {
    const tpl = bundle({ "index.html": "<html>old index</html>", "about.html": "<html>old about</html>" });
    const call: AiCall = async (_s, u) => {
      if (u.includes("THE PAGE TO REWRITE: about.html")) return { text: "sorry, I can't do that" };
      return { text: okHtml("NEW INDEX") };
    };
    const result = await runSite({ aiCall: call, brief, images: [], template: tpl, requestedPages: [] });

    expect(result.ok).toBe(true); // index still succeeded
    expect(result.pages["index.html"].status).toBe("ok");
    expect(result.pages["about.html"].status).toBe("failed");
    expect(result.pages["about.html"].error).toContain("about.html");

    // the failed page is simply absent from the zip; the good one is present
    const files = unzipToMap(result.zipBytes!);
    expect(files["index.html"]).toBeDefined();
    expect(files["about.html"]).toBeUndefined();
  });

  it("fails the whole run only when every page fails", async () => {
    const tpl = bundle({ "index.html": "<html>old index</html>", "about.html": "<html>old about</html>" });
    const call: AiCall = async () => ({ text: "nope, cannot help" });
    const result = await runSite({ aiCall: call, brief, images: [], template: tpl, requestedPages: [] });

    expect(result.ok).toBe(false);
    expect(result.zipBytes).toBeUndefined();
    expect(result.pages["index.html"].status).toBe("failed");
    expect(result.pages["about.html"].status).toBe("failed");
  });
});

describe("regeneratePage", () => {
  const brief = { business_name: "Acme Plumbing", services: [], service_areas: [] };

  it("regenerates an existing page from the template's own original HTML", async () => {
    const tpl = bundle({ "index.html": "<html>original</html>", "about.html": "<html>orig about</html>" });
    let seenUser = "";
    const call: AiCall = async (_s, u) => {
      seenUser = u;
      return { text: okHtml("REGENERATED") };
    };
    const outcome = await regeneratePage({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      siteFiles: ["index.html", "about.html"],
      file: "index.html",
      kind: "existing",
      instruction: "shorten the hero",
    });
    expect(outcome.ok).toBe(true);
    expect(seenUser).toContain("original");
    expect(seenUser).toContain("shorten the hero");
  });

  it("regenerates a new page using reference pages and its saved name", async () => {
    const tpl = bundle({ "index.html": "<html>home</html>" });
    let seenUser = "";
    const call: AiCall = async (_s, u) => {
      seenUser = u;
      return { text: okHtml("REGENERATED") };
    };
    const outcome = await regeneratePage({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      siteFiles: ["index.html", "about-us.html"],
      file: "about-us.html",
      kind: "new",
      name: "About Us",
    });
    expect(outcome.ok).toBe(true);
    expect(seenUser).toContain("About Us");
    expect(seenUser).toContain("DESIGN REFERENCE");
  });

  it("reports an actionable error for an existing page no longer in the template", async () => {
    const tpl = bundle({ "index.html": "<html>home</html>" });
    const call: AiCall = async () => ({ text: okHtml("X") });
    const outcome = await regeneratePage({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      siteFiles: ["index.html"],
      file: "gone.html",
      kind: "existing",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toContain("gone.html");
  });
});

describe("assembleZip", () => {
  it("includes assets plus only the successfully-generated pages", () => {
    const assets = { "css/style.css": enc.encode("body{}") };
    const pages: Record<string, PageState> = {
      "index.html": { status: "ok", kind: "existing", html: "<html>ok</html>" },
      "about.html": { status: "failed", kind: "existing", error: "boom" },
    };
    const files = unzipToMap(assembleZip(assets, pages));
    expect(Object.keys(files).sort()).toEqual(["css/style.css", "index.html"]);
    expect(dec.decode(files["index.html"])).toBe("<html>ok</html>");
  });
});
