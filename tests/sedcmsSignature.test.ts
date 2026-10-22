// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  ReplayCache,
  SEDCMS_SIGNATURE_HEADER,
  SEDCMS_TIMESTAMP_HEADER,
  sedcmsSignature,
  verifySedcms,
} from "@/lib/sedcms/signature";

/**
 * SED CMS -> LMS calls are signed (launch plan, "Decided" and L1):
 * hex HMAC-SHA256 over [method, path with query, timestamp, sha256(body)]
 * joined by line feeds, a 300 s window, a 10-minute replay cache, and a 503
 * while the shared secret is missing or short. The vectors are shared with the
 * CMS's signing client (M3.3) through one fixture file.
 */

interface SigCase {
  name: string;
  method: string;
  pathAndQuery: string;
  timestamp: number;
  body: string;
  bodySha256: string;
  signature: string;
}

const shared = JSON.parse(readFileSync("tests/fixtures/sedcms/shared-vectors.json", "utf8")) as {
  signature: {
    secret: string;
    headers: { timestamp: string; signature: string };
    windowSeconds: number;
    minSecretBytes: number;
    cases: SigCase[];
  };
};
const SECRET = shared.signature.secret;
const CASES = shared.signature.cases;
const ORIGIN = "https://lms.sedsolutions.online";

function requestFor(c: SigCase, overrides: { method?: string; pathAndQuery?: string; timestamp?: string; signature?: string } = {}) {
  const headers = new Headers();
  headers.set(SEDCMS_TIMESTAMP_HEADER, overrides.timestamp ?? String(c.timestamp));
  headers.set(SEDCMS_SIGNATURE_HEADER, overrides.signature ?? c.signature);
  return new Request(`${ORIGIN}${overrides.pathAndQuery ?? c.pathAndQuery}`, { method: overrides.method ?? c.method, headers });
}

const at = (seconds: number) => () => seconds * 1000;
// a POST with a query and a body naming index.html
const post = CASES.find((c) => c.method === "POST" && c.pathAndQuery.includes("?") && c.body.includes("index.html"))!;

const KEY = "SEDCMS_LMS_SECRET";
let saved: string | undefined;
beforeEach(() => {
  saved = process.env[KEY];
  process.env[KEY] = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

describe("the shared vectors", () => {
  it("name the headers and limits this module uses", () => {
    expect(shared.signature.headers).toEqual({ timestamp: SEDCMS_TIMESTAMP_HEADER, signature: SEDCMS_SIGNATURE_HEADER });
    expect(shared.signature.windowSeconds).toBe(300);
    expect(shared.signature.minSecretBytes).toBe(32);
  });

  it.each(CASES.map((c) => [c.name, c] as const))("signs %s exactly as the CMS does", (_name, c) => {
    expect(sedcmsSignature(SECRET, c.method, c.pathAndQuery, c.timestamp, c.body)).toBe(c.signature);
    // bytes in, same answer: the route hashes the raw body as it arrived
    expect(sedcmsSignature(SECRET, c.method, c.pathAndQuery, c.timestamp, new TextEncoder().encode(c.body))).toBe(c.signature);
  });

  it.each(CASES.map((c) => [c.name, c] as const))("accepts %s", async (_name, c) => {
    const verdict = await verifySedcms(requestFor(c), c.body, { now: at(c.timestamp), seen: new ReplayCache() });
    expect(verdict).toEqual({ ok: true });
  });
});

describe("verifySedcms refuses (401)", () => {
  const check = (req: Request, body = post.body, now = at(post.timestamp)) => verifySedcms(req, body, { now, seen: new ReplayCache() });

  it("a changed method", async () => {
    expect(await check(requestFor(post, { method: "PUT" }))).toEqual({ ok: false, status: 401 });
  });

  it("a changed path or query", async () => {
    expect(await check(requestFor(post, { pathAndQuery: post.pathAndQuery.replace("checksums", "apply") }))).toEqual({ ok: false, status: 401 });
    expect(await check(requestFor(post, { pathAndQuery: post.pathAndQuery.replace("trace=1", "trace=2") }))).toEqual({ ok: false, status: 401 });
    expect(await check(requestFor(post, { pathAndQuery: post.pathAndQuery.split("?")[0] }))).toEqual({ ok: false, status: 401 });
  });

  it("a changed body, by one character", async () => {
    const tampered = post.body.replace("index.html", "index.htm!");
    expect(tampered).not.toBe(post.body);
    expect(await check(requestFor(post), tampered)).toEqual({ ok: false, status: 401 });
  });

  it("a timestamp 301 s away, either way; 300 s is still inside the window", async () => {
    expect(await check(requestFor(post), post.body, at(post.timestamp + 301))).toEqual({ ok: false, status: 401 });
    expect(await check(requestFor(post), post.body, at(post.timestamp - 301))).toEqual({ ok: false, status: 401 });
    expect(await check(requestFor(post), post.body, at(post.timestamp + 300))).toEqual({ ok: true });
    expect(await check(requestFor(post), post.body, at(post.timestamp - 300))).toEqual({ ok: true });
  });

  it("a signature made with another secret", async () => {
    const forged = sedcmsSignature(`${SECRET}x`, post.method, post.pathAndQuery, post.timestamp, post.body);
    expect(await check(requestFor(post, { signature: forged }))).toEqual({ ok: false, status: 401 });
  });

  it("missing or malformed headers", async () => {
    const bare = new Request(`${ORIGIN}${post.pathAndQuery}`, { method: "POST" });
    expect(await check(bare)).toEqual({ ok: false, status: 401 });
    for (const timestamp of ["", "1761177602 1", "1761177602.0", "-1761177602", "0x68f8b302", "1e9", "17611776021761177602"]) {
      expect(await check(requestFor(post, { timestamp }))).toEqual({ ok: false, status: 401 });
    }
    for (const signature of ["", post.signature.toUpperCase(), post.signature.slice(1), `${post.signature}0`, `sha256=${post.signature}`, post.signature.replace(/[0-9a-f]$/, "g")]) {
      expect(await check(requestFor(post, { signature }))).toEqual({ ok: false, status: 401 });
    }
  });
});

describe("replays", () => {
  it("the same signature twice fails the second time", async () => {
    const seen = new ReplayCache();
    const opts = { now: at(post.timestamp), seen };
    expect(await verifySedcms(requestFor(post), post.body, opts)).toEqual({ ok: true });
    expect(await verifySedcms(requestFor(post), post.body, opts)).toEqual({ ok: false, status: 401 });
    // still refused near the end of the window
    expect(await verifySedcms(requestFor(post), post.body, { now: at(post.timestamp + 300), seen })).toEqual({ ok: false, status: 401 });
  });

  it("only a verified signature is remembered, so a forged one can't block the real one", async () => {
    const seen = new ReplayCache();
    const forged = sedcmsSignature("another-secret-that-is-long-enough-000000", post.method, post.pathAndQuery, post.timestamp, post.body);
    expect(await verifySedcms(requestFor(post, { signature: forged }), post.body, { now: at(post.timestamp), seen })).toEqual({ ok: false, status: 401 });
    expect(seen.size).toBe(0);
    expect(await verifySedcms(requestFor(post), post.body, { now: at(post.timestamp), seen })).toEqual({ ok: true });
  });

  it("the cache keeps a signature for 10 minutes, then forgets it", () => {
    const cache = new ReplayCache();
    const t0 = 1_761_177_600_000;
    expect(cache.record("a".repeat(64), t0)).toBe("fresh");
    expect(cache.record("a".repeat(64), t0 + 10 * 60_000 - 1)).toBe("seen");
    expect(cache.record("a".repeat(64), t0 + 10 * 60_000 + 1)).toBe("fresh");
  });

  it("the cache holds at most 10 000 entries, and a full cache refuses (503) rather than forget early", async () => {
    const cache = new ReplayCache();
    const t0 = 1_761_177_600_000;
    for (let i = 0; i < 10_000; i++) expect(cache.record(i.toString(16).padStart(64, "0"), t0)).toBe("fresh");
    expect(cache.size).toBe(10_000);
    expect(cache.record("f".repeat(64), t0 + 1)).toBe("full");
    // a verified request meeting a full cache is a 503, not an unremembered success
    const small = new ReplayCache({ maxEntries: 1 });
    const other = CASES.find((c) => c !== post && c.method === "POST")!;
    expect(await verifySedcms(requestFor(post), post.body, { now: at(post.timestamp), seen: small })).toEqual({ ok: true });
    expect(await verifySedcms(requestFor(other), other.body, { now: at(other.timestamp), seen: small })).toEqual({ ok: false, status: 503 });
    // expired entries make room again
    expect(cache.record("f".repeat(64), t0 + 10 * 60_000 + 1)).toBe("fresh");
    expect(cache.size).toBe(1);
  });
});

describe("the secret", () => {
  it("missing is a 503, before anything else is looked at", async () => {
    delete process.env[KEY];
    expect(await verifySedcms(requestFor(post), post.body, { now: at(post.timestamp), seen: new ReplayCache() })).toEqual({ ok: false, status: 503 });
    const bare = new Request(`${ORIGIN}${post.pathAndQuery}`, { method: "POST" });
    expect(await verifySedcms(bare, post.body, { now: at(post.timestamp), seen: new ReplayCache() })).toEqual({ ok: false, status: 503 });
  });

  it("shorter than 32 bytes is a 503; 32 bytes is enough, counted as UTF-8 bytes", async () => {
    const short = "s".repeat(31);
    process.env[KEY] = short;
    const sig = sedcmsSignature(short, post.method, post.pathAndQuery, post.timestamp, post.body);
    expect(await verifySedcms(requestFor(post, { signature: sig }), post.body, { now: at(post.timestamp), seen: new ReplayCache() })).toEqual({ ok: false, status: 503 });

    // 16 two-byte characters are 32 bytes
    const wide = String.fromCharCode(233).repeat(16);
    process.env[KEY] = wide;
    const wideSig = sedcmsSignature(wide, post.method, post.pathAndQuery, post.timestamp, post.body);
    expect(await verifySedcms(requestFor(post, { signature: wideSig }), post.body, { now: at(post.timestamp), seen: new ReplayCache() })).toEqual({ ok: true });
  });

  it("with leading or trailing whitespace is a 503, logged by its reason and never by its value", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const padded of [`${SECRET}${String.fromCharCode(10)}`, ` ${SECRET}`, `${SECRET} `, `${String.fromCharCode(9)}${SECRET}`, `${SECRET}${String.fromCharCode(13, 10)}`]) {
        process.env[KEY] = padded;
        // even a request signed with the padded value is refused: nothing is trimmed silently
        const sig = sedcmsSignature(padded, post.method, post.pathAndQuery, post.timestamp, post.body);
        expect(await verifySedcms(requestFor(post, { signature: sig }), post.body, { now: at(post.timestamp), seen: new ReplayCache() })).toEqual({ ok: false, status: 503 });
        expect(await verifySedcms(requestFor(post), post.body, { now: at(post.timestamp), seen: new ReplayCache() })).toEqual({ ok: false, status: 503 });
      }
      const lines = warn.mock.calls.map((args) => args.map(String).join(" "));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toContain("SEDCMS_LMS_SECRET has leading or trailing whitespace");
        expect(line).not.toContain(SECRET);
        expect(line).not.toContain(SECRET.slice(0, 12));
      }
    } finally {
      warn.mockRestore();
    }
  });

  it("logs why it is refusing when it is unset or short, without the value", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      delete process.env[KEY];
      await verifySedcms(requestFor(post), post.body, { now: at(post.timestamp), seen: new ReplayCache() });
      process.env[KEY] = "short-secret-value";
      await verifySedcms(requestFor(post), post.body, { now: at(post.timestamp), seen: new ReplayCache() });
      const lines = warn.mock.calls.map((args) => args.map(String).join(" "));
      expect(lines.some((l) => l.includes("SEDCMS_LMS_SECRET is not set"))).toBe(true);
      expect(lines.some((l) => l.includes("SEDCMS_LMS_SECRET is shorter than 32 bytes"))).toBe(true);
      expect(lines.join(" ")).not.toContain("short-secret-value");
    } finally {
      warn.mockRestore();
    }
  });

  it("is read from SEDCMS_LMS_SECRET at call time", async () => {
    process.env[KEY] = `${SECRET}-rotated`;
    expect(await verifySedcms(requestFor(post), post.body, { now: at(post.timestamp), seen: new ReplayCache() })).toEqual({ ok: false, status: 401 });
  });
});
