// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyInboxTrueHttp,
  getInboxTrueKey,
  inboxtrue,
  mapInboxTrueValidity,
} from "@/lib/email-verify/providers/inboxtrue";

/**
 * Fixtures are the shapes published in InboxTrue's own API reference
 * (https://inboxtrue.com/docs). No credentials are spent here — every response
 * is a stub. These assert our mapping of the DOCUMENTED shape, and that
 * anything else degrades without throwing.
 */

const ENV_KEY = "INBOXTRUE_API_KEY";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
});
afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
  vi.unstubAllGlobals();
});

/** Their rate-limit headers ride on every response, success and 429 alike. */
const RATE_HEADERS = {
  "Content-Type": "application/json",
  "X-RateLimit-Limit": "60",
  "X-RateLimit-Remaining": "59",
  "X-RateLimit-Reset": "1750000000",
  "X-RateLimit-Bucket": "minute",
};

function stubFetch(status: number, body: unknown, ok = true, headers: Record<string, string> = RATE_HEADERS) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    ok
      ? new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers })
      : Promise.reject(new Error("boom"))
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Documented success body. */
const VALID = {
  email: "user@example.com",
  normalized: "user@example.com",
  validity: "valid",
  validated_at: "2025-06-15T14:32:01",
  is_disposable: false,
  is_consumer: false,
  is_domain_catchall: false,
  mx_records: ["mx1.example.com", "mx2.example.com"],
};

const INVALID = {
  email: "nobody@example.com",
  normalized: "nobody@example.com",
  validity: "invalid",
  validated_at: "2025-06-15T14:32:01",
  is_disposable: false,
  is_consumer: false,
  is_domain_catchall: false,
  mx_records: ["mx1.example.com"],
};

describe("inboxtrue mapping", () => {
  it("maps the documented validity vocabulary into OUR enum", () => {
    expect(mapInboxTrueValidity("valid").classification).toBe("deliverable");
    expect(mapInboxTrueValidity("invalid").classification).toBe("undeliverable");
    expect(mapInboxTrueValidity("malformed").classification).toBe("undeliverable");
    expect(mapInboxTrueValidity("ambiguous").classification).toBe("risky");
    expect(mapInboxTrueValidity("maybe_valid").classification).toBe("risky");
  });

  it("treats BOTH error validities as unknown — a failed measurement, not a bad address", () => {
    // perm_error is a permanent VALIDATION failure, not evidence the mailbox is
    // gone; calling it undeliverable would turn a provider outage into a warning
    // on a perfectly good lead.
    expect(mapInboxTrueValidity("temp_error")).toEqual({ classification: "unknown", detail: null });
    expect(mapInboxTrueValidity("perm_error")).toEqual({ classification: "unknown", detail: null });
  });

  it("degrades an unrecognised or empty validity to unknown rather than leaking it", () => {
    expect(mapInboxTrueValidity("something_new").classification).toBe("unknown");
    expect(mapInboxTrueValidity("").classification).toBe("unknown");
  });

  it("labels a bare invalid as mailbox-not-found (a WARN downstream, never a BLOCK)", () => {
    expect(mapInboxTrueValidity("invalid")).toEqual({
      classification: "undeliverable",
      detail: "mailbox_not_found",
    });
  });

  it("surfaces the disposable and catch-all flags", () => {
    expect(mapInboxTrueValidity("valid", { is_disposable: true }).detail).toBe("disposable");
    expect(mapInboxTrueValidity("valid", { is_domain_catchall: true }).detail).toBe("catch_all");
    // Disposable outranks catch-all when both are set.
    expect(mapInboxTrueValidity("valid", { is_disposable: true, is_domain_catchall: true }).detail).toBe("disposable");
  });

  it("reads a null/false catch-all as 'no detail', never as a positive", () => {
    // `is_domain_catchall` is documented as boolean | null — null means UNKNOWN.
    expect(mapInboxTrueValidity("valid", { is_domain_catchall: null }).detail).toBeNull();
    expect(mapInboxTrueValidity("valid", { is_domain_catchall: false, is_disposable: false }).detail).toBeNull();
  });
});

describe("inboxtrue HTTP classification", () => {
  it("separates out-of-credit (402) from rate limiting (429)", () => {
    expect(classifyInboxTrueHttp(200)).toBeNull();
    expect(classifyInboxTrueHttp(401)).toBe("auth");
    expect(classifyInboxTrueHttp(403)).toBe("auth");
    // 402 "Missing credits." is the authoritative exhaustion signal.
    expect(classifyInboxTrueHttp(402)).toBe("quota");
    // 429 is a burst limit with its own X-RateLimit-NextAvailable — parking the
    // provider for the whole month over it would waste the free tier.
    expect(classifyInboxTrueHttp(429)).toBe("error");
    expect(classifyInboxTrueHttp(400)).toBe("error");
    expect(classifyInboxTrueHttp(404)).toBe("error");
    expect(classifyInboxTrueHttp(500)).toBe("error");
  });
});

describe("inboxtrue adapter", () => {
  it("verifies a valid address, keeps the vendor status verbatim, and keys the header only", async () => {
    const fetchMock = stubFetch(200, VALID);
    const res = await inboxtrue.verify("user@example.com", { credentials: { api_key: "secret-key" } });
    expect(res).toMatchObject({ ok: true, status: "valid", classification: "deliverable", detail: null });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1/email/validate?email=user%40example.com");
    // A short server-side probe budget so a slow provider cannot stall a form.
    expect(url).toContain("timeout=10");
    // The key must never reach the URL (it would land in logs / the raw row).
    expect(url).not.toContain("secret-key");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
    expect(init!.method).toBe("GET");
  });

  it("verifies an invalid address as undeliverable/mailbox-not-found", async () => {
    stubFetch(200, INVALID);
    await expect(inboxtrue.verify("nobody@example.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: true,
      status: "invalid",
      classification: "undeliverable",
      detail: "mailbox_not_found",
    });
  });

  it("maps temp_error and perm_error to unknown over the wire, not undeliverable", async () => {
    stubFetch(200, { ...VALID, validity: "temp_error" });
    await expect(inboxtrue.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: true,
      status: "temp_error",
      classification: "unknown",
    });

    stubFetch(200, { ...VALID, validity: "perm_error" });
    await expect(inboxtrue.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: true,
      status: "perm_error",
      classification: "unknown",
    });
  });

  it("reports the documented 402 as quota, surfacing their msg", async () => {
    stubFetch(402, { msg: "Missing credits." });
    await expect(inboxtrue.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toEqual({
      ok: false,
      reason: "quota",
      message: "InboxTrue HTTP 402: Missing credits.",
    });
  });

  it("reports a 429 as a TRANSIENT error, never as quota", async () => {
    const res = await (async () => {
      stubFetch(
        429,
        { msg: "Too many requests." },
        true,
        { ...RATE_HEADERS, "X-RateLimit-Remaining": "0", "X-RateLimit-NextAvailable": "1750000030" }
      );
      return inboxtrue.verify("a@b.com", { credentials: { api_key: "k" } });
    })();
    // The distinction matters: `quota` would park the provider until the month
    // rolled over; `error` only skips it for this one lookup.
    expect(res).toEqual({ ok: false, reason: "error", message: "InboxTrue HTTP 429: Too many requests." });
  });

  it("reports a 401 as auth", async () => {
    stubFetch(401, { msg: "Unauthorized." });
    await expect(inboxtrue.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "auth",
    });
  });

  it("degrades gracefully on malformed and unexpected payloads — never throws", async () => {
    // Non-JSON on a 200.
    stubFetch(200, "<html>403 Forbidden</html>");
    await expect(inboxtrue.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "error",
    });

    // Non-JSON on an error status: still classified by the status alone.
    stubFetch(402, "<html>nope</html>");
    await expect(inboxtrue.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toEqual({
      ok: false,
      reason: "quota",
      message: "InboxTrue HTTP 402",
    });

    // 200 with no validity field at all.
    stubFetch(200, { email: "a@b.com", mx_records: [] });
    await expect(inboxtrue.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "error",
    });

    stubFetch(200, null);
    await expect(inboxtrue.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "error",
    });

    // A network failure surfaces as a shape, not a stack trace.
    stubFetch(0, null, false);
    await expect(inboxtrue.verify("a@b.com", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: false,
      reason: "error",
    });
  });

  it("tolerates a null `normalized` on a malformed address", async () => {
    stubFetch(200, { email: "not-an-email", normalized: null, validity: "malformed", mx_records: [] });
    await expect(inboxtrue.verify("not-an-email", { credentials: { api_key: "k" } })).resolves.toMatchObject({
      ok: true,
      status: "malformed",
      classification: "undeliverable",
    });
  });

  it("treats a missing or blank key as 'skip me', never an exception", async () => {
    delete process.env.INBOXTRUE_API_KEY;
    expect(getInboxTrueKey()).toBeNull();
    expect(inboxtrue.isConfigured()).toBe(false);
    await expect(inboxtrue.verify("a@b.com")).resolves.toEqual({
      ok: false,
      reason: "auth",
      message: expect.any(String),
    });

    process.env.INBOXTRUE_API_KEY = "   ";
    expect(inboxtrue.isConfigured()).toBe(false);

    process.env.INBOXTRUE_API_KEY = "k";
    expect(inboxtrue.isConfigured()).toBe(true);
    // Explicit credentials always win over the environment seed.
    expect(getInboxTrueKey({ api_key: "from-config" })).toBe("from-config");
  });
});
