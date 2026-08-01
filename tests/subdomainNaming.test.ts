import { describe, it, expect } from "vitest";
import {
  baseSubdomain,
  parseVersion,
  versionedSubdomain,
  nextVersionSubdomain,
  firstFreeVersion,
} from "@/lib/site-studio/deploy/naming";

describe("baseSubdomain", () => {
  it("uses the first two words, slugified", () => {
    expect(baseSubdomain("Joes Plumbing Services LLC")).toBe("joes-plumbing");
  });
  it("caps the base at 20 chars without trailing hyphen", () => {
    expect(baseSubdomain("Extraordinary Refrigeration Co").length).toBeLessThanOrEqual(20);
    expect(baseSubdomain("Extraordinary Refrigeration Co")).toBe("extraordinary-refrig");
    expect(baseSubdomain("Superlongfirstwordxx B")).not.toMatch(/-$/);
  });
  it("strips accents and punctuation", () => {
    expect(baseSubdomain("Café João's")).toBe("cafe-joao-s");
  });
  it("handles single-word names", () => {
    expect(baseSubdomain("Acme")).toBe("acme");
  });
  it("falls back to 'site' for empty input", () => {
    expect(baseSubdomain("  ")).toBe("site");
    expect(baseSubdomain("!!!")).toBe("site");
  });
});

describe("parseVersion / versionedSubdomain", () => {
  it("round-trips a versioned name", () => {
    expect(versionedSubdomain("joes-plumbing", 1)).toBe("joes-plumbingv1");
    expect(parseVersion("joes-plumbingv1")).toEqual({ base: "joes-plumbing", version: 1 });
    expect(parseVersion("joes-plumbingv12")).toEqual({ base: "joes-plumbing", version: 12 });
  });
  it("treats unversioned names as version 1", () => {
    expect(parseVersion("joes-plumbing")).toEqual({ base: "joes-plumbing", version: 1 });
  });
  it("does not misparse digit-ending bases", () => {
    // "site2" has no "v" separator; "grav1ty" base ends with non-digit before v? ensure guard
    expect(parseVersion("site2")).toEqual({ base: "site2", version: 1 });
    expect(parseVersion("v2")).toEqual({ base: "v2", version: 1 });
  });
});

describe("nextVersionSubdomain", () => {
  it("bumps an existing version", () => {
    expect(nextVersionSubdomain("joes-plumbingv1")).toBe("joes-plumbingv2");
    expect(nextVersionSubdomain("joes-plumbingv9")).toBe("joes-plumbingv10");
  });
  it("starts at v2 for unversioned names", () => {
    expect(nextVersionSubdomain("joes-plumbing")).toBe("joes-plumbingv2");
  });
});

describe("firstFreeVersion", () => {
  it("returns the first version whose name is free", async () => {
    const taken = new Set(["joes-plumbingv1", "joes-plumbingv2"]);
    const sub = await firstFreeVersion("joes-plumbing", async (s) => taken.has(s));
    expect(sub).toBe("joes-plumbingv3");
  });
  it("returns v1 immediately when free", async () => {
    const sub = await firstFreeVersion("acme", async () => false);
    expect(sub).toBe("acmev1");
  });
  it("can skip a specific name (the current subdomain during shuffle)", async () => {
    const sub = await firstFreeVersion("acme", async () => false, { skip: "acmev1" });
    expect(sub).toBe("acmev2");
  });
});
