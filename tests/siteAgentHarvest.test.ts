// tests/siteAgentHarvest.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { harvestChanges } from "@/lib/site-agent/harvest";
import { MAX_CHANGED_FILES } from "@/lib/site-agent/types";

const enc = (s: string) => new TextEncoder().encode(s);
const site = () => ({
  "index.html": enc("<html>home (555) 123-4567</html>"),
  "about.html": enc("<html>about</html>"),
  "css/styles.css": enc("body{}"),
});

describe("harvestChanges", () => {
  it("classifies edits, creates, and deletes; untouched files carry no entry", () => {
    const edited = {
      "index.html": enc("<html>home (555) 987-6543</html>"), // edit
      "css/styles.css": enc("body{}"),                        // unchanged
      "contact.html": enc("<html>new page</html>"),           // create
      // about.html gone                                       // delete
    };
    const out = harvestChanges(site(), edited);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.changes).toEqual({
      "index.html": { action: "edit", bytes: edited["index.html"].byteLength },
      "contact.html": { action: "create", bytes: edited["contact.html"].byteLength },
      "about.html": { action: "delete", bytes: 0 },
    });
    // The result map is the FULL deployable site (edits applied, deletes gone).
    expect(Object.keys(out.resultMap).sort()).toEqual(["contact.html", "css/styles.css", "index.html"]);
  });

  it("no changes at all is a refusal — nothing to review", () => {
    const out = harvestChanges(site(), site());
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/no changes/i) });
  });

  it("refuses when index.html was deleted", () => {
    const edited = { "about.html": enc("x"), "css/styles.css": enc("body{}") };
    const out = harvestChanges(site(), edited);
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/index\.html/i) });
  });

  it("refuses path escapes and absolute paths in the edited map", () => {
    for (const bad of ["../evil.html", "a/../../evil", "C:/x", "/etc/passwd", "a\\..\\b"]) {
      const out = harvestChanges(site(), { ...site(), [bad]: enc("x") });
      expect(out.ok, bad).toBe(false);
    }
  });

  it("enforces the changed-file count cap", () => {
    const edited: Record<string, Uint8Array> = { ...site() };
    for (let i = 0; i < MAX_CHANGED_FILES + 1; i++) edited[`gen/${i}.html`] = enc("x");
    const out = harvestChanges(site(), edited);
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/too many/i) });
  });

  it("enforces the per-file size cap", () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    const out = harvestChanges(site(), { ...site(), "big.bin": big });
    expect(out).toMatchObject({ ok: false, error: expect.stringMatching(/too large/i) });
  });
});
