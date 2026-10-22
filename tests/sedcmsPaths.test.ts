// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MAX_FILE_BYTES, cmsPathAllowed, isTextPath } from "@/lib/sedcms/paths";

/**
 * The path rules the CMS and the LMS share (launch plan, "The CMS <-> LMS
 * contract"): the same rules and the same vectors as @sedcms/static's
 * safePath, from one fixture file both repositories copy.
 */

const shared = JSON.parse(readFileSync("tests/fixtures/sedcms/shared-vectors.json", "utf8")) as {
  paths: {
    maxFileBytes: number;
    allowed: string[];
    refused: string[];
    refusedWithChar: { text: string; char: number; why: string }[];
  };
};

describe("cmsPathAllowed, against the shared vectors", () => {
  it.each(shared.paths.allowed.map((p) => [p.length > 60 ? `${p.slice(0, 60)}… (${p.length} chars)` : p, p]))("allows %s", (_label, p) => {
    expect(cmsPathAllowed(p)).toBe(true);
  });

  it.each(shared.paths.refused.map((p) => [JSON.stringify(p.length > 60 ? `${p.slice(0, 60)}…` : p), p]))("refuses %s", (_label, p) => {
    expect(cmsPathAllowed(p)).toBe(false);
  });

  it.each(shared.paths.refusedWithChar.map((v) => [v.why, v]))("refuses a path with a %s in it", (_why, v) => {
    const path = v.text.split("{}").join(String.fromCharCode(v.char));
    expect(path).not.toContain("{}");
    expect(cmsPathAllowed(path)).toBe(false);
  });

  it("uses the shared per-file limit", () => {
    expect(MAX_FILE_BYTES).toBe(shared.paths.maxFileBytes);
    expect(MAX_FILE_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("cmsPathAllowed, beyond the vectors", () => {
  it("refuses anything that isn't a string", () => {
    for (const v of [null, undefined, 1, {}, ["index.html"], new String("index.html")]) expect(cmsPathAllowed(v)).toBe(false);
  });

  it("refuses every server-side type hidden as a middle extension, in any case", () => {
    for (const ext of ["php", "php3", "php4", "php5", "php7", "php8", "phtml", "pht", "phar", "phps", "cgi", "fcgi", "pl", "py", "sh", "asp", "aspx", "jsp", "shtml", "shtm", "htaccess", "htpasswd", "ini"]) {
      expect(cmsPathAllowed(`page.${ext}.html`)).toBe(false);
      expect(cmsPathAllowed(`page.${ext.toUpperCase()}.html`)).toBe(false);
      expect(cmsPathAllowed(`dir.${ext}/page.html`)).toBe(false);
    }
  });

  it("allows every listed extension, lowercase only", () => {
    for (const ext of ["html", "htm", "js", "css", "json", "xml", "txt", "webmanifest", "jpg", "jpeg", "png", "webp"]) {
      expect(cmsPathAllowed(`a/file.${ext}`)).toBe(true);
      expect(cmsPathAllowed(`a/file.${ext.toUpperCase()}`)).toBe(false);
    }
  });
});

describe("isTextPath", () => {
  it("is the text extensions live-files carries the text of", () => {
    for (const p of ["index.html", "a.htm", "a.js", "a.css", "a.json", "a.xml", "a.txt", "site.webmanifest"]) expect(isTextPath(p)).toBe(true);
    for (const p of ["a.jpg", "a.jpeg", "a.png", "a.webp", "a.svg", "a.HTML", "html", "a.html.zip"]) expect(isTextPath(p)).toBe(false);
  });
});
