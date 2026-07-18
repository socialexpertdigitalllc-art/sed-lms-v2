import { describe, it, expect } from "vitest";
import { resolveSignature } from "@/lib/contracts/signature";
import { signatureSchema } from "@/lib/contracts/schema";

describe("resolveSignature", () => {
  it("prefers the uploaded image when present", () => {
    expect(resolveSignature({ signature_image_path: "u1/sig.png", typed_name: "Jordan" }))
      .toEqual({ kind: "image", path: "u1/sig.png" });
  });
  it("falls back to a typed name when there is no image", () => {
    expect(resolveSignature({ signature_image_path: null, typed_name: "Jordan" }))
      .toEqual({ kind: "typed", name: "Jordan" });
  });
  it("trims the typed name", () => {
    expect(resolveSignature({ signature_image_path: null, typed_name: "  Jordan  " }))
      .toEqual({ kind: "typed", name: "Jordan" });
  });
  it("returns none when both are empty or the row is missing", () => {
    expect(resolveSignature({ signature_image_path: null, typed_name: "   " })).toEqual({ kind: "none" });
    expect(resolveSignature(null)).toEqual({ kind: "none" });
  });
});

describe("signatureSchema", () => {
  it("accepts a typed name or null", () => {
    expect(signatureSchema.safeParse({ typed_name: "Jordan" }).success).toBe(true);
    expect(signatureSchema.safeParse({ typed_name: null }).success).toBe(true);
    expect(signatureSchema.safeParse({}).success).toBe(true);
  });
});
