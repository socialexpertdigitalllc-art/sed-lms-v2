// tests/formsSnippet.test.ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { relaySubmitUrl, htmlSnippet, jsSnippet } from "@/lib/forms/snippet";

const saved = process.env.FORM_RELAY_PUBLIC_URL;
afterEach(() => { if (saved === undefined) delete process.env.FORM_RELAY_PUBLIC_URL; else process.env.FORM_RELAY_PUBLIC_URL = saved; });

describe("relaySubmitUrl", () => {
  it("defaults to production and honours the env override", () => {
    delete process.env.FORM_RELAY_PUBLIC_URL;
    expect(relaySubmitUrl()).toBe("https://lms.sedsolutions.online/api/forms/submit");
    process.env.FORM_RELAY_PUBLIC_URL = "http://localhost:3000/api/forms/submit";
    expect(relaySubmitUrl()).toBe("http://localhost:3000/api/forms/submit");
  });
});

describe("snippets", () => {
  it("html snippet carries the url, key and honeypot", () => {
    const s = htmlSnippet({ url: "https://x/api/forms/submit", accessKey: "KEY1" });
    expect(s).toContain('action="https://x/api/forms/submit"');
    expect(s).toContain('name="access_key" value="KEY1"');
    expect(s).toContain('name="botcheck"');
  });
  it("js snippet posts JSON with the key and retries once", () => {
    const s = jsSnippet({ url: "https://x/api/forms/submit", accessKey: "KEY1" });
    expect(s).toContain('access_key: "KEY1"');
    expect(s).toContain("https://x/api/forms/submit");
    expect(s).toContain("retry");
  });
});
