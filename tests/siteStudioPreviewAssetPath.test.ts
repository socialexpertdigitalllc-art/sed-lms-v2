import { describe, it, expect } from "vitest";
import { isSafeAssetPath } from "@/lib/site-studio/preview/assetPath";

describe("isSafeAssetPath", () => {
  it("accepts plain relative paths", () => {
    expect(isSafeAssetPath("css/style.css")).toBe(true);
    expect(isSafeAssetPath("img/a.jpg")).toBe(true);
    expect(isSafeAssetPath("index.html")).toBe(true);
    expect(isSafeAssetPath("services/sewer.html")).toBe(true);
  });

  it("rejects empty input", () => {
    expect(isSafeAssetPath("")).toBe(false);
  });

  it("rejects any path containing ..", () => {
    expect(isSafeAssetPath("../../etc/passwd")).toBe(false);
    expect(isSafeAssetPath("css/../../../etc/passwd")).toBe(false);
    expect(isSafeAssetPath("..")).toBe(false);
    expect(isSafeAssetPath("a/../b")).toBe(false);
  });

  it("rejects a leading slash (absolute path)", () => {
    expect(isSafeAssetPath("/etc/passwd")).toBe(false);
    expect(isSafeAssetPath("/css/style.css")).toBe(false);
  });

  it("rejects a backslash (Windows-style separator)", () => {
    expect(isSafeAssetPath("..\\..\\windows\\win.ini")).toBe(false);
    expect(isSafeAssetPath("css\\style.css")).toBe(false);
  });

  it("rejects a scheme-qualified reference", () => {
    expect(isSafeAssetPath("file:///etc/passwd")).toBe(false);
    expect(isSafeAssetPath("http://evil.example/x")).toBe(false);
    expect(isSafeAssetPath("javascript:alert(1)")).toBe(false);
    expect(isSafeAssetPath("asset:some-uuid")).toBe(false);
  });
});
