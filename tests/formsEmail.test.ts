// tests/formsEmail.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveSubject, buildFormEmail, escapeHtml, previewLine } from "@/lib/forms/email";

describe("resolveSubject", () => {
  it("prefers the request subject, then the template, then the default", () => {
    expect(resolveSubject("Quote please", "Form: {site}", { site: "Acme", name: "Ann" })).toBe("Quote please");
    expect(resolveSubject("", "{site} — {name}", { site: "Acme", name: "Ann" })).toBe("Acme — Ann");
    expect(resolveSubject("", "{site} — {name}", { site: "Acme", name: null })).toBe("Acme — a visitor");
    expect(resolveSubject("  ", "", { site: "Acme", name: null })).toBe("New form submission from Acme");
  });
  it("caps length", () => {
    expect(resolveSubject("x".repeat(500), "", { site: "A", name: null }).length).toBe(200);
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});

describe("buildFormEmail", () => {
  const msg = buildFormEmail({
    endpointName: "Acme Roofing",
    subject: "New lead",
    payload: [{ key: "name", value: "Ann <b>" }, { key: "message", value: "line1\nline2" }],
    origin: "acme.com",
    createdAt: "2026-09-05T10:00:00.000Z",
  });
  it("carries the subject and a text twin", () => {
    expect(msg.subject).toBe("New lead");
    expect(msg.text).toContain("name: Ann <b>");
    expect(msg.text).toContain("message: line1\nline2");
    expect(msg.text).toContain("acme.com");
  });
  it("escapes HTML and preserves line breaks", () => {
    expect(msg.html).toContain("Ann &lt;b&gt;");
    expect(msg.html).toContain("line1<br>line2");
    expect(msg.html).toContain("Acme Roofing");
    expect(msg.html).toContain("SED LMS Form Relay");
  });
});

describe("buildFormEmail hardening", () => {
  it("does not throw on a malformed createdAt", () => {
    const msg = buildFormEmail({ endpointName: "A", subject: "s", payload: [], origin: "x.com", createdAt: "garbage" });
    expect(msg.text).toContain("unknown time");
  });
  it("strips CRLF from the subject (header injection)", () => {
    const msg = buildFormEmail({ endpointName: "A", subject: "Hi\r\nBcc: evil@x.co", payload: [], origin: "x.com", createdAt: "2026-09-05T10:00:00Z" });
    expect(msg.subject).toBe("Hi Bcc: evil@x.co");
  });
  it("renders the empty-payload branch and escapes a hostile origin", () => {
    const msg = buildFormEmail({ endpointName: "A", subject: "s", payload: [], origin: "<script>x</script>", createdAt: "2026-09-05T10:00:00Z" });
    expect(msg.html).toContain("No fields were submitted.");
    expect(msg.html).not.toContain("<script>");
    expect(msg.html).toContain("&lt;script&gt;");
  });
});

describe("previewLine", () => {
  it("prefers message-like fields and truncates", () => {
    expect(previewLine([{ key: "name", value: "Ann" }, { key: "message", value: "x".repeat(200) }])).toBe("x".repeat(140) + "…");
    expect(previewLine([{ key: "name", value: "Ann" }])).toBe("Ann");
    expect(previewLine([])).toBe("");
  });
});
