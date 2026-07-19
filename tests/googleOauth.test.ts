// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { buildAuthUrl, GOOGLE_SCOPES } from "@/lib/google/oauth";

describe("buildAuthUrl", () => {
  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-123.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://app.test/api/admin/google/callback";
  });

  it("targets Google's consent endpoint", () => {
    expect(buildAuthUrl("st8")).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
  });

  it("requests offline access with forced consent so a refresh token is always returned", () => {
    const url = new URL(buildAuthUrl("st8"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("carries the client id, redirect uri, state, and Drive+Docs scopes", () => {
    const url = new URL(buildAuthUrl("st8"));
    expect(url.searchParams.get("client_id")).toBe("client-123.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/api/admin/google/callback");
    expect(url.searchParams.get("state")).toBe("st8");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_SCOPES);
    expect(GOOGLE_SCOPES).toContain("https://www.googleapis.com/auth/drive");
    expect(GOOGLE_SCOPES).toContain("https://www.googleapis.com/auth/documents");
  });
});
