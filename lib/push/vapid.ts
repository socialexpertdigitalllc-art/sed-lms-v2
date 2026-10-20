// lib/push/vapid.ts
/**
 * The server's Web Push identity (VAPID key pair). SERVER ONLY.
 *
 * Environment variables win when set (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
 * optional VAPID_SUBJECT). Otherwise the pair is generated ONCE, the first
 * time a browser asks for it, and kept in app_settings.push_vapid with the
 * private key encrypted (MAILBOX_ENC_KEY) — so turning push on needs no
 * hosting-panel step. Changing the pair later would orphan every browser's
 * subscription, which is why it is generated exactly once and never rotated
 * here.
 */
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/mail/crypto";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** mailto: or https: — push services use it to reach the sender. */
  subject: string;
}

interface StoredVapid {
  public_key?: unknown;
  private_key_enc?: unknown;
  subject?: unknown;
  created_at?: unknown;
}

let cached: VapidKeys | null = null;

/** https://lms.example.com → itself; anything else (dev on http) → a mailto
 *  at that host. Apple's push service refuses a localhost subject, so prod's
 *  real https origin is what gets stored. */
export function subjectFor(origin: string | null | undefined): string {
  try {
    const u = new URL(origin ?? "");
    if (u.protocol === "https:") return u.origin;
    return `mailto:notifications@${u.hostname || "localhost"}`;
  } catch {
    return "mailto:notifications@localhost";
  }
}

function fromEnv(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT?.trim() || subjectFor(process.env.WGE_SELF_ORIGIN) };
}

function decode(raw: StoredVapid | null | undefined): VapidKeys | null {
  if (!raw || typeof raw.public_key !== "string" || typeof raw.private_key_enc !== "string") return null;
  try {
    return {
      publicKey: raw.public_key,
      privateKey: decryptSecret(raw.private_key_enc),
      subject: typeof raw.subject === "string" && raw.subject ? raw.subject : subjectFor(null),
    };
  } catch {
    // A rotated MAILBOX_ENC_KEY makes the stored key unreadable; push simply
    // reads as not set up rather than throwing in every caller.
    return null;
  }
}

async function readStored(admin: SupabaseClient): Promise<{ keys: VapidKeys | null; available: boolean }> {
  const { data, error } = await admin.from("app_settings").select("push_vapid").eq("singleton", true).maybeSingle();
  if (error) return { keys: null, available: false }; // migration 0088 not applied yet
  return { keys: decode((data as { push_vapid?: StoredVapid | null } | null)?.push_vapid), available: true };
}

/** The key pair if one exists — the dispatcher's read. Never generates. */
export async function getVapid(admin: SupabaseClient = createAdminClient()): Promise<VapidKeys | null> {
  if (cached) return cached;
  const env = fromEnv();
  if (env) return (cached = env);
  const { keys } = await readStored(admin);
  if (keys) cached = keys;
  return keys;
}

/**
 * The key pair, generating and storing it on first use. `origin` is the
 * requesting page's origin (becomes the subject). Concurrency-safe: the write
 * only lands while the column is still empty, and a loser re-reads the
 * winner's pair, so every browser subscribes against the same key.
 */
export async function ensureVapid(
  origin: string | null,
  admin: SupabaseClient = createAdminClient(),
): Promise<{ ok: true; keys: VapidKeys } | { ok: false; reason: string }> {
  const existing = await getVapid(admin);
  if (existing) return { ok: true, keys: existing };
  const { available } = await readStored(admin);
  if (!available) return { ok: false, reason: "The database needs update 0088 (push notifications) first." };

  const pair = webpush.generateVAPIDKeys();
  let privateKeyEnc: string;
  try {
    privateKeyEnc = encryptSecret(pair.privateKey);
  } catch {
    return { ok: false, reason: "Push needs MAILBOX_ENC_KEY (or VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) on the server." };
  }
  const stored = {
    public_key: pair.publicKey,
    private_key_enc: privateKeyEnc,
    subject: subjectFor(origin),
    created_at: new Date().toISOString(),
  };
  await admin.from("app_settings").update({ push_vapid: stored }).eq("singleton", true).is("push_vapid", null);
  const { keys } = await readStored(admin);
  if (!keys) return { ok: false, reason: "Could not store the push keys." };
  cached = keys;
  return { ok: true, keys };
}

/** Tests only. */
export function resetVapidCache(): void {
  cached = null;
}
