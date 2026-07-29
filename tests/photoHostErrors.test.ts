// @vitest-environment node
import { describe, it, expect } from "vitest";
import { classifyUploadError } from "@/lib/photo-capture/hosts/errors";

describe("classifyUploadError", () => {
  it("treats 429 as a quota problem", () => {
    expect(classifyUploadError({ status: 429 })).toBe("quota");
  });

  it("treats an imgchest X-RateLimit-Remaining of 0 as quota, whatever the status", () => {
    expect(classifyUploadError({ status: 200, rateLimitRemaining: "0" })).toBe("quota");
  });

  it("does not treat remaining headroom as quota", () => {
    expect(classifyUploadError({ status: 500, rateLimitRemaining: "42" })).toBe("error");
  });

  it("treats 401 as an auth problem", () => {
    expect(classifyUploadError({ status: 401 })).toBe("auth");
  });

  it("does not let a WAF-style 403 disable the host", () => {
    expect(classifyUploadError({ status: 403, message: "Access Forbidden" })).toBe("error");
  });

  it("still recognizes imgbb's and imgchest's real bad-credential shapes", () => {
    expect(classifyUploadError({ status: 400, message: "Invalid API key" })).toBe("auth");
    expect(classifyUploadError({ status: 401 })).toBe("auth");
    expect(classifyUploadError({ status: 400, message: "Unauthenticated." })).toBe("auth");
  });

  it("reads a quota verdict out of the message when the status does not say so", () => {
    expect(classifyUploadError({ status: 400, message: "Rate limit exceeded" })).toBe("quota");
    expect(classifyUploadError({ status: 400, message: "Too many requests, slow down" })).toBe("quota");
    expect(classifyUploadError({ status: 400, message: "Daily quota reached" })).toBe("quota");
  });

  it("reads an auth verdict out of the message", () => {
    expect(classifyUploadError({ status: 400, message: "Invalid API key" })).toBe("auth");
    expect(classifyUploadError({ status: 400, message: "invalid token" })).toBe("auth");
  });

  it("falls back to a plain error for anything else", () => {
    expect(classifyUploadError({ status: 500, message: "Internal Server Error" })).toBe("error");
    expect(classifyUploadError({ status: 0, message: "network down" })).toBe("error");
    expect(classifyUploadError({ status: 400 })).toBe("error");
  });

  it("does not mistake a file-size error for a quota error", () => {
    expect(classifyUploadError({ status: 400, message: "maximum file size exceeded" })).toBe("error");
  });

  it("still classifies genuine exceeded-limit phrasings as quota", () => {
    expect(classifyUploadError({ status: 400, message: "quota exceeded" })).toBe("quota");
    expect(classifyUploadError({ status: 400, message: "API limit exceeded" })).toBe("quota");
  });

  it("matches the 'limit reached' alternative on its own", () => {
    expect(classifyUploadError({ status: 400, message: "monthly limit reached" })).toBe("quota");
  });

  it("matches the 'invalid key' alternative on its own", () => {
    expect(classifyUploadError({ status: 400, message: "invalid key" })).toBe("auth");
  });
});
