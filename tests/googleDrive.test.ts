import { describe, it, expect } from "vitest";
import { normalizeFolderId } from "@/lib/google/drive";

describe("normalizeFolderId", () => {
  it("passes a bare folder id through", () => {
    expect(normalizeFolderId("1kbwMdFSPUBihsyAun8C3dIKOJ2w9woH_")).toBe("1kbwMdFSPUBihsyAun8C3dIKOJ2w9woH_");
  });

  it("extracts the id from a pasted Drive folder URL", () => {
    expect(normalizeFolderId("https://drive.google.com/drive/folders/1kbwMdFSPUBihsyAun8C3dIKOJ2w9woH_?usp=sharing"))
      .toBe("1kbwMdFSPUBihsyAun8C3dIKOJ2w9woH_");
    expect(normalizeFolderId("https://drive.google.com/drive/u/0/folders/ABC-123_xyz"))
      .toBe("ABC-123_xyz");
  });

  it("extracts the id from an ?id= style URL", () => {
    expect(normalizeFolderId("https://drive.google.com/open?id=ABC-123_xyz")).toBe("ABC-123_xyz");
  });

  it("trims whitespace and strips a trailing query/slash", () => {
    expect(normalizeFolderId("  ABC123  ")).toBe("ABC123");
    expect(normalizeFolderId("ABC123?usp=drive_link")).toBe("ABC123");
    expect(normalizeFolderId("ABC123/")).toBe("ABC123");
  });

  it("returns empty for empty input", () => {
    expect(normalizeFolderId("")).toBe("");
    expect(normalizeFolderId("   ")).toBe("");
  });
});
