// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyMailrookHttp,
  getMailrookKey,
  mailrook,
  mapMailrookResult,
} from "@/lib/email-verify/providers/mailrook";
import {
  checkMail,
  checkMailStatus,
  classifyCheckMailHttp,
  getCheckMailKey,
  mapCheckMail,
} from "@/lib/email-verify/providers/check_mail";

/**
 * Fixtures are the shapes published in each vendor's own API documentation:
 *   MailRook    https://mailrook.com/docs/api
 *   Check-Mail  https://docs.check-mail.org/api-and-authentication/
 *
 * NOTE: no credentials exist for either vendor, so nothing here has been
 * validated against a live response — these assert our mapping of the
 * DOCUMENTED shape, and that anything else degrades without throwing.
 */

const ENV_KEYS = ["MAILROOK_API_KEY", "CHECK_MAIL_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown, ok = true) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    ok
      ? new Response(typeof body === "string" ? body : JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        })
      : Promise.reject(new Error("boom"))
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

/* ------------------------------------------------------------------ MailRook */

/** Documented deliverable body. */
const MAILROOK_DELIVERABLE = {
  data: {
    email: "test@example.com",
    normalized_email: "test@example.com",
    domain: "example.com",
    mx_record: "mx.example.com",
    provider: "custom",
    score: 95,
    result: "deliverable",
    reason: null,
    isv_format: true,
    isv_domain: true,
    isv_deliverable: true,
    isv_nocatchall: true,
    isv_nodisposable: true,
  },
  code: 0,
  message: "ok",
};

/** Documented risky/catch-all body. */
const MAILROOK_RISKY = {
  data: {
    email: "test@example.com",
    normalized_email: "test@example.com",
    score: 80,
    isv_format: true,
    isv_domain: true,
    isv_deliverable: true,
    result: "risky",
    reason: "catch_all",
  },
  code: 0,
  message: "ok",
};

describe("mailrook adapter", () => {
  it("maps the documented result vocabulary into OUR enum", () => {
    expect(mapMailrookResult("deliverable").classification).toBe("deliverable");
    expect(mapMailrookResult("undeliverable").classification).toBe("undeliverable");
    expect(mapMailrookResult("risky").classification).toBe("risky");
    expect(mapMailrookResult("unknown").classification).toBe("unknown");
  });

  it("degrades an unrecognised result to unknown rather than leaking it", () => {
    expect(mapMailrookResult("something_new").classification).toBe("unknown");
    expect(mapMailrookResult("").classification).toBe("unknown");
  });

  it("reads detail from the documented reason and the negative isv_* assertions", () => {
    expect(mapMailrookResult("risky", { reason: "catch_all" }).detail).toBe("catch_all");
    expect(mapMailrookResult("risky", { isv_nocatchall: false }).detail).toBe("catch_all");
    expect(mapMailrookResult("risky", { isv_nodisposable: false }).detail).toBe("disposable");
    expect(mapMailrookResult("deliverable", { isv_nogeneric: false }).detail).toBe("role");
    // The flags are ASSERTIONS: true means "not catch-all", so no detail.
    expect(mapMailrookResult("deliverable", { isv_nocatchall: true, isv_nodisposable: true }).detail).toBeNull();
  });

  it("labels a bare undeliverable as mailbox-not-found (a WARN, never a BLOCK)", () => {
    expect(mapMailrookResult("undeliverable")).toEqual({
      classification: "undeliverable",
      detail: "mailbox_not_found",
    });
  });

  it("classifies HTTP statuses", () => {
    expect(classifyMailrookHttp(200)).toBeNull();
    expect(classifyMailrookHttp(401)).toBe("auth");
    expect(classifyMailrookHttp(403)).toBe("auth");
    expect(classifyMailrookHttp(429)).toBe("quota");
    expect(classifyMailrookHttp(422)).toBe("error");
    expect(classifyMailrookHttp(500)).toBe("error");
  });

  it("verifies a deliverable address and keeps the vendor status verbatim", async () => {
    const fetchMock = stubFetch(200, MAILROOK_DELIVERABLE);
    const res = await mailrook.verify("test@example.com", { credentials: { api_key: "secret-key" } });
    expect(res).toMatchObject({ ok: true, status: "deliverable", classification: "deliverable", detail: null });

    // The key travels in the header, never in the path.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1/validate/test%40example.com");
    // The key must never reach the URL (it would land in logs / the raw row).
    expect(url).not.toContain("secret-key");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect(init!.method).toBe("GET");
  });

  it("verifies a risky catch-all result", async () => {
    stubFetch(200, MAILROOK_RISKY);
    const res = await mailrook.verify("test@example.com", { credentials: { api_key: "k" } });
    expect(res).toMatchObject({ ok: true, status: "risky", classification: "risky", detail: "catch_all" });
  });

  it("reports a 429 as quota and a 401 as auth, without echoing a body", async () => {
    stubFetch(429, { message: "Rate limit exceeded" });
    await expect(mailrook.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toEqual({
      ok: false,
      reason: "quota",
      message: "MailRook HTTP 429",
    });

    stubFetch(401, { message: "Missing or invalid API key" });
    await expect(mailrook.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toEqual({
      ok: false,
      reason: "auth",
      message: "MailRook HTTP 401",
    });
  });

  it("degrades gracefully on malformed and unexpected payloads — never throws", async () => {
    stubFetch(200, "<html>not json</html>");
    await expect(mailrook.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "error",
    });

    // 200 with the envelope but no data/result at all.
    stubFetch(200, { code: 0, message: "ok" });
    await expect(mailrook.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "error",
    });

    stubFetch(200, null);
    await expect(mailrook.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "error",
    });

    // A network failure surfaces as a shape, not a stack trace.
    stubFetch(0, null, false);
    await expect(mailrook.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "error",
    });
  });

  it("treats a missing or blank key as 'skip me', never an exception", async () => {
    delete process.env.MAILROOK_API_KEY;
    expect(getMailrookKey()).toBeNull();
    expect(mailrook.isConfigured()).toBe(false);
    await expect(mailrook.verify("a@b.com")).resolves.toEqual({
      ok: false,
      reason: "auth",
      message: expect.any(String),
    });

    process.env.MAILROOK_API_KEY = "   ";
    expect(mailrook.isConfigured()).toBe(false);

    process.env.MAILROOK_API_KEY = "k";
    expect(mailrook.isConfigured()).toBe(true);
  });
});

/* ---------------------------------------------------------------- Check-Mail */

/** The documented example: a disposable domain that should be blocked. */
const CHECKMAIL_DISPOSABLE = {
  valid: true,
  block: true,
  disposable: true,
  is_disposable: true,
  domain: "temp-mail.org",
  base_domain: "temp-mail.org",
  text: "Disposable / temporary domain",
  reason: "Heuristics x6",
  risk: 99,
};

const CHECKMAIL_GOOD = {
  valid: true,
  block: false,
  is_disposable: false,
  is_role_based_email: false,
  domain: "example.com",
  base_domain: "example.com",
  text: "Business email provider",
  reason: "Whitelist",
  risk: 1,
};

const CHECKMAIL_INVALID = {
  valid: false,
  block: true,
  is_disposable: false,
  domain: "nope.invalid",
  text: "Domain has no MX record",
  reason: "MX lookup",
  risk: 95,
};

describe("check-mail adapter", () => {
  it("maps the documented booleans into OUR enum", () => {
    expect(mapCheckMail(CHECKMAIL_GOOD)).toEqual({ classification: "deliverable", detail: null });
    expect(mapCheckMail(CHECKMAIL_DISPOSABLE)).toEqual({ classification: "risky", detail: "disposable" });
    expect(mapCheckMail(CHECKMAIL_INVALID)).toEqual({ classification: "undeliverable", detail: null });
  });

  it("carries the role-account flag through", () => {
    expect(mapCheckMail({ valid: true, block: false, is_role_based_email: true }).detail).toBe("role");
    // Disposable outranks role when both are set.
    expect(mapCheckMail({ valid: true, block: true, is_disposable: true, is_role_based_email: true }).detail).toBe(
      "disposable"
    );
  });

  it("says unknown rather than guessing when neither boolean is present", () => {
    expect(mapCheckMail({}).classification).toBe("unknown");
    expect(mapCheckMail({ risk: 50 }).classification).toBe("unknown");
  });

  it("uses the vendor's own text as the stored status, with a derived fallback", () => {
    expect(checkMailStatus(CHECKMAIL_DISPOSABLE)).toBe("Disposable / temporary domain");
    expect(checkMailStatus({ valid: false })).toBe("invalid");
    expect(checkMailStatus({ valid: true, block: true })).toBe("blocked");
    expect(checkMailStatus({ valid: true, block: false })).toBe("valid");
  });

  it("classifies HTTP statuses", () => {
    expect(classifyCheckMailHttp(200)).toBeNull();
    expect(classifyCheckMailHttp(401)).toBe("auth");
    expect(classifyCheckMailHttp(429)).toBe("quota");
    expect(classifyCheckMailHttp(500)).toBe("error");
  });

  it("POSTs a form-encoded email with the key in the Authorization header", async () => {
    const fetchMock = stubFetch(200, CHECKMAIL_GOOD);
    const res = await checkMail.verify("test@example.com", { credentials: { api_key: "k" } });
    expect(res).toMatchObject({ ok: true, classification: "deliverable", status: "Business email provider" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.check-mail.org/v2/");
    expect(init!.method).toBe("POST");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect((init!.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(init!.body).toBe("email=test%40example.com");
  });

  it("verifies an undeliverable (invalid domain) result", async () => {
    stubFetch(200, CHECKMAIL_INVALID);
    await expect(checkMail.verify("a@nope.invalid", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: true,
      classification: "undeliverable",
    });
  });

  it("reports the documented 401 as auth and a 429 as quota", async () => {
    stubFetch(401, { message: "Invalid API key." });
    await expect(checkMail.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toEqual({
      ok: false,
      reason: "auth",
      message: "Check-Mail HTTP 401",
    });

    stubFetch(429, {});
    await expect(checkMail.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toEqual({
      ok: false,
      reason: "quota",
      message: "Check-Mail HTTP 429",
    });
  });

  it("degrades gracefully on malformed and unexpected payloads — never throws", async () => {
    stubFetch(200, "not json at all");
    await expect(checkMail.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "error",
    });

    // A 200 carrying only the error envelope.
    stubFetch(200, { message: "Invalid API key." });
    await expect(checkMail.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "error",
    });

    stubFetch(200, null);
    await expect(checkMail.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "error",
    });

    stubFetch(0, null, false);
    await expect(checkMail.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "error",
    });
  });

  it("treats a missing or blank key as 'skip me', never an exception", async () => {
    delete process.env.CHECK_MAIL_API_KEY;
    expect(getCheckMailKey()).toBeNull();
    expect(checkMail.isConfigured()).toBe(false);
    await expect(checkMail.verify("a@b.com")).resolves.toEqual({
      ok: false,
      reason: "auth",
      message: expect.any(String),
    });

    process.env.CHECK_MAIL_API_KEY = "  ";
    expect(checkMail.isConfigured()).toBe(false);

    process.env.CHECK_MAIL_API_KEY = "k";
    expect(checkMail.isConfigured()).toBe(true);
  });
});
