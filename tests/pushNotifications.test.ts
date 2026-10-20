// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { memorySupabase } from "./helpers/memorySupabase";
import { planPushes, dispatchDuePush, sendTestPush, PUSH_FRESH_MS, type PushSender } from "@/lib/push/dispatch";
import { pushPayloadFor, safeTarget } from "@/lib/push/payload";
import { isAllowedPushEndpoint, isPushKey } from "@/lib/push/endpoint";
import { ensureVapid, getVapid, resetVapidCache, subjectFor } from "@/lib/push/vapid";

/**
 * Desktop/phone push. What matters: every due notification reaches each of
 * its owner's devices exactly once; read, stale or not-yet-due ones don't;
 * dead devices are pruned; urgent ones stay on screen; a click can only ever
 * land on this site; and the server only talks to real browser push services.
 */

const NOW = new Date("2026-10-20T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const ENDPOINT = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;

const note = (id: string, over: Record<string, unknown> = {}) => ({
  id, user_id: "u1", event_key: "lead_submitted", title: `Lead ${id}`, body: `Body ${id}`,
  created_at: ago(1), deliver_after: ago(1), read_at: null, lead_id: "L1", target_url: `/leads/L1`,
  pushed_at: null, ...over,
});
const sub = (id: string, user: string, n: number) => ({ id, user_id: user, endpoint: ENDPOINT(n), p256dh: "p".repeat(87), auth: "a".repeat(22), failure_count: 0 });

beforeEach(() => {
  resetVapidCache();
  process.env.VAPID_PUBLIC_KEY = "BPublicKeyForTests";
  process.env.VAPID_PRIVATE_KEY = "privateKeyForTests";
  process.env.VAPID_SUBJECT = "https://lms.example.com";
});
afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  resetVapidCache();
});

describe("what a push carries", () => {
  it("title, body, a click route that marks it read, and urgency from the event", () => {
    const p = pushPayloadFor(note("n1", { event_key: "followup_reminder" }));
    expect(p).toMatchObject({ id: "n1", title: "Lead n1", url: "/api/notifications/n1/open", tag: "n-n1", urgent: true });
    expect(pushPayloadFor(note("n2")).urgent).toBe(false);
    expect(pushPayloadFor(note("n3", { body: "x".repeat(2000) })).body.length).toBeLessThanOrEqual(400);
  });

  it("a click only ever lands on this site", () => {
    expect(safeTarget({ target_url: "/tickets/9" })).toBe("/tickets/9");
    expect(safeTarget({ target_url: "https://evil.example/x", lead_id: "L1" })).toBe("/leads/L1");
    expect(safeTarget({ target_url: "//evil.example/x" })).toBe("/notifications");
    expect(safeTarget({ target_url: "/\\evil.example" })).toBe("/notifications");
    expect(safeTarget({})).toBe("/notifications");
  });

  it("a burst for one person becomes one summary; urgent ones still arrive singly", () => {
    const rows = [note("a"), note("b"), note("c"), note("d"), note("e", { event_key: "ticket_assigned" })];
    const plan = planPushes(rows as never);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ id: "e", urgent: true });
    expect(plan[1]).toMatchObject({ id: null, title: "4 new notifications", url: "/notifications", tag: "summary" });
    expect(plan[1].body).toMatch(/Lead a · Lead b · Lead c · \+1 more/);
    expect(planPushes([note("a"), note("b")] as never)).toHaveLength(2);
  });
});

describe("dispatchDuePush", () => {
  function setup(notifications: Record<string, unknown>[], subs = [sub("s1", "u1", 1), sub("s2", "u1", 2), sub("s3", "u2", 3)]) {
    return memorySupabase({ notifications, push_subscriptions: subs });
  }
  const recorder = () => {
    const sent: { endpoint: string; title: string; urgent: boolean }[] = [];
    const send: PushSender = async (s, p) => {
      sent.push({ endpoint: s.endpoint, title: p.title, urgent: p.urgent });
    };
    return { sent, send };
  };

  it("pushes each due notification to every device of its owner, once", async () => {
    const db = setup([note("n1"), note("n2", { user_id: "u2" })]);
    const r = recorder();
    const out = await dispatchDuePush(db.client, NOW, r.send);
    expect(out).toMatchObject({ claimed: 2, sent: 3, failed: 0 });
    expect(r.sent.map((s) => s.endpoint).sort()).toEqual([ENDPOINT(1), ENDPOINT(2), ENDPOINT(3)]);
    expect(db.tables.notifications.every((n) => n.pushed_at === NOW.toISOString())).toBe(true);

    // A second pass (the poller after notify()'s kick) finds nothing to send.
    const again = await dispatchDuePush(db.client, NOW, r.send);
    expect(again).toMatchObject({ claimed: 0, sent: 0 });
    expect(r.sent).toHaveLength(3);
  });

  it("waits for a delayed notification, skips read and stale ones (claiming them)", async () => {
    const db = setup([
      note("future", { deliver_after: new Date(NOW.getTime() + 10 * 60_000).toISOString() }),
      note("read", { read_at: ago(0) }),
      note("stale", { deliver_after: new Date(NOW.getTime() - PUSH_FRESH_MS - 60_000).toISOString() }),
      note("due"),
    ]);
    const r = recorder();
    const out = await dispatchDuePush(db.client, NOW, r.send);
    expect(out.claimed).toBe(3);
    expect(r.sent.map((s) => s.title)).toEqual(["Lead due", "Lead due"]);
    const byId = Object.fromEntries(db.tables.notifications.map((n) => [n.id, n.pushed_at]));
    expect(byId.future).toBeNull();
    expect(byId.read).not.toBeNull();
    expect(byId.stale).not.toBeNull();
  });

  it("prunes a device the push service says is gone, and counts other failures", async () => {
    const db = setup([note("n1")]);
    const send: PushSender = async (s) => {
      if (s.endpoint === ENDPOINT(1)) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (s.endpoint === ENDPOINT(2)) throw Object.assign(new Error("busy"), { statusCode: 503 });
    };
    const out = await dispatchDuePush(db.client, NOW, send);
    expect(out).toMatchObject({ sent: 0, failed: 2, removed: 1 });
    expect(db.tables.push_subscriptions.map((s) => s.id).sort()).toEqual(["s2", "s3"]);
    expect(db.tables.push_subscriptions.find((s) => s.id === "s2")).toMatchObject({ failure_count: 1 });
  });

  it("an instance without the push keys leaves everything for one that has them", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    resetVapidCache();
    const db = setup([note("n1")]);
    db.tables.app_settings = [{ singleton: true, push_vapid: null }];
    const r = recorder();
    expect(await dispatchDuePush(db.client, NOW, r.send)).toMatchObject({ claimed: 0, sent: 0 });
    expect(db.tables.notifications[0].pushed_at).toBeNull();
  });

  it("people with no device on are claimed and skipped", async () => {
    const db = setup([note("n1", { user_id: "nobody" })]);
    const r = recorder();
    expect(await dispatchDuePush(db.client, NOW, r.send)).toMatchObject({ claimed: 1, sent: 0 });
  });

  it("the test push reaches every device of the caller only", async () => {
    const db = setup([]);
    const r = recorder();
    const out = await sendTestPush(db.client, "u1", r.send, NOW);
    expect(out).toMatchObject({ ready: true, devices: 2, sent: 2 });
    expect(r.sent.every((s) => s.title === "Notifications are on")).toBe(true);
  });
});

describe("push addresses", () => {
  it("only the browser vendors' push services are accepted", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    for (const bad of [
      "http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://localhost/x",
      "https://googleapis.com.evil.example/x", "https://evil-googleapis.com/x", "https://fcm.googleapis.com:8443/x",
      "https://user:pw@fcm.googleapis.com/x", "not a url", 42,
    ]) {
      expect(isAllowedPushEndpoint(bad)).toBe(false);
    }
    expect(isPushKey("BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", 40, 200)).toBe(true);
    expect(isPushKey("bad key!", 4, 200)).toBe(false);
  });
});

describe("the server's push keys", () => {
  beforeEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    resetVapidCache();
    process.env.MAILBOX_ENC_KEY = randomBytes(32).toString("base64");
  });

  it("are generated once, stored encrypted, and reused", async () => {
    const db = memorySupabase({ app_settings: [{ singleton: true, push_vapid: null }] });
    const first = await ensureVapid("https://lms.example.com", db.client);
    expect(first.ok).toBe(true);
    const stored = db.tables.app_settings[0].push_vapid as Record<string, string>;
    expect(stored.public_key).toBe(first.ok && first.keys.publicKey);
    expect(stored.private_key_enc).not.toContain(first.ok ? first.keys.privateKey : "x");
    expect(stored.subject).toBe("https://lms.example.com");

    resetVapidCache();
    const second = await ensureVapid("https://other.example", db.client);
    expect(second.ok && second.keys.publicKey).toBe(first.ok && first.keys.publicKey);
    resetVapidCache();
    expect((await getVapid(db.client))?.privateKey).toBe(first.ok && first.keys.privateKey);
  });

  it("say so plainly before the database update", async () => {
    const db = memorySupabase({});
    const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "column push_vapid does not exist" } }) }) }) }) };
    expect(await ensureVapid("https://x.example", broken as never)).toMatchObject({ ok: false, reason: expect.stringMatching(/0088/) });
    expect(db).toBeTruthy();
  });

  it("use the real https origin as the subject (Apple refuses localhost)", () => {
    expect(subjectFor("https://lms.example.com/notifications")).toBe("https://lms.example.com");
    expect(subjectFor("http://localhost:3000")).toBe("mailto:notifications@localhost");
  });
});

describe("wiring", () => {
  it("the service worker shows and opens notifications, and never touches page requests", async () => {
    const sw = await readFile("public/push-sw.js", "utf8");
    expect(sw).toMatch(/addEventListener\("push"/);
    expect(sw).toMatch(/addEventListener\("notificationclick"/);
    expect(sw).toMatch(/requireInteraction: Boolean\(data\.urgent\)/);
    expect(sw).not.toMatch(/addEventListener\("fetch"/);
    expect(sw).not.toMatch(/caches\./);
  });

  it("the worker script and the dispatcher are public to middleware, and the poller runs on prod only", async () => {
    const mw = await readFile("lib/supabase/middleware.ts", "utf8");
    expect(mw).toContain('"/push-sw.js"');
    expect(mw).toContain('"/api/push/dispatch"');
    const inst = await readFile("instrumentation.ts", "utf8");
    expect(inst.indexOf("/api/push/dispatch")).toBeGreaterThan(inst.indexOf('WGE_POLLERS_DISABLED === "1"'));
  });
});
