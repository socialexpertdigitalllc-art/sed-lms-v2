// @vitest-environment node
import { describe, it, expect } from "vitest";
import { splitPagesAndAssets } from "@/lib/site-builder/templates";

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);

describe("splitPagesAndAssets", () => {
  it("classifies .html entries as pages and everything else as assets", () => {
    const files: Record<string, Uint8Array> = {
      "index.html": bytes("<html></html>"),
      "about.html": bytes("<html></html>"),
      "css/style.css": bytes("body{}"),
      "js/app.js": bytes("console.log(1)"),
      "img/hero.jpg": bytes("binary"),
      "fonts/font.woff2": bytes("binary"),
    };
    const { pageFiles, assetFiles } = splitPagesAndAssets(files);
    expect(pageFiles).toEqual(["about.html", "index.html"]);
    expect(assetFiles).toEqual(["css/style.css", "fonts/font.woff2", "img/hero.jpg", "js/app.js"]);
  });

  it("is case-insensitive on the .html/.htm extension", () => {
    const files: Record<string, Uint8Array> = {
      "INDEX.HTML": bytes("<html></html>"),
      "about.HTM": bytes("<html></html>"),
      "readme.TXT": bytes("notes"),
    };
    const { pageFiles, assetFiles } = splitPagesAndAssets(files);
    expect(pageFiles).toEqual(["INDEX.HTML", "about.HTM"]);
    expect(assetFiles).toEqual(["readme.TXT"]);
  });

  it("does not inspect page content at all — a page with no markup is still a page", () => {
    const files: Record<string, Uint8Array> = { "blank.html": bytes("") };
    const { pageFiles, assetFiles } = splitPagesAndAssets(files);
    expect(pageFiles).toEqual(["blank.html"]);
    expect(assetFiles).toEqual([]);
  });

  it("handles nested page paths the same as top-level ones", () => {
    const files: Record<string, Uint8Array> = {
      "services/plumbing.html": bytes("<html></html>"),
      "img/services/plumbing.jpg": bytes("binary"),
    };
    const { pageFiles, assetFiles } = splitPagesAndAssets(files);
    expect(pageFiles).toEqual(["services/plumbing.html"]);
    expect(assetFiles).toEqual(["img/services/plumbing.jpg"]);
  });

  it("returns empty lists for an empty file map", () => {
    expect(splitPagesAndAssets({})).toEqual({ pageFiles: [], assetFiles: [] });
  });
});
