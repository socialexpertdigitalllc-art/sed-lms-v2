import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SOPS, loadSop } from "@/lib/site-studio/sops";

describe("SOPS", () => {
  it("declares the three documents in order", () => {
    expect(SOPS.map((s) => s.slug)).toEqual([
      "01-adding-a-template",
      "02-generating-a-website",
      "03-troubleshooting",
    ]);
  });

  it("every declared SOP file exists on disk", () => {
    for (const entry of SOPS) {
      expect(existsSync(join(process.cwd(), entry.path)), `${entry.path} is missing`).toBe(true);
    }
  });

  it("every entry has a non-empty title and a path under docs/sops/site-studio/", () => {
    for (const entry of SOPS) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.path.startsWith("docs/sops/site-studio/")).toBe(true);
    }
  });
});

describe("loadSop", () => {
  it("loads a known slug's title and markdown from disk", async () => {
    const result = await loadSop("01-adding-a-template");
    expect(result).not.toBeNull();
    expect(result!.title).toBe(SOPS[0].title);
    expect(result!.markdown).toContain("SOP 01");
    expect(result!.markdown.length).toBeGreaterThan(0);
  });

  it("loads each of the three declared slugs successfully", async () => {
    for (const entry of SOPS) {
      const result = await loadSop(entry.slug);
      expect(result).not.toBeNull();
      expect(result!.title).toBe(entry.title);
    }
  });

  it("returns null for an unknown slug, never throws", async () => {
    await expect(loadSop("not-a-real-sop")).resolves.toBeNull();
    await expect(loadSop("")).resolves.toBeNull();
  });

  it("rejects a slug containing .. without touching the filesystem", async () => {
    await expect(loadSop("../../../etc/passwd")).resolves.toBeNull();
    await expect(loadSop("..")).resolves.toBeNull();
    await expect(loadSop("01-adding-a-template/../../../etc/passwd")).resolves.toBeNull();
  });

  it("rejects a slug containing a forward slash", async () => {
    await expect(loadSop("site-studio/01-adding-a-template")).resolves.toBeNull();
    await expect(loadSop("/etc/passwd")).resolves.toBeNull();
  });

  it("rejects a slug containing a backslash", async () => {
    await expect(loadSop("..\\..\\windows\\win.ini")).resolves.toBeNull();
    await expect(loadSop("01-adding-a-template\\evil")).resolves.toBeNull();
  });

  it("never throws for hostile input", async () => {
    const hostile = ["null", "undefined", "0", "../../../../../../etc/passwd", "\0", "a".repeat(10000)];
    for (const slug of hostile) {
      await expect(loadSop(slug)).resolves.not.toThrow;
      const result = await loadSop(slug);
      expect(result).toBeNull();
    }
  });
});
