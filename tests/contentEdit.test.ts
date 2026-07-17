import { describe, it, expect } from "vitest";
import { applyContentEdit } from "@/lib/template-engine/contentEdit";
import { emptyContentModel } from "@/lib/template-engine/contentModel";

const base = () => {
  const m = emptyContentModel("Warrior Contracting");
  m.services = [{ key: "roofing", name: "Roofing", short: "s", long: "l", bullets: ["b"], image_query: "roof" }];
  m.image_briefs = [{ slot_id: "hero-1", kind: "hero", query: "modern home exterior" }];
  m.pages = { "index.html": { title: "Home", meta_description: "d" } };
  return m;
};

describe("applyContentEdit", () => {
  it("applies operator edits to the editable sections", () => {
    const incoming = base();
    incoming.hero.headline_parts = ["Built to last"];
    incoming.identity.tagline = "Contracting done right";
    incoming.services[0].short = "Roofs installed and repaired";
    const out = applyContentEdit(base(), incoming);
    expect(out.hero.headline_parts).toEqual(["Built to last"]);
    expect(out.identity.tagline).toBe("Contracting done right");
    expect(out.services[0].short).toBe("Roofs installed and repaired");
  });

  it("freezes image_briefs and pages no matter what the client sends", () => {
    // Slots are built ONCE in the plan phase; editing briefs would silently
    // desync the curation UI from the queries that produced it. Pages carry
    // per-file section keys the regenerator relies on.
    const incoming = base();
    incoming.image_briefs = [{ slot_id: "hacked", kind: "hero", query: "x" }];
    incoming.pages = {};
    const out = applyContentEdit(base(), incoming);
    expect(out.image_briefs).toEqual(base().image_briefs);
    expect(out.pages).toEqual(base().pages);
  });

  it("preserves each service's key and image_query from the existing model", () => {
    // `key` doubles as the slot id; image_query feeds /more. Both frozen.
    const incoming = base();
    incoming.services[0].key = "renamed";
    incoming.services[0].image_query = "different";
    const out = applyContentEdit(base(), incoming);
    expect(out.services[0].key).toBe("roofing");
    expect(out.services[0].image_query).toBe("roof");
  });

  it("rejects a model that adds or removes services", () => {
    const incoming = base();
    incoming.services = [...incoming.services, { key: "x", name: "X", short: "", long: "", bullets: [], image_query: "x" }];
    expect(() => applyContentEdit(base(), incoming)).toThrow();
  });
});
