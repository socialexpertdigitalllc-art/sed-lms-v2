// @vitest-environment node
import { describe, it, expect } from "vitest";
import { unzipToMap } from "@/lib/site-studio/zip";
import {
  buildBrief,
  pickReferencePages,
  runSite,
  regeneratePage,
  assembleZip,
  selectPages,
  matchTemplatePage,
  findComponentsFile,
  type PageState,
} from "@/lib/site-builder/run";
import type { AiCall } from "@/lib/site-builder/generate";
import { SITE_COMPONENTS_SYSTEM } from "@/lib/site-builder/prompt";
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

describe("matchTemplatePage", () => {
  const files = ["index.html", "about.html", "contact-us.html", "services.html", "service-areas.html"];

  it("matches exactly by slug", () => {
    expect(matchTemplatePage("Services", files)).toBe("services.html");
    expect(matchTemplatePage("Service Areas", files)).toBe("service-areas.html");
  });

  it("maps every home-ish name to the index page", () => {
    for (const name of ["Home", "Homepage", "Landing Page", "Main"]) {
      expect(matchTemplatePage(name, files)).toBe("index.html");
    }
  });

  it("matches forgivingly across extra tokens, both directions", () => {
    expect(matchTemplatePage("About Us", files)).toBe("about.html");
    expect(matchTemplatePage("Contact", files)).toBe("contact-us.html");
  });

  it("returns null when the template has no page of that type", () => {
    expect(matchTemplatePage("Pricing", files)).toBeNull();
    expect(matchTemplatePage("Reviews", files)).toBeNull();
  });
});

describe("selectPages", () => {
  const files = ["index.html", "about.html", "services.html", "gallery.html", "contact.html"];

  it("an empty request means the whole template", () => {
    expect(selectPages(files, [])).toEqual({ existing: [...files], newPages: [] });
  });

  it("builds ONLY the requested pages — plus the entry page, always", () => {
    const plan = selectPages(files, ["About Us", "Contact"]);
    expect(plan.existing).toEqual(["index.html", "about.html", "contact.html"]);
    expect(plan.newPages).toEqual([]);
  });

  it("turns a requested page the template lacks into a designed new page", () => {
    const plan = selectPages(files, ["Pricing"]);
    expect(plan.existing).toEqual(["index.html"]);
    expect(plan.newPages).toEqual([{ name: "Pricing", file: "pricing.html" }]);
  });

  it("two requested names resolving to the same template page build it once", () => {
    const plan = selectPages(files, ["Home", "Homepage", "About"]);
    expect(plan.existing).toEqual(["index.html", "about.html"]);
    expect(plan.newPages).toEqual([]);
  });
});

describe("findComponentsFile", () => {
  it("finds a components.js among the assets", () => {
    const tpl = bundle({ "index.html": "<html></html>" }, { "js/components.js": "// demo header" });
    expect(findComponentsFile(tpl)).toEqual({ file: "js/components.js", source: "// demo header" });
  });

  it("finds a components.html among the pages", () => {
    const tpl = bundle({ "index.html": "<html></html>", "components.html": "<header>Demo Co</header>" });
    expect(findComponentsFile(tpl)).toEqual({ file: "components.html", source: "<header>Demo Co</header>" });
  });

  it("returns null when the template has none", () => {
    const tpl = bundle({ "index.html": "<html></html>" }, { "css/style.css": "body{}" });
    expect(findComponentsFile(tpl)).toBeNull();
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

  it("a THROWN provider failure fails only that page — the run still ships the rest", async () => {
    // The regression this guards: before the rate limiter, a MiniMax 429 fell
    // through to a fallback provider and the run quietly completed. `callForTask`
    // now (correctly) refuses to reroute a retryable failure, so a sustained 429
    // THROWS out of aiCall. Under a bare `Promise.all` that rejected the whole
    // run — the route marked it "failed", uploaded no zip, and discarded every
    // page that had already succeeded. Every other failure test here uses an
    // aiCall that RESOLVES with bad text, so nothing covered this path.
    const tpl = bundle({ "index.html": "<html>old index</html>", "about.html": "<html>old about</html>" });
    const call: AiCall = async (_s, u) => {
      if (u.includes("THE PAGE TO REWRITE: about.html")) throw new Error("minimax rate limit exceeded (HTTP 429)");
      return { text: okHtml("NEW INDEX") };
    };
    const result = await runSite({ aiCall: call, brief, images: [], template: tpl, requestedPages: [] });

    expect(result.ok).toBe(true);
    expect(result.pages["index.html"].status).toBe("ok");
    expect(result.pages["about.html"].status).toBe("failed");
    // Names the file AND preserves the provider's own words — the only thing
    // that tells the operator to regenerate rather than change a setting.
    expect(result.pages["about.html"].error).toContain("about.html");
    expect(result.pages["about.html"].error).toContain("minimax rate limit exceeded (HTTP 429)");

    // and the run still produced a zip carrying the pages that DID succeed
    const files = unzipToMap(result.zipBytes!);
    expect(files["index.html"]).toBeDefined();
    expect(files["about.html"]).toBeUndefined();
  });

  it("a THROWN failure on a designed NEW page is recorded the same way", async () => {
    const tpl = bundle({ "index.html": "<html>home</html>" });
    const call: AiCall = async (_s, u) => {
      if (u.includes("YOUR JOB: CREATE A NEW PAGE")) throw new Error("provider call timed out after 300s");
      return { text: okHtml("NEW INDEX") };
    };
    const result = await runSite({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      requestedPages: ["Pricing"],
    });

    expect(result.ok).toBe(true);
    expect(result.pages["index.html"].status).toBe("ok");
    expect(result.pages["pricing.html"]).toMatchObject({ status: "failed", kind: "new", name: "Pricing" });
    expect(result.pages["pricing.html"].error).toContain("pricing.html");
    expect(result.pages["pricing.html"].error).toContain("timed out");
  });

  it("a THROWN components failure never kills the run — pages still generate", async () => {
    // Same contract as the existing "failed components rewrite" test, but for
    // the throwing path: the components call is awaited OUTSIDE the Promise.all,
    // so an uncaught throw there killed the run before a single page started.
    const tpl = bundle({ "index.html": "<html>home</html>" }, { "components.js": "const NAME = 'Demo Kitchens';" });
    const call: AiCall = async (system) => {
      if (system.includes("shared-components file")) throw new Error("HTTP 429 rate limit exceeded");
      return { text: okHtml("PAGE") };
    };
    const result = await runSite({ aiCall: call, brief, images: [], template: tpl, requestedPages: [] });

    expect(result.ok).toBe(true);
    expect(result.pages["components.js"].status).toBe("failed");
    expect(result.pages["components.js"].error).toContain("components.js");
    expect(result.pages["components.js"].error).toContain("HTTP 429 rate limit exceeded");
    expect(result.pages["index.html"].status).toBe("ok");
    // the template's own copy still ships, exactly as for a non-throwing failure
    const files = unzipToMap(result.zipBytes!);
    expect(dec.decode(files["components.js"])).toBe("const NAME = 'Demo Kitchens';");
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

  it("generates ONLY the requested pages — unrequested template pages never ship", async () => {
    const tpl = bundle(
      {
        "index.html": "<html>home</html>",
        "about.html": "<html>about</html>",
        "services.html": "<html>services</html>",
        "gallery.html": "<html>gallery</html>",
      },
      { "css/style.css": "body{}" },
    );
    const call: AiCall = async () => ({ text: okHtml("PAGE") });
    const result = await runSite({ aiCall: call, brief, images: [], template: tpl, requestedPages: ["About Us"] });

    expect(result.ok).toBe(true);
    expect(Object.keys(result.pages).sort()).toEqual(["about.html", "index.html"]);
    const files = unzipToMap(result.zipBytes!);
    expect(files["index.html"]).toBeDefined();
    expect(files["about.html"]).toBeDefined();
    expect(files["services.html"]).toBeUndefined();
    expect(files["gallery.html"]).toBeUndefined();
    expect(files["css/style.css"]).toBeDefined();
  });

  it("rewrites the components file FIRST and hands the result to every page prompt", async () => {
    const tpl = bundle(
      { "index.html": "<html>home</html>", "about.html": "<html>about</html>" },
      { "js/components.js": "const NAME = 'Demo Kitchens';" },
    );
    const calls: { system: string; user: string }[] = [];
    const call: AiCall = async (system, user) => {
      calls.push({ system, user });
      if (system.includes("shared-components file")) return { text: "const NAME = 'Acme Plumbing';" };
      return { text: okHtml("PAGE") };
    };
    const result = await runSite({ aiCall: call, brief, images: [], template: tpl, requestedPages: [] });

    expect(result.ok).toBe(true);
    // components strictly first
    expect(calls[0].system).toContain("shared-components file");
    expect(calls[0].user).toContain("js/components.js");
    // every later (page) prompt carries the REWRITTEN components content
    for (const c of calls.slice(1)) {
      expect(c.user).toContain("SHARED COMPONENTS FILE — js/components.js");
      expect(c.user).toContain("const NAME = 'Acme Plumbing';");
    }
    // the rewritten file replaces the template's copy in the zip
    const files = unzipToMap(result.zipBytes!);
    expect(dec.decode(files["js/components.js"])).toBe("const NAME = 'Acme Plumbing';");
    expect(result.pages["js/components.js"]).toMatchObject({ status: "ok", kind: "component" });
  });

  it("a failed components rewrite never kills the run — pages still generate, the template's copy still ships", async () => {
    const tpl = bundle(
      { "index.html": "<html>home</html>" },
      { "components.js": "const NAME = 'Demo Kitchens';" },
    );
    const call: AiCall = async (system) => {
      if (system.includes("shared-components file")) return { text: "" }; // empty reply -> failure
      return { text: okHtml("PAGE") };
    };
    const result = await runSite({ aiCall: call, brief, images: [], template: tpl, requestedPages: [] });

    expect(result.ok).toBe(true);
    expect(result.pages["components.js"].status).toBe("failed");
    expect(result.pages["index.html"].status).toBe("ok");
    const files = unzipToMap(result.zipBytes!);
    expect(dec.decode(files["components.js"])).toBe("const NAME = 'Demo Kitchens';");
  });

  it("a components.html is the components file, never a page — and ships rewritten", async () => {
    const tpl = bundle({
      "index.html": "<html>home</html>",
      "components.html": "<header>Demo Kitchens</header>",
    });
    const call: AiCall = async (system) => {
      if (system.includes("shared-components file")) return { text: "<header>Acme Plumbing</header>" };
      return { text: okHtml("PAGE") };
    };
    const result = await runSite({ aiCall: call, brief, images: [], template: tpl, requestedPages: [] });

    expect(result.ok).toBe(true);
    expect(result.pages["components.html"]).toMatchObject({ status: "ok", kind: "component" });
    // it is not treated as a site page: requesting nothing built index only + the component
    expect(Object.keys(result.pages).sort()).toEqual(["components.html", "index.html"]);
    const files = unzipToMap(result.zipBytes!);
    expect(dec.decode(files["components.html"])).toBe("<header>Acme Plumbing</header>");
  });

  it("passes every picked image URL through to the prompt verbatim, downloading nothing", async () => {
    // Images are used BY LINK. The URL the operator picked is the URL the
    // page references — no copy in the zip, no rewriting, no shortening.
    const tpl = bundle({ "index.html": "<html>home</html>" }, { "style.css": "body{}" });
    const pexelsUrl = "https://images.pexels.com/photos/1234/pexels-photo-1234.jpeg?auto=compress&cs=tinysrgb&w=1260";
    const clientUrl = "https://i.ibb.co/abc123/shop-front.jpg";
    const prompts: string[] = [];
    const call: AiCall = async (_s, u) => {
      prompts.push(u);
      return { text: okHtml("PAGE") };
    };

    const result = await runSite({
      aiCall: call,
      brief,
      images: [
        { url: pexelsUrl, purpose: "Hero" },
        { url: clientUrl, purpose: "Gallery" },
      ],
      template: tpl,
      requestedPages: [],
    });

    expect(result.ok).toBe(true);
    // the exact URLs reach the model, query string and all
    expect(prompts[0]).toContain(pexelsUrl);
    expect(prompts[0]).toContain(clientUrl);
    // and nothing was copied into the site
    const files = unzipToMap(result.zipBytes!);
    expect(Object.keys(files).some((f) => f.startsWith("images/"))).toBe(false);
    expect(Object.keys(files).sort()).toEqual(["index.html", "style.css"]);
  });

  it("REGRESSION: never hands the model a private-bucket signed URL", async () => {
    // The production failure: picks were stored as
    // …/object/sign/studio-assets/<uuid>.jpg?token=<JWT>, the model dropped
    // the mandatory token when writing <img src>, and the live pages 400'd
    // with "querystring must have required property 'token'". Picks now
    // resolve to public links, so such a URL must never be produced at all.
    const tpl = bundle({ "index.html": "<html>home</html>" });
    const prompts: string[] = [];
    const call: AiCall = async (_s, u) => {
      prompts.push(u);
      return { text: okHtml("PAGE") };
    };
    await runSite({
      aiCall: call,
      brief,
      images: [{ url: "https://images.pexels.com/photos/9/p.jpeg", purpose: "Hero" }],
      template: tpl,
      requestedPages: [],
    });
    for (const prompt of prompts) {
      expect(prompt).not.toContain("object/sign");
      expect(prompt).not.toContain("token=");
    }
  });

  it("reports live progress: everything pending first, components before pages, all terminal at the end", async () => {
    const tpl = bundle(
      { "index.html": "<html>home</html>", "about.html": "<html>about</html>" },
      { "components.js": "// demo" },
    );
    const snapshots: Record<string, PageState["status"]>[] = [];
    const call: AiCall = async (system) =>
      system.includes("shared-components file") ? { text: "// rewritten" } : { text: okHtml("PAGE") };
    await runSite({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      requestedPages: [],
      onProgress: (pages) => {
        snapshots.push(Object.fromEntries(Object.entries(pages).map(([f, p]) => [f, p.status])));
      },
    });

    // first frame: the full plan, all pending
    expect(snapshots[0]).toEqual({ "components.js": "pending", "index.html": "pending", "about.html": "pending" });
    // components generates while every page is still pending
    const componentsRunning = snapshots.find((s) => s["components.js"] === "generating");
    expect(componentsRunning).toBeDefined();
    expect(componentsRunning!["index.html"]).toBe("pending");
    expect(componentsRunning!["about.html"]).toBe("pending");
    // last frame: everything terminal
    const last = snapshots[snapshots.length - 1];
    expect(Object.values(last).every((s) => s === "ok" || s === "failed")).toBe(true);
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

  it("regenerates the components file from the template's own original source", async () => {
    const tpl = bundle({ "index.html": "<html>home</html>" }, { "js/components.js": "const NAME = 'Demo Kitchens';" });
    let seenSystem = "";
    let seenUser = "";
    const call: AiCall = async (s, u) => {
      seenSystem = s;
      seenUser = u;
      return { text: "const NAME = 'Acme Plumbing';" };
    };
    const outcome = await regeneratePage({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      siteFiles: ["index.html"],
      file: "js/components.js",
      kind: "component",
      instruction: "keep the booking form two-field",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.html).toBe("const NAME = 'Acme Plumbing';");
    expect(seenSystem).toContain("shared-components file");
    expect(seenUser).toContain("Demo Kitchens");
    expect(seenUser).toContain("keep the booking form two-field");
  });

  it("passes the run's rewritten components as context when regenerating a page", async () => {
    const tpl = bundle({ "index.html": "<html>home</html>" }, { "js/components.js": "// demo" });
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
      siteFiles: ["index.html"],
      file: "index.html",
      kind: "existing",
      components: { file: "js/components.js", source: "// rewritten for Acme" },
    });
    expect(outcome.ok).toBe(true);
    expect(seenUser).toContain("SHARED COMPONENTS FILE — js/components.js");
    expect(seenUser).toContain("// rewritten for Acme");
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

describe("runSite resume", () => {
  const brief = { business_name: "Acme Plumbing", services: [], service_areas: [] };

  /** Records every AI call so a test can assert what was — and was NOT — paid for. */
  function recorder(reply: (system: string, user: string) => string) {
    const calls: { system: string; user: string }[] = [];
    const call: AiCall = async (system, user) => {
      calls.push({ system, user });
      return { text: reply(system, user) };
    };
    return { calls, call };
  }

  const pageReply = (_s: string, u: string) => okHtml(u.includes("THE PAGE TO REWRITE: index.html") ? "FRESH INDEX" : "FRESH PAGE");

  it("keeps a page that already succeeded and never calls the AI for it", async () => {
    const tpl = bundle({ "index.html": "<html>old index</html>", "about.html": "<html>old about</html>" });
    const { calls, call } = recorder(pageReply);
    const result = await runSite({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      requestedPages: ["Home", "About"],
      resume: {
        "index.html": { status: "ok", kind: "existing", html: okHtml("CARRIED INDEX") },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.pages["index.html"]).toMatchObject({ status: "ok", kind: "existing" });
    expect(result.pages["index.html"].html).toContain("CARRIED INDEX");
    expect(result.pages["about.html"].status).toBe("ok");

    // the only page paid for was the one that had not finished
    expect(calls.some((c) => c.user.includes("THE PAGE TO REWRITE: about.html"))).toBe(true);
    expect(calls.some((c) => c.user.includes("THE PAGE TO REWRITE: index.html"))).toBe(false);
    expect(calls).toHaveLength(1);

    // and the carried page is what ships
    const files = unzipToMap(result.zipBytes!);
    expect(dec.decode(files["index.html"])).toContain("CARRIED INDEX");
  });

  it("regenerates a page whose carried state is not ok", async () => {
    const tpl = bundle({ "index.html": "<html>old index</html>" });
    const { calls, call } = recorder(pageReply);
    const result = await runSite({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      requestedPages: ["Home"],
      resume: {
        "index.html": { status: "failed", kind: "existing", error: "minimax rate limit exceeded (HTTP 429)" },
      },
    });

    expect(result.pages["index.html"].status).toBe("ok");
    expect(result.pages["index.html"].html).toContain("FRESH INDEX");
    expect(result.pages["index.html"].error).toBeUndefined();
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("regenerates a page left mid-flight by a killed run", async () => {
    const tpl = bundle({ "index.html": "<html>old index</html>" });
    const { calls, call } = recorder(pageReply);
    const result = await runSite({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      requestedPages: ["Home"],
      resume: {
        // the process died between "generating" and the outcome — no html was
        // ever recorded, so there is nothing to carry
        "index.html": { status: "generating", kind: "existing" },
      },
    });

    expect(result.pages["index.html"].status).toBe("ok");
    expect(result.pages["index.html"].html).toContain("FRESH INDEX");
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("recomputes the plan from the lead, dropping pages no longer requested", async () => {
    const tpl = bundle({ "index.html": "<html>old index</html>", "about.html": "<html>old about</html>" });
    const { call } = recorder(pageReply);
    const result = await runSite({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      // the lead's specify_pages changed between attempts — About is gone
      requestedPages: ["Home"],
      resume: {
        "index.html": { status: "ok", kind: "existing", html: okHtml("CARRIED INDEX") },
        "about.html": { status: "ok", kind: "existing", html: okHtml("CARRIED ABOUT") },
      },
    });

    expect(Object.keys(result.pages)).not.toContain("about.html");
    expect(result.pages["index.html"].html).toContain("CARRIED INDEX");
    const files = unzipToMap(result.zipBytes!);
    expect(files["about.html"]).toBeUndefined();
  });

  it("reuses a carried components file as context without re-calling for it", async () => {
    const tpl = bundle({ "index.html": "<html>home</html>" }, { "js/components.js": "const NAME = 'Demo Kitchens';" });
    const { calls, call } = recorder(pageReply);
    const result = await runSite({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      requestedPages: ["Home"],
      resume: {
        "js/components.js": { status: "ok", kind: "component", name: "Shared components", html: "const NAME = 'Acme Plumbing';" },
      },
    });

    expect(result.ok).toBe(true);
    expect(result.pages["js/components.js"]).toMatchObject({ status: "ok", kind: "component" });
    // nothing was paid for the components file
    expect(calls.some((c) => c.system === SITE_COMPONENTS_SYSTEM)).toBe(false);
    // ...and the carried source still reached the page prompt as context
    expect(calls).toHaveLength(1);
    expect(calls[0].user).toContain("SHARED COMPONENTS FILE — js/components.js");
    expect(calls[0].user).toContain("const NAME = 'Acme Plumbing';");
    // the carried rewrite is what ships, not the template's demo copy
    const files = unzipToMap(result.zipBytes!);
    expect(dec.decode(files["js/components.js"])).toBe("const NAME = 'Acme Plumbing';");
  });

  it("takes kind and name from the fresh plan, not from the carried entry", async () => {
    const tpl = bundle({ "index.html": "<html>old index</html>" });
    const { call } = recorder(pageReply);
    const result = await runSite({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      requestedPages: ["Home"],
      resume: {
        // a stale entry describing index.html as a designed page
        "index.html": { status: "ok", kind: "new", name: "Stale Name", html: okHtml("CARRIED INDEX") },
      },
    });

    expect(result.pages["index.html"].kind).toBe("existing");
    expect(result.pages["index.html"].name).toBeUndefined();
    expect(result.pages["index.html"].html).toContain("CARRIED INDEX");
  });

  it("keeps a carried DESIGNED page too, and never re-designs it", async () => {
    const tpl = bundle({ "index.html": "<html>old index</html>" });
    const { calls, call } = recorder(pageReply);
    const result = await runSite({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      requestedPages: ["Home", "Pricing"],
      resume: {
        "pricing.html": { status: "ok", kind: "new", name: "Pricing", html: okHtml("CARRIED PRICING") },
      },
    });

    expect(result.pages["pricing.html"]).toMatchObject({ status: "ok", kind: "new", name: "Pricing" });
    expect(result.pages["pricing.html"].html).toContain("CARRIED PRICING");
    // only the page that had not finished was paid for
    expect(calls).toHaveLength(1);
    expect(calls[0].user).toContain("THE PAGE TO REWRITE: index.html");
    expect(calls.some((c) => c.user.includes("YOUR JOB: CREATE A NEW PAGE"))).toBe(false);
  });

  it("makes no AI call at all when every requested page is already ok", async () => {
    const tpl = bundle({ "index.html": "<html>old index</html>" }, { "js/components.js": "const NAME = 'Demo Kitchens';" });
    const { calls, call } = recorder(pageReply);
    const result = await runSite({
      aiCall: call,
      brief,
      images: [],
      template: tpl,
      requestedPages: ["Home"],
      resume: {
        "js/components.js": { status: "ok", kind: "component", name: "Shared components", html: "const NAME = 'Acme Plumbing';" },
        "index.html": { status: "ok", kind: "existing", html: okHtml("CARRIED INDEX") },
      },
    });

    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(true);
    expect(result.zipBytes).toBeDefined();
    const files = unzipToMap(result.zipBytes!);
    expect(dec.decode(files["index.html"])).toContain("CARRIED INDEX");
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
