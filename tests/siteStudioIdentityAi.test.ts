import { describe, it, expect } from "vitest";
import { proposeIdentityAdditions, identityCorpus } from "@/lib/site-studio/compiler/ai/identityAi";
import type { CompiledTemplate } from "@/lib/site-studio/schema";

const tpl: CompiledTemplate = {
  manifest: {
    engine: 3, name: "t", version: 1,
    identity: { business_name: "Demo Co" },
    theme: { mode: "none", roles: {} },
    nav: [],
    pages: [{
      id: "index", file: "index.html", kind: "home", stampable: false,
      title_sample: "Demo Co",
      slots: [{ id: "s1", type: "text", sample: "Founded by John Carpenter at 42 Elm Street.", html: false, max_chars: 80 }],
      repeats: [],
    }],
  },
  pages: {}, fragments: {}, assets: {},
};

describe("identityCorpus", () => {
  it("collects samples and existing identity, capped", () => {
    const c = identityCorpus(tpl);
    expect(c).toContain("John Carpenter");
    expect(c).toContain("Demo Co");
    expect(c.length).toBeLessThanOrEqual(8000);
  });
});

describe("proposeIdentityAdditions", () => {
  it("parses a strict-JSON reply into additions", async () => {
    const call = async () => ({ text: `{"additions":[{"key":"owner_name","value":"John Carpenter"},{"key":"street","value":"42 Elm Street"}]}` });
    const { additions, diagnostics } = await proposeIdentityAdditions(tpl, call);
    expect(additions).toEqual([
      { key: "owner_name", value: "John Carpenter" },
      { key: "street", value: "42 Elm Street" },
    ]);
    expect(diagnostics).toEqual([]);
  });
  it("tolerates fenced JSON and junk around it", async () => {
    const call = async () => ({ text: "Sure! ```json\n{\"additions\":[{\"key\":\"owner_name\",\"value\":\"John Carpenter\"}]}\n```" });
    const { additions } = await proposeIdentityAdditions(tpl, call);
    expect(additions).toHaveLength(1);
  });
  it("unparseable reply → empty additions + warn diagnostic, never a throw", async () => {
    const call = async () => ({ text: "I could not find anything." });
    const { additions, diagnostics } = await proposeIdentityAdditions(tpl, call);
    expect(additions).toEqual([]);
    expect(diagnostics.some((d) => d.code === "ai_identity_unparseable" && d.level === "warn")).toBe(true);
  });
  it("caps at 20 and drops malformed entries", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ key: `k_${i}`, value: `Value Number ${i}` }));
    const call = async () => ({ text: JSON.stringify({ additions: [...many, { key: 5 }, "junk"] }) });
    const { additions } = await proposeIdentityAdditions(tpl, call);
    expect(additions).toHaveLength(20);
  });
});
