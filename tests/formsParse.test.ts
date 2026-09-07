// tests/formsParse.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fieldsToSubmission, parseSubmissionRequest, extractSubmitter, isEmailAddress, LIMITS } from "@/lib/forms/parse";

describe("fieldsToSubmission", () => {
  it("splits reserved fields from payload and keeps order", () => {
    const r = fieldsToSubmission([
      ["access_key", "k1"], ["name", "Ann"], ["subject", "Hi"], ["message", "Hello"], ["botcheck", ""],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reserved.access_key).toBe("k1");
    expect(r.value.reserved.subject).toBe("Hi");
    expect(r.value.reserved.botcheck).toBe("");
    expect(r.value.payload).toEqual([{ key: "name", value: "Ann" }, { key: "message", value: "Hello" }]);
  });

  it("rejects a missing access_key", () => {
    const r = fieldsToSubmission([["name", "Ann"]]);
    expect(r).toEqual({ ok: false, status: 400, message: "access_key is required" });
  });

  it("rejects too many fields", () => {
    const entries: [string, string][] = [["access_key", "k"]];
    for (let i = 0; i < LIMITS.fields + 1; i++) entries.push([`f${i}`, "x"]);
    const r = fieldsToSubmission(entries);
    expect(r).toEqual({ ok: false, status: 400, message: "Payload too large" });
  });

  it("rejects an oversize value", () => {
    const r = fieldsToSubmission([["access_key", "k"], ["msg", "x".repeat(LIMITS.valueChars + 1)]]);
    expect(r.ok).toBe(false);
  });
});

describe("parseSubmissionRequest", () => {
  it("parses JSON, stringifying non-string values", async () => {
    const req = new Request("http://t/x", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_key: "k", name: "Ann", age: 3, ok: true, tags: ["a", "b"] }),
    });
    const r = await parseSubmissionRequest(req);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.payload).toEqual([
      { key: "name", value: "Ann" }, { key: "age", value: "3" }, { key: "ok", value: "true" }, { key: "tags", value: "a, b" },
    ]);
  });

  it("parses urlencoded bodies", async () => {
    const req = new Request("http://t/x", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "access_key=k&email=a%40b.co&message=hi",
    });
    const r = await parseSubmissionRequest(req);
    expect(r.ok && r.value.payload[0]).toEqual({ key: "email", value: "a@b.co" });
  });

  it("parses multipart FormData and drops files", async () => {
    const fd = new FormData();
    fd.append("access_key", "k");
    fd.append("name", "Ann");
    fd.append("cv", new Blob(["pdf"]), "cv.pdf");
    const req = new Request("http://t/x", { method: "POST", body: fd });
    const r = await parseSubmissionRequest(req);
    expect(r.ok && r.value.payload).toEqual([{ key: "name", value: "Ann" }]);
  });

  it("rejects invalid JSON", async () => {
    const req = new Request("http://t/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    const r = await parseSubmissionRequest(req);
    expect(r).toEqual({ ok: false, status: 400, message: "Invalid request body" });
  });

  it("rejects a body over the byte cap", async () => {
    const req = new Request("http://t/x", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_key: "k", message: "x".repeat(LIMITS.bodyBytes) }),
    });
    const r = await parseSubmissionRequest(req);
    expect(r).toEqual({ ok: false, status: 400, message: "Payload too large" });
  });
});

describe("extractSubmitter", () => {
  it("finds name and email from common field names", () => {
    const s = extractSubmitter([{ key: "full_name", value: "Ann Lee" }, { key: "Email", value: " ann@x.co " }], { replyto: "", from_name: "" });
    expect(s).toEqual({ name: "Ann Lee", email: "ann@x.co" });
  });
  it("joins first + last name and prefers replyto", () => {
    const s = extractSubmitter([{ key: "first_name", value: "Ann" }, { key: "last_name", value: "Lee" }, { key: "email", value: "a@b.co" }], { replyto: "r@b.co", from_name: "" });
    expect(s).toEqual({ name: "Ann Lee", email: "r@b.co" });
  });
  it("ignores an invalid email and returns nulls when nothing matches", () => {
    expect(extractSubmitter([{ key: "email", value: "nope" }], { replyto: "", from_name: "" })).toEqual({ name: null, email: null });
  });
});

describe("isEmailAddress", () => {
  it("accepts simple addresses and rejects junk", () => {
    expect(isEmailAddress("a@b.co")).toBe(true);
    expect(isEmailAddress("a b@b.co")).toBe(false);
    expect(isEmailAddress("")).toBe(false);
  });
});
