// lib/push/client.ts
/**
 * Browser side of desktop/phone notifications: register the push service
 * worker, subscribe with the server's key, and tell the LMS. BROWSER ONLY —
 * every function is safe to call during SSR (it just reports "unsupported").
 */

export type PushStatus =
  /** No Push API (old browser, or an in-app webview). */
  | "unsupported"
  /** iPhone/iPad Safari: push works only for a Home Screen app. */
  | "ios-install"
  /** The person (or their browser) blocked notifications for this site. */
  | "denied"
  /** Possible, not on for this browser yet. */
  | "off"
  | "on";

const SW_URL = "/push-sw.js";
const SCOPE = "/";

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as a Mac; touch points give it away.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration(SCOPE);
  if (existing && existing.active?.scriptURL.endsWith(SW_URL)) return existing;
  return null;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await registration();
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

export async function pushStatus(): Promise<PushStatus> {
  if (isIos() && !isStandalone()) return "ios-install";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

/** The server key arrives base64url; PushManager wants bytes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Whether the server can send pushes at all (keys + database update in
 *  place). The prompt and the settings card stay quiet until it can. */
export async function pushServerReady(): Promise<{ ready: boolean; reason: string | null }> {
  try {
    const res = await fetch("/api/push/config");
    const j = (await res.json().catch(() => ({}))) as { ready?: boolean; reason?: string };
    return { ready: res.ok && j.ready === true, reason: j.reason ?? null };
  } catch {
    return { ready: false, reason: null };
  }
}

async function serverKey(): Promise<{ ok: true; key: string } | { ok: false; message: string }> {
  const res = await fetch("/api/push/config");
  const j = (await res.json().catch(() => ({}))) as { ready?: boolean; publicKey?: string; reason?: string; error?: string };
  if (!res.ok || !j.ready || !j.publicKey) return { ok: false, message: j.reason ?? j.error ?? "Push isn't set up on the server yet." };
  return { ok: true, key: j.publicKey };
}

async function register(sub: PushSubscription): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await fetch("/api/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (res.ok) return { ok: true };
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: false, message: j.error ?? "Could not turn notifications on." };
}

/**
 * Turn push on for this browser. Must run from a click: browsers only show
 * the permission prompt in response to one.
 */
export async function enablePush(): Promise<{ ok: true } | { ok: false; message: string }> {
  if (isIos() && !isStandalone()) {
    return { ok: false, message: "On iPhone and iPad, add the LMS to your Home Screen first (Share → Add to Home Screen), then turn notifications on from there." };
  }
  if (!pushSupported()) return { ok: false, message: "This browser can't show notifications. Use Chrome, Edge, Firefox or Safari." };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, message: permission === "denied" ? "Notifications are blocked for this site in your browser settings." : "Notifications weren't allowed." };
  }
  const key = await serverKey();
  if (!key.ok) return key;
  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: SCOPE });
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // A subscription made against another key (e.g. before the server's key
    // existed) can't receive our pushes — replace it.
    const want = keyBytes(key.key);
    const have = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
    if (sub && (!have || have.length !== want.length || have.some((b, i) => b !== want[i]))) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    return await register(sub);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not turn notifications on." };
  }
}

/** Turn push off for this browser (the server forgets it too). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch("/api/push/subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/**
 * Quietly keep an already-allowed browser registered: after permission was
 * granted, re-send the subscription (a cheap upsert) so the server has it even
 * if it was pruned, or another person used this browser in between. Never
 * prompts.
 */
export async function syncPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const sub = await currentSubscription();
  if (sub) {
    await register(sub).catch(() => {});
    return;
  }
  // Allowed but not subscribed (cleared site data, new key): subscribe again.
  await enablePush().catch(() => {});
}
