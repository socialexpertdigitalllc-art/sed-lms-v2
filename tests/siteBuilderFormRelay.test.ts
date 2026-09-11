import { describe, it, expect } from "vitest";
import { rewriteFormTargets, isSweepableFile, type FormRelayTarget } from "@/lib/site-builder/formRelay";
import { buildBrief } from "@/lib/site-builder/run";
import { SITE_BUILD_SYSTEM, SITE_COMPONENTS_SYSTEM, buildPagePrompt } from "@/lib/site-builder/prompt";

const TARGET: FormRelayTarget = {
  submit_url: "https://lms.sedsolutions.online/api/forms/submit",
  access_key: "NEW_KEY_abc123",
};

describe("rewriteFormTargets", () => {
  it("replaces the web3forms submit URL wherever it appears", () => {
    const src = `fetch("https://api.web3forms.com/submit", {})\n<form action="http://api.web3forms.com/submit/" method="POST">`;
    const out = rewriteFormTargets(src, TARGET);
    expect(out).not.toContain("web3forms");
    expect(out).toContain(`fetch("${TARGET.submit_url}"`);
    expect(out).toContain(`action="${TARGET.submit_url}"`);
  });

  it("replaces a JSON/object-literal access_key in either quote style", () => {
    const src = `const body = { "access_key": "OLD_KEY", name };\nJSON.stringify({ 'access_key': 'OLD2', ...data })`;
    const out = rewriteFormTargets(src, TARGET);
    expect(out).not.toContain("OLD_KEY");
    expect(out).not.toContain("OLD2");
    expect(out).toContain(`"access_key": "${TARGET.access_key}"`);
    expect(out).toContain(`'access_key': '${TARGET.access_key}'`);
  });

  it("replaces formData.append('access_key', …)", () => {
    const src = `formData.append("access_key", "stale-key-here");`;
    expect(rewriteFormTargets(src, TARGET)).toBe(`formData.append("access_key", "${TARGET.access_key}");`);
  });

  it("replaces a hidden input's value whichever attribute order the tag uses", () => {
    const nameFirst = `<input type="hidden" name="access_key" value="OLD">`;
    const valueFirst = `<input value="OLD" type="hidden" name='access_key'>`;
    expect(rewriteFormTargets(nameFirst, TARGET)).toContain(`value="${TARGET.access_key}"`);
    expect(rewriteFormTargets(valueFirst, TARGET)).toContain(`value="${TARGET.access_key}"`);
  });

  it("leaves unrelated inputs and keys alone", () => {
    const src = `<input name="email" value="a@b.c">\nconst k = { "api_key": "keep-me" };`;
    expect(rewriteFormTargets(src, TARGET)).toBe(src);
  });

  it("is idempotent — sweeping twice changes nothing more", () => {
    const src = `{"access_key":"OLD"} https://api.web3forms.com/submit`;
    const once = rewriteFormTargets(src, TARGET);
    expect(rewriteFormTargets(once, TARGET)).toBe(once);
  });
});

describe("isSweepableFile", () => {
  it("sweeps html/js/json, never binary assets", () => {
    expect(isSweepableFile("index.html")).toBe(true);
    expect(isSweepableFile("assets/components.js")).toBe(true);
    expect(isSweepableFile("data/site.json")).toBe(true);
    expect(isSweepableFile("img/hero.jpg")).toBe(false);
    expect(isSweepableFile("fonts/a.woff2")).toBe(false);
  });
});

describe("brief and prompts carry social profiles + the form endpoint", () => {
  it("buildBrief projects the lead's social profiles (Other resolved to its label, bad URLs dropped)", () => {
    const brief = buildBrief({
      id: "l1",
      business_name: "Acme",
      social_profiles: [
        { platform: "Facebook", url: "https://fb.com/acme", label: null },
        { platform: "Other", url: "https://pin.it/acme", label: "Pinterest" },
        { platform: "Instagram", url: "not-a-url", label: null },
      ],
    });
    expect(brief.social_profiles).toEqual([
      { platform: "Facebook", url: "https://fb.com/acme" },
      { platform: "Pinterest", url: "https://pin.it/acme" },
    ]);
  });

  it("buildBrief omits the field entirely when the lead has none", () => {
    expect("social_profiles" in buildBrief({ id: "l1", business_name: "Acme" })).toBe(false);
  });

  it("the page prompt lists the profiles and the endpoint; both system prompts state the rules", () => {
    const prompt = buildPagePrompt({
      brief: {
        business_name: "Acme",
        services: [],
        service_areas: [],
        social_profiles: [{ platform: "Facebook", url: "https://fb.com/acme" }],
        form_relay: TARGET,
      },
      images: [],
      pageFile: "index.html",
      pageHtml: "<html></html>",
      siteFiles: ["index.html"],
    });
    expect(prompt).toContain("https://fb.com/acme");
    expect(prompt).toContain(TARGET.submit_url);
    expect(prompt).toContain(TARGET.access_key);
    expect(SITE_BUILD_SYSTEM).toContain("FORMS SUBMIT TO THE BRIEF'S ENDPOINT");
    expect(SITE_BUILD_SYSTEM).toContain("social profiles");
    expect(SITE_COMPONENTS_SYSTEM).toContain("access_key");
    expect(SITE_COMPONENTS_SYSTEM).toContain("social profiles");
  });
});
