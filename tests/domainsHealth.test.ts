// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/notifications/notify", () => ({ notify: vi.fn(async () => {}) }));

import { botChallengeOf, detectBotChallenge } from "@/lib/domains/botCheck";
import { checkDomainHealth, classifyHealth, dueForCheck, HEALTH_RECHECK_MS, HEALTH_STALE_MS, type SiteProbe } from "@/lib/domains/health";
import type { DomainHealth } from "@/lib/domains/types";

/**
 * Site health: one state per check, a streak, and an alert only when an outage
 * is CONFIRMED (two failed checks in a row) on a site that should be up.
 */

const now = new Date("2026-10-02T12:00:00Z");
const probe = (over: Partial<SiteProbe> = {}): SiteProbe => ({
  dns: { apex: ["76.13.203.71"], www: ["76.13.203.71"] },
  tls: { authorized: true, error: null, validTo: "2026-12-30T19:05:58.000Z", issuer: "Let's Encrypt" },
  http: { status: 200, finalUrl: "https://acme.com/", ms: 420 },
  httpError: null,
  ...over,
});

describe("classifyHealth", () => {
  it("answers over HTTPS with a valid certificate → up", () => {
    expect(classifyHealth(probe(), null, now)).toMatchObject({ state: "up", summary: "Up — answered in 420 ms", http_status: 200, ms: 420, consecutive_failures: 0, since: now.toISOString() });
  });

  it("points nowhere → no_dns; only at Hostinger's parking page → parked", () => {
    expect(classifyHealth(probe({ dns: { apex: [], www: [] } }), null, now)?.state).toBe("no_dns");
    expect(classifyHealth(probe({ dns: { apex: ["2.57.91.91"], www: ["2.57.91.91"] } }), null, now)?.state).toBe("parked");
  });

  it("nothing on 443, an error page or no HTTP answer → down", () => {
    expect(classifyHealth(probe({ tls: null }), null, now)).toMatchObject({ state: "down", summary: "Nothing answers on HTTPS" });
    expect(classifyHealth(probe({ http: { status: 403, finalUrl: "", ms: 90 } }), null, now)?.summary).toMatch(/403/);
    expect(classifyHealth(probe({ http: { status: 502, finalUrl: "", ms: 90 } }), null, now)?.summary).toMatch(/server is failing/);
    expect(classifyHealth(probe({ http: null, httpError: "timed out" }), null, now)).toMatchObject({ state: "down", summary: "The site didn't answer (timed out)" });
  });

  it("a bad certificate → ssl_error, in plain words", () => {
    expect(classifyHealth(probe({ tls: { authorized: false, error: "CERT_HAS_EXPIRED", validTo: null, issuer: null } }), null, now)).toMatchObject({
      state: "ssl_error",
      summary: "The SSL certificate has expired",
    });
    expect(classifyHealth(probe({ tls: { authorized: false, error: "ERR_TLS_CERT_ALTNAME_INVALID", validTo: null, issuer: null } }), null, now)?.summary).toBe(
      "The SSL certificate is for a different site",
    );
  });

  it("our own DNS lookup failing decides nothing", () => {
    expect(classifyHealth(probe({ dns: { apex: null, www: [] } }), null, now)).toBeNull();
  });

  it("counts failures in a row and keeps when the state began", () => {
    const first = classifyHealth(probe({ tls: null }), null, now)!;
    expect(first.consecutive_failures).toBe(1);
    const later = new Date(now.getTime() + 300_000);
    const second = classifyHealth(probe({ tls: null }), first, later)!;
    expect(second).toMatchObject({ consecutive_failures: 2, since: now.toISOString() });
    const back = classifyHealth(probe(), second, later)!;
    expect(back).toMatchObject({ state: "up", consecutive_failures: 0, since: later.toISOString() });
  });
});

type HealthRowT = Parameters<typeof dueForCheck>[0][number];
const hrow = (id: string, checkedAgoMs: number | null, failures = 0): HealthRowT => ({
  id,
  domain: `${id}.com`,
  status: "connected",
  registrar_status: "active",
  lead_id: null,
  health_state: checkedAgoMs === null ? null : failures ? "down" : "up",
  health: checkedAgoMs === null ? {} : ({ consecutive_failures: failures } as DomainHealth),
  health_checked_at: checkedAgoMs === null ? null : new Date(now.getTime() - checkedAgoMs).toISOString(),
});

describe("dueForCheck", () => {
  it("a confirmation re-check first, then never-checked, then the stalest; fresh ones wait", () => {
    const rows = [
      hrow("fresh", 60_000),
      hrow("stale", HEALTH_STALE_MS + 1000),
      hrow("never", null),
      hrow("failing", HEALTH_RECHECK_MS + 1000, 1),
      hrow("failing-too-soon", 60_000, 1),
    ];
    expect(dueForCheck(rows, now, 10).map((r) => r.id)).toEqual(["failing", "never", "stale"]);
    expect(dueForCheck(rows, now, 1).map((r) => r.id)).toEqual(["failing"]);
  });
});

describe("checkDomainHealth", () => {
  function fakeDb() {
    const writes: { table: string; op: string; value: unknown }[] = [];
    const admin = {
      from: (table: string) => ({
        update: (value: unknown) => ({ eq: async () => (writes.push({ table, op: "update", value }), { error: null }) }),
        insert: async (value: unknown) => (writes.push({ table, op: "insert", value }), { error: null }),
      }),
    };
    return { admin: admin as never, writes };
  }

  it("stores the result and its history row; alerts only on the SECOND failure in a row", async () => {
    const db = fakeDb();
    const notify = vi.fn(async () => {});
    const down = probe({ tls: null });
    const row = { ...hrow("site", HEALTH_STALE_MS + 1), health_state: null, health: {} } as HealthRowT;

    const first = await checkDomainHealth(db.admin, row, { probe: async () => down, notify, now });
    expect(first?.consecutive_failures).toBe(1);
    expect(notify).not.toHaveBeenCalled();
    expect(db.writes.map((w) => `${w.table}:${w.op}`)).toEqual(["client_domains:update", "client_domain_checks:insert"]);
    expect(db.writes[1].value).toMatchObject({ domain_id: "site", state: "down", error: "Nothing answers on HTTPS" });

    const second = await checkDomainHealth(db.admin, { ...row, health_state: "down", health: first! }, { probe: async () => down, notify, now: new Date(now.getTime() + 300_000) });
    expect(second?.consecutive_failures).toBe(2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("domain_site_down", expect.anything(), expect.objectContaining({ title: "Site down: site.com", targetUrl: "/domains/site" }));
  });

  it("no alert for a domain with no site to serve (unassigned) or an expired one", async () => {
    const db = fakeDb();
    const notify = vi.fn(async () => {});
    const failing = { consecutive_failures: 1, state: "down", since: now.toISOString() } as DomainHealth;
    for (const over of [{ status: "unassigned" as const }, { registrar_status: "expired" }]) {
      await checkDomainHealth(db.admin, { ...hrow("x", 1, 1), health: failing, ...over } as HealthRowT, { probe: async () => probe({ tls: null }), notify, now });
    }
    expect(notify).not.toHaveBeenCalled();
  });

  it("an inconclusive probe writes nothing", async () => {
    const db = fakeDb();
    const h = await checkDomainHealth(db.admin, hrow("x", null), { probe: async () => probe({ dns: { apex: null, www: null } }), now });
    expect(h).toBeNull();
    expect(db.writes).toEqual([]);
  });
});

/**
 * A host's bot check (Hostinger's LiteSpeed "Bot Verification", its CDN's
 * "Checking your browser…", Cloudflare's challenge) is the host screening
 * visitors, not the site being down. Seen live on 2026-10-20/21: ~30 healthy
 * sites on one Hostinger account answered our checker this way and each got a
 * false "Site down" alert.
 */
const LITESPEED_PAGE = `<!DOCTYPE html><html><head><title>Bot Verification</title><script>
var onloadCallback = function() { var cont = grecaptcha.render('recaptchadiv', {'sitekey': 'x', 'callback': onSubmit}); grecaptcha.execute(cont); };
</script></head><body><div class="panel"><h3 class="title">Verifying that you are not a robot...</h3>
<form id="lsrecaptcha-form" method="POST" action="/.lsrecap/recaptcha?"><div id="recaptchadiv"></div></form></div></body></html>`;
const CDN_PAGE = `<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing acme.com. Please wait for up to 5 seconds...</body></html>`;
const FORBIDDEN_PAGE = `<html><head><title> 403 Forbidden\n</title></head><body><h1>403</h1><h2>Forbidden</h2><p>Access to this resource on the server is denied!</p></body></html>`;

describe("detectBotChallenge", () => {
  const h = (init: Record<string, string> = {}) => new Headers(init);

  it("names LiteSpeed's reCAPTCHA page, the CDN's browser check and Cloudflare's challenge", () => {
    expect(detectBotChallenge(403, h({ server: "LiteSpeed" }), LITESPEED_PAGE)).toBe("litespeed");
    expect(detectBotChallenge(403, h({ server: "hcdn" }), LITESPEED_PAGE)).toBe("litespeed");
    expect(detectBotChallenge(503, h({ server: "hcdn" }), CDN_PAGE)).toBe("hostinger_cdn");
    expect(detectBotChallenge(403, h({ "cf-mitigated": "challenge" }), "")).toBe("cloudflare");
  });

  it("a real error page, or a working page that mentions the words, is not a bot check", () => {
    expect(detectBotChallenge(403, h({ server: "hcdn" }), FORBIDDEN_PAGE)).toBeNull();
    expect(detectBotChallenge(500, h(), "<title>Internal Server Error</title>")).toBeNull();
    expect(detectBotChallenge(200, h(), LITESPEED_PAGE)).toBeNull();
  });
});

describe("botChallengeOf", () => {
  it("reads an error page to find the bot check", async () => {
    expect(await botChallengeOf(new Response(LITESPEED_PAGE, { status: 403 }))).toBe("litespeed");
    expect(await botChallengeOf(new Response(FORBIDDEN_PAGE, { status: 403 }))).toBeNull();
  });

  it("never reads a working page, and stops after the first 32 KB of an error page", async () => {
    const ok = new Response("<title>Bot Verification</title>", { status: 200 });
    expect(await botChallengeOf(ok)).toBeNull();
    expect(ok.body?.locked).toBe(false); // released unread
    const huge = new Response("x".repeat(40_000) + "lsrecaptcha", { status: 403 });
    expect(await botChallengeOf(huge)).toBeNull();
  });
});

describe("a bot check in the health round", () => {
  const challenged = (challenge: "litespeed" | "hostinger_cdn" | "cloudflare" = "litespeed") =>
    probe({ http: { status: 403, finalUrl: "https://acme.com/", ms: 80, challenge } });

  it("→ challenged, in words that say who put it up; not a failure", () => {
    expect(classifyHealth(challenged(), null, now)).toMatchObject({
      state: "challenged",
      summary: "The web server showed our checker a bot check. Browsers normally pass it on their own; the page behind it wasn't checked",
      http_status: 403,
      consecutive_failures: 0,
    });
    expect(classifyHealth(challenged("hostinger_cdn"), null, now)?.summary).toMatch(/^Hostinger's CDN showed/);
    expect(classifyHealth(challenged("cloudflare"), null, now)?.summary).toMatch(/^Cloudflare showed/);
  });

  it("breaks a failure streak, and two in a row never send a 'Site down' alert", async () => {
    const failed = classifyHealth(probe({ tls: null }), null, now)!;
    expect(classifyHealth(challenged(), failed, now)?.consecutive_failures).toBe(0);

    const writes: unknown[] = [];
    const admin = {
      from: () => ({
        update: () => ({ eq: async () => ({ error: null }) }),
        insert: async (value: unknown) => (writes.push(value), { error: null }),
      }),
    } as never;
    const notify = vi.fn(async () => {});
    const row = { ...hrow("site", HEALTH_STALE_MS + 1), health_state: null, health: {} } as HealthRowT;
    const first = await checkDomainHealth(admin, row, { probe: async () => challenged(), notify, now });
    await checkDomainHealth(admin, { ...row, health_state: "challenged", health: first! }, { probe: async () => challenged(), notify, now });
    expect(notify).not.toHaveBeenCalled();
    expect(writes[0]).toMatchObject({ state: "challenged", http_status: 403 });
  });
});

describe("go-live reachability probe", () => {
  it("a bot check in front of the new domain counts as served, a plain 403 doesn't", async () => {
    const { probeSite: goLiveProbe } = await import("@/lib/site-studio/deploy/transfer");
    const fetchMock = vi.fn(async () => new Response(LITESPEED_PAGE, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await goLiveProbe("acme.com")).toBe(true);
      fetchMock.mockImplementation(async () => new Response(FORBIDDEN_PAGE, { status: 403 }));
      expect(await goLiveProbe("acme.com")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
