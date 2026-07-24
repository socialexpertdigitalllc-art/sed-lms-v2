import { describe, it, expect } from "vitest";
import { applyIdentityAdditions } from "@/lib/site-studio/compiler/ai/applyIdentity";
import type { CompiledTemplate } from "@/lib/site-studio/schema";

const tpl = (): CompiledTemplate => ({
  manifest: {
    engine: 3, name: "t", version: 1,
    identity: { business_name: "Demo Co", phone: "(111) 111-1111" },
    theme: { mode: "none", roles: {} },
    nav: [{ id: "n", fragment: "n", location: "header", items: [{ page_id: "index", href: "index.html", label: "Meet John Carpenter" }] }],
    pages: [{
      id: "index", file: "index.html", kind: "home", stampable: false,
      title_sample: "Demo Co | Denver's finest",
      slots: [{ id: "s1", type: "text", sample: "Founded by John Carpenter in Denver.", html: false, max_chars: 60 }],
      repeats: [{ id: "r1", fragment: "r1", min: 1, max: 12,
        slots: [{ id: "r1_s1", type: "text", sample: "John Carpenter approves", html: false, max_chars: 40 }],
        samples: [{ r1_s1: "John Carpenter approves" }] }],
    }],
  },
  pages: { "index.html": `<p>{{slot:s1}}</p><p>Call John Carpenter — serving Denver since 1999.</p>` },
  fragments: { r1: `<div>{{slot:r1_s1}}</div>`, n: `<li><a href="{{nav:href}}">{{nav:title}}</a></li>` },
  assets: {},
});

describe("applyIdentityAdditions", () => {
  it("tokenizes a person name everywhere: skeleton, samples, repeat rows, nav labels", () => {
    const r = applyIdentityAdditions(tpl(), [
      { key: "owner_name", value: "John Carpenter" },
      { key: "city", value: "Denver" },
    ]);
    expect(r.applied.map((a) => a.key).sort()).toEqual(["city", "owner_name"]);
    expect(r.template.manifest.identity.owner_name).toBe("John Carpenter");
    const skel = r.template.pages["index.html"];
    expect(skel).not.toContain("John Carpenter");
    expect(skel).toContain("{{id:owner_name}}");
    expect(skel).toContain("{{id:city}}");
    const page = r.template.manifest.pages[0];
    expect(page.slots[0].sample).toBe("Founded by {{id:owner_name}} in {{id:city}}.");
    expect(page.repeats[0].samples[0].r1_s1).toBe("{{id:owner_name}} approves");
    expect(page.title_sample).toContain("{{id:city}}");
    expect(r.template.manifest.nav[0].items![0].label).toBe("Meet {{id:owner_name}}");
  });
  it("does not mutate the input template", () => {
    const input = tpl();
    applyIdentityAdditions(input, [{ key: "owner_name", value: "John Carpenter" }]);
    expect(input.pages["index.html"]).toContain("John Carpenter");
  });
  it("skips: existing key, short value, token-bearing value, all-lowercase value, not-found value", () => {
    const r = applyIdentityAdditions(tpl(), [
      { key: "business_name", value: "Someone Else" },
      { key: "x", value: "Jo" },
      { key: "bad", value: "has {{id:phone}} inside" },
      { key: "generic", value: "denver" },
      { key: "ghost", value: "Nobody Here" },
    ]);
    expect(r.applied).toEqual([]);
    expect(r.skipped.map((s) => s.key).sort()).toEqual(["bad", "business_name", "generic", "ghost", "x"]);
  });
  it("word-bounds: 'Denver' must not match inside 'Denverite'", () => {
    const t = tpl();
    t.pages["index.html"] = `<p>A true Denverite in Denver.</p>`;
    const r = applyIdentityAdditions(t, [{ key: "city", value: "Denver" }]);
    expect(r.template.pages["index.html"]).toBe(`<p>A true Denverite in {{id:city}}.</p>`);
  });
  it("never tokenizes inside image slot samples (file paths), even when the value matches", () => {
    const t = tpl();
    t.manifest.pages[0].slots.push({ id: "img1", type: "image", sample: "img/Denver-photo.jpg", html: false });
    t.manifest.pages[0].repeats[0].slots.push({ id: "r1_img", type: "image", sample: "img/Denver-card.jpg", html: false });
    t.manifest.pages[0].repeats[0].samples[0].r1_img = "img/Denver-card.jpg";
    const r = applyIdentityAdditions(t, [{ key: "city", value: "Denver" }]);
    expect(r.applied.map((a) => a.key)).toContain("city");
    const page = r.template.manifest.pages[0];
    expect(page.slots.find((s) => s.id === "img1")!.sample).toBe("img/Denver-photo.jpg");
    expect(page.repeats[0].slots.find((s) => s.id === "r1_img")!.sample).toBe("img/Denver-card.jpg");
    expect(page.repeats[0].samples[0].r1_img).toBe("img/Denver-card.jpg");
    // meanwhile the paired text slot/sample still gets tokenized normally
    expect(page.slots[0].sample).toContain("{{id:city}}");
  });
  it("also matches the HTML-entity-encoded form of a value (title_sample raw vs slot sample encoded)", () => {
    const t = tpl();
    t.manifest.pages[0].title_sample = "Welcome to Denver & Sons";
    t.manifest.pages[0].slots[0].sample = "Trusted since 1999 — Denver &amp; Sons crew";
    const r = applyIdentityAdditions(t, [{ key: "company", value: "Denver & Sons" }]);
    expect(r.applied.map((a) => a.key)).toContain("company");
    const page = r.template.manifest.pages[0];
    expect(page.title_sample).toBe("Welcome to {{id:company}}");
    expect(page.slots[0].sample).toBe("Trusted since 1999 — {{id:company}} crew");
    expect(page.title_sample).not.toContain("Denver & Sons");
    expect(page.slots[0].sample).not.toContain("Denver &amp; Sons");
  });
  it("orders longest-value-first so a short value proposed alongside a longer one doesn't fragment it", () => {
    const r = applyIdentityAdditions(tpl(), [
      { key: "first", value: "John" },
      { key: "owner", value: "John Carpenter" },
    ]);
    expect(r.applied.map((a) => a.key)).toEqual(["owner"]);
    expect(r.template.manifest.identity.owner).toBe("John Carpenter");
    const skel = r.template.pages["index.html"];
    expect(skel).not.toContain("Carpenter");
    expect(skel).not.toContain("John Carpenter");
    expect(r.skipped.some((s) => s.key === "first" && s.reason === "value not found in package")).toBe(true);
  });
});
