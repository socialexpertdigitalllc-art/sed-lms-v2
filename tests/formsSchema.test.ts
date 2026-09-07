// @vitest-environment node
import { describe, it, expect } from "vitest";
import { endpointInputSchema, endpointPatchSchema, generateAccessKey } from "@/lib/forms/schema";

describe("endpointInputSchema", () => {
  it("applies defaults and normalises origins", () => {
    const r = endpointInputSchema.parse({ name: " Acme ", to_emails: ["a@b.co"], allowed_origins: [" Acme.COM ", "*.foo.com"] });
    expect(r.name).toBe("Acme");
    expect(r.allowed_origins).toEqual(["acme.com", "*.foo.com"]);
    expect(r.daily_limit).toBe(200);
    expect(r.status).toBe("active");
    expect(r.lead_id).toBeNull();
  });
  it("requires at least one valid recipient", () => {
    expect(endpointInputSchema.safeParse({ name: "x", to_emails: [] }).success).toBe(false);
    expect(endpointInputSchema.safeParse({ name: "x", to_emails: ["nope"] }).success).toBe(false);
  });
  it("rejects a bad origin and a non-http redirect", () => {
    expect(endpointInputSchema.safeParse({ name: "x", to_emails: ["a@b.co"], allowed_origins: ["http://x.com"] }).success).toBe(false);
    expect(endpointInputSchema.safeParse({ name: "x", to_emails: ["a@b.co"], success_redirect_url: "ftp://x" }).success).toBe(false);
  });
  it("patch is partial", () => {
    expect(endpointPatchSchema.parse({ status: "paused" })).toEqual({ status: "paused" });
  });
});

describe("generateAccessKey", () => {
  it("is 32 url-safe chars and unique", () => {
    const a = generateAccessKey(); const b = generateAccessKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });
});
