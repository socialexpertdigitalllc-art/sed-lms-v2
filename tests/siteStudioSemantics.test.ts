import { describe, it, expect } from "vitest";
import { applySemantics, proposeSemantics, SEMANTIC_LABELS } from "@/lib/site-studio/compiler/ai/semantics";
import type { CompiledTemplate } from "@/lib/site-studio/schema";

const tpl = (): CompiledTemplate => ({
  manifest: {
    engine: 3, name: "t", version: 1,
    identity: {}, theme: { mode: "none", roles: {} }, nav: [],
    pages: [
      { id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home",
        slots: [{ id: "s1", type: "text", sample: "Big headline here", html: false, max_chars: 40 }],
        repeats: [{ id: "r1", fragment: "r1", min: 1, max: 12,
          slots: [{ id: "r1_s1", type: "text", sample: "Card", html: false, max_chars: 40 }], samples: [{ r1_s1: "Card" }] }] },
      { id: "drain", file: "drain.html", kind: "generic", stampable: false, title_sample: "Drain Cleaning",
        slots: [], repeats: [] },
    ],
  },
  pages: {}, fragments: {}, assets: {},
});

describe("applySemantics", () => {
  it("sets page kinds, recomputes stampable, labels slots (incl. repeat slots)", () => {
    const { template, diagnostics } = applySemantics(tpl(), {
      pages: [{ id: "drain", kind: "service" }],
      slots: [{ id: "s1", semantic: "headline" }, { id: "r1_s1", semantic: "label" }],
    });
    const drain = template.manifest.pages.find((p) => p.id === "drain")!;
    expect(drain.kind).toBe("service");
    expect(drain.stampable).toBe(true);
    expect(template.manifest.pages[0].slots[0].semantic).toBe("headline");
    expect(template.manifest.pages[0].repeats[0].slots[0].semantic).toBe("label");
    expect(diagnostics).toEqual([]);
  });
  it("rejects unknown kinds/labels/ids with warn diagnostics, applies the rest", () => {
    const { template, diagnostics } = applySemantics(tpl(), {
      pages: [{ id: "drain", kind: "landing" }, { id: "ghost", kind: "service" }],
      slots: [{ id: "s1", semantic: "sparkly" }, { id: "nope", semantic: "headline" }],
    });
    expect(template.manifest.pages.find((p) => p.id === "drain")!.kind).toBe("generic");
    expect(diagnostics.filter((d) => d.code === "ai_semantics_rejected")).toHaveLength(4);
  });
  it("does not mutate the input", () => {
    const input = tpl();
    applySemantics(input, { pages: [{ id: "drain", kind: "service" }], slots: [] });
    expect(input.manifest.pages.find((p) => p.id === "drain")!.kind).toBe("generic");
  });
});

describe("proposeSemantics", () => {
  it("parses strict JSON", async () => {
    const call = async () => ({ text: `{"pages":[{"id":"drain","kind":"service"}],"slots":[{"id":"s1","semantic":"headline"}]}` });
    const { proposal, diagnostics } = await proposeSemantics(tpl(), call);
    expect(proposal.pages).toEqual([{ id: "drain", kind: "service" }]);
    expect(diagnostics).toEqual([]);
  });
  it("unparseable → empty proposal + warn", async () => {
    const call = async () => ({ text: "nah" });
    const { proposal, diagnostics } = await proposeSemantics(tpl(), call);
    expect(proposal).toEqual({ pages: [], slots: [] });
    expect(diagnostics.some((d) => d.code === "ai_semantics_unparseable")).toBe(true);
  });
  it("SEMANTIC_LABELS is the closed vocabulary", () => {
    expect(SEMANTIC_LABELS).toContain("headline");
    expect(SEMANTIC_LABELS).toContain("cta");
  });
});
