import { describe, it, expect } from "vitest";
import { buildClientErrorReport } from "@/lib/errors/report";

/** The error boundaries' report: bounded fields, digest kept, nothing thrown on odd input. */
describe("buildClientErrorReport", () => {
  it("captures the essentials with the digest", () => {
    const err = Object.assign(new Error("boom"), { digest: "abc123" });
    const r = buildClientErrorReport(err, "page", { url: "https://x/dashboard", userAgent: "UA", buildId: "b1" });
    expect(r).toMatchObject({ scope: "page", name: "Error", message: "boom", digest: "abc123", url: "https://x/dashboard", userAgent: "UA", buildId: "b1" });
    expect(r.stack).toContain("boom");
  });
  it("bounds every field", () => {
    const err = new Error("m".repeat(5000));
    err.stack = "s".repeat(10000);
    const r = buildClientErrorReport(err, "root", { url: "u".repeat(2000), userAgent: "a".repeat(1000) });
    expect(r.message.length).toBe(1000);
    expect(r.stack?.length).toBe(4000);
    expect(r.url.length).toBe(500);
    expect(r.userAgent.length).toBe(300);
    expect(r.digest).toBeUndefined();
  });
  it("survives a non-Error value", () => {
    const r = buildClientErrorReport({} as Error, "page", { url: "", userAgent: "" });
    expect(r.name).toBe("Error");
    expect(r.message).toBe("");
  });
});
