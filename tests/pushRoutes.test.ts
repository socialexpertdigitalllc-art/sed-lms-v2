// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";

/**
 * The push routes: who may register a device, what a click does, and that a
 * message really survives the trip through web-push's encryption.
 */

const state = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, db: null as unknown as MemoryDb }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db.client }));

import { POST as subscribe, DELETE as unsubscribe, GET as devices } from "@/app/api/push/subscriptions/route";
import { GET as open } from "@/app/api/notifications/[id]/open/route";
import { webPushSender } from "@/lib/push/dispatch";

const P256 = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
const json = (body: unknown, method = "POST") =>
  new Request("http://lms.test/api/push/subscriptions", { method, body: JSON.stringify(body), headers: { "user-agent": "Chrome on Windows" } });

beforeEach(() => {
  state.user = { id: "u1" };
  state.db = memorySupabase({
    push_subscriptions: [],
    notifications: [
      { id: "n1", user_id: "u1", target_url: "/tickets/7", lead_id: null, read_at: null },
      { id: "n2", user_id: "u2", target_url: "/tickets/8", lead_id: null, read_at: null },
      { id: "n3", user_id: "u1", target_url: "https://evil.example", lead_id: "L9", read_at: null },
    ],
  });
});

describe("POST/DELETE /api/push/subscriptions", () => {
  it("registers this browser for the signed-in person", async () => {
    const res = await subscribe(json({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: P256, auth: AUTH } }));
    expect(res.status).toBe(200);
    expect(state.db.tables.push_subscriptions).toEqual([
      expect.objectContaining({ user_id: "u1", endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: P256, auth: AUTH, user_agent: "Chrome on Windows" }),
    ]);
    const list = await devices(new Request("http://lms.test/api/push/subscriptions?endpoint=" + encodeURIComponent("https://fcm.googleapis.com/fcm/send/abc")));
    expect(await list.json()).toMatchObject({ devices: 1, thisDevice: true });
  });

  it("refuses anything but a browser push service, and bad keys", async () => {
    for (const endpoint of ["https://169.254.169.254/latest/meta-data", "http://fcm.googleapis.com/x", "https://example.com/push"]) {
      const res = await subscribe(json({ endpoint, keys: { p256dh: P256, auth: AUTH } }));
      expect(res.status).toBe(422);
    }
    expect((await subscribe(json({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "short", auth: AUTH } }))).status).toBe(422);
    expect(state.db.tables.push_subscriptions).toHaveLength(0);
  });

  it("needs a signed-in person", async () => {
    state.user = null;
    expect((await subscribe(json({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: P256, auth: AUTH } }))).status).toBe(401);
  });

  it("removes only the caller's own device", async () => {
    state.db.tables.push_subscriptions.push(
      { id: "s1", user_id: "u1", endpoint: "https://fcm.googleapis.com/mine", p256dh: P256, auth: AUTH },
      { id: "s2", user_id: "u2", endpoint: "https://fcm.googleapis.com/theirs", p256dh: P256, auth: AUTH },
    );
    await unsubscribe(json({ endpoint: "https://fcm.googleapis.com/theirs" }, "DELETE"));
    await unsubscribe(json({ endpoint: "https://fcm.googleapis.com/mine" }, "DELETE"));
    expect(state.db.tables.push_subscriptions.map((s) => s.id)).toEqual(["s2"]);
  });
});

describe("GET /api/notifications/[id]/open (a notification click)", () => {
  const go = (id: string) => open(new Request(`http://lms.test/api/notifications/${id}/open`), { params: Promise.resolve({ id }) });

  it("marks the notification read and lands on its page", async () => {
    const res = await go("n1");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/tickets/7");
    expect(state.db.tables.notifications.find((n) => n.id === "n1")?.read_at).not.toBeNull();
  });

  it("never touches someone else's notification, never leaves the site", async () => {
    expect((await go("n2")).headers.get("location")).toBe("/notifications");
    expect(state.db.tables.notifications.find((n) => n.id === "n2")?.read_at).toBeNull();
    expect((await go("n3")).headers.get("location")).toBe("/leads/L9");
  });

  it("signed out → log in first", async () => {
    state.user = null;
    expect((await go("n1")).headers.get("location")).toBe("/login");
  });
});

describe("web-push really carries the message", () => {
  it("the payload decrypts on the device side, with urgency and TTL headers", async () => {
    const vapid = webpush.generateVAPIDKeys();
    const device = createECDH("prime256v1");
    device.generateKeys();
    const authSecret = randomBytes(16);
    const sub = {
      id: "s1", user_id: "u1", endpoint: "https://fcm.googleapis.com/fcm/send/xyz",
      p256dh: device.getPublicKey().toString("base64url"), auth: authSecret.toString("base64url"),
    };
    const spy = vi.spyOn(webpush, "sendNotification").mockImplementation(async (subscription, payload, options) => {
      const details = webpush.generateRequestDetails(subscription, payload as string, options);
      expect(details.headers.Urgency).toBe("high");
      expect(details.headers.TTL).toBe(21600);
      expect(details.endpoint).toBe(sub.endpoint);
      // Decrypt exactly as the browser would (RFC 8291, aes128gcm).
      // http_ece ships no types; it is web-push's own encryption dependency.
      const ece = (await import("http_ece" as string)) as { decrypt: (b: Buffer, o: Record<string, unknown>) => Buffer };
      const plain = ece.decrypt(details.body as Buffer, { version: "aes128gcm", privateKey: device, authSecret });
      expect(JSON.parse(plain.toString("utf8"))).toMatchObject({ title: "Ticket assigned", urgent: true, url: "/api/notifications/n1/open" });
      return { statusCode: 201, body: "", headers: {} };
    });
    await webPushSender(
      sub,
      { id: "n1", title: "Ticket assigned", body: "Fix the header", url: "/api/notifications/n1/open", tag: "n-n1", urgent: true, ts: 1 },
      { publicKey: vapid.publicKey, privateKey: vapid.privateKey, subject: "https://lms.example.com" },
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
