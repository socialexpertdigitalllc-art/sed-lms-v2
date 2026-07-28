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

  it("treats 401 and 403 as auth problems", () => {
    expect(classifyUploadError({ status: 401 })).toBe("auth");
    expect(classifyUploadError({ status: 403 })).toBe("auth");
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
});
