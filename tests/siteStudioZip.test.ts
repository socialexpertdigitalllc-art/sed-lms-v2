import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { unzipToMap, zipFromMap } from "@/lib/site-studio/zip";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("unzipToMap", () => {
  it("normalizes and strips a single shared root folder", () => {
    const z = zipSync({ "my-template/index.html": enc("<html>"), "my-template/css/a.css": enc("x") });
    const map = unzipToMap(z);
    expect(Object.keys(map).sort()).toEqual(["css/a.css", "index.html"]);
  });
  it("keeps paths when roots differ", () => {
    const z = zipSync({ "index.html": enc("a"), "css/a.css": enc("b") });
    expect(Object.keys(unzipToMap(z)).sort()).toEqual(["css/a.css", "index.html"]);
  });
  it("rejects zip-slip paths", () => {
    const z = zipSync({ "../evil.txt": enc("x") });
    expect(() => unzipToMap(z)).toThrow(/Unsafe path/);
  });
  it("round-trips through zipFromMap", () => {
    const files = { "index.html": enc("<h1>hi</h1>") };
    expect(dec(unzipToMap(zipFromMap(files))["index.html"])).toBe("<h1>hi</h1>");
  });
  it("rejects Windows drive-letter absolute paths", () => {
    const z = zipSync({ "C:/Windows/evil.txt": enc("x") });
    expect(() => unzipToMap(z)).toThrow(/Unsafe path/);
  });
  it("rejects duplicate normalized paths", () => {
    const z = zipSync({ "index.html": enc("a"), "./index.html": enc("b") });
    expect(() => unzipToMap(z)).toThrow(/Duplicate path/);
  });
  it("returns an empty map for a zero-entry zip", () => {
    expect(unzipToMap(zipFromMap({}))).toEqual({});
  });
});
