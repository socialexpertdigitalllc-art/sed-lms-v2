import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/mail/crypto";
import {
  PROVIDER_REGISTRY,
  getDescriptor,
  hasCompleteCredentials,
  maskCredentialHint,
  recommendedPriority,
  type ProviderDescriptor,
} from "./registry";

/**
 * User-managed provider configuration. SERVER ONLY (service role).
 *
 * The DB is authoritative. Environment variables are a ONE-TIME SEED: on the
 * first read, any provider that has no row but does have env credentials gets a
 * row created from them (enabled, in the recommended order) so an existing
 * working deployment keeps working without anyone touching the settings page.
 * After that the row wins — editing the env has no further effect.
 *
 * Credentials are stored AES-256-GCM encrypted (same key/helpers as mailboxes).
 * `getProviderConfigs()` decrypts and is for server-side callers only;
 * `getProviderConfigStatuses()` is the ONLY shape that may reach a client.
 */

export interface ProviderConfigEntry {
  key: string;
  enabled: boolean;
  priority: number;
  /** Decrypted. NEVER serialise this into an HTTP response. */
  credentials: Record<string, string> | null;
}

/** Client-safe projection: says whether a credential exists, never what it is. */
export interface ProviderConfigStatus {
  key: string;
  enabled: boolean;
  priority: number;
  configured: boolean;
  /** Username, or the last 4 of an API key. Never the secret. */
  hint: string | null;
  updatedAt: string | null;
}

type ProviderRow = {
  provider_key: string;
  enabled: boolean;
  priority: number;
  encrypted_credentials: string | null;
  updated_at: string | null;
};

/** Credentials a descriptor's env vars describe, or null when incomplete. */
export function credentialsFromEnv(
  descriptor: ProviderDescriptor,
  env: Record<string, string | undefined> = process.env
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const field of descriptor.fields) {
    const envKey = descriptor.envKeys[field.key];
    const value = (envKey ? env[envKey] : undefined) ?? "";
    if (!value.trim()) return null;
    out[field.key] = value.trim();
  }
  return out;
}

function decodeCredentials(payload: string | null): Record<string, string> | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(decryptSecret(payload)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    // A key rotation or a corrupt row must not take the chain down — the
    // provider simply reads as unconfigured.
    return null;
  }
}

function encodeCredentials(credentials: Record<string, string>): string {
  return encryptSecret(JSON.stringify(credentials));
}

/**
 * Create rows for providers that have env credentials but no row yet.
 * Idempotent and concurrency-safe: inserts ignore duplicates, so two cold
 * starts racing each other both end up with exactly one row.
 */
export async function seedProviderConfigsFromEnv(existingKeys: Set<string>): Promise<boolean> {
  const rows = PROVIDER_REGISTRY.filter((d) => !existingKeys.has(d.key))
    .map((d) => ({ descriptor: d, credentials: credentialsFromEnv(d) }))
    .filter((x): x is { descriptor: ProviderDescriptor; credentials: Record<string, string> } => x.credentials !== null)
    .map((x) => ({
      provider_key: x.descriptor.key,
      enabled: true,
      priority: recommendedPriority(x.descriptor.key),
      encrypted_credentials: encodeCredentials(x.credentials),
      updated_at: new Date().toISOString(),
    }));

  if (!rows.length) return false;
  try {
    const admin = createAdminClient();
    // ignoreDuplicates → "on conflict do nothing": never clobber a row a user edited.
    await admin.from("email_verify_providers").upsert(rows, { onConflict: "provider_key", ignoreDuplicates: true });
    return true;
  } catch {
    return false;
  }
}

async function readRows(): Promise<ProviderRow[]> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("email_verify_providers")
      .select("provider_key, enabled, priority, encrypted_credentials, updated_at");
    return (data ?? []) as ProviderRow[];
  } catch {
    return [];
  }
}

/**
 * Every configured provider, decrypted, ordered by `priority` ascending.
 * Unknown provider keys (a row left behind by a removed integration) are
 * dropped — the registry is the source of truth for what can run.
 */
export async function getProviderConfigs(): Promise<ProviderConfigEntry[]> {
  let rows = await readRows();
  const seeded = await seedProviderConfigsFromEnv(new Set(rows.map((r) => r.provider_key)));
  if (seeded) rows = await readRows();

  return rows
    .filter((r) => getDescriptor(r.provider_key) !== undefined)
    .map((r) => ({
      key: r.provider_key,
      enabled: r.enabled !== false,
      priority: typeof r.priority === "number" ? r.priority : recommendedPriority(r.provider_key),
      credentials: decodeCredentials(r.encrypted_credentials),
    }))
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

/** One entry per REGISTRY provider (even unconfigured ones), client-safe. */
export async function getProviderConfigStatuses(): Promise<ProviderConfigStatus[]> {
  let rows = await readRows();
  const seeded = await seedProviderConfigsFromEnv(new Set(rows.map((r) => r.provider_key)));
  if (seeded) rows = await readRows();
  const byKey = new Map(rows.map((r) => [r.provider_key, r]));

  return PROVIDER_REGISTRY.map((d) => {
    const row = byKey.get(d.key);
    const creds = decodeCredentials(row?.encrypted_credentials ?? null);
    return {
      key: d.key,
      enabled: row ? row.enabled !== false : false,
      priority: typeof row?.priority === "number" ? row.priority : recommendedPriority(d.key),
      configured: hasCompleteCredentials(d, creds),
      hint: maskCredentialHint(d, creds),
      updatedAt: row?.updated_at ?? null,
    };
  }).sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

export interface SaveProviderConfigInput {
  enabled?: boolean;
  priority?: number;
  /** Omit to keep the stored credentials; `null` clears them. */
  credentials?: Record<string, string> | null;
  updatedBy?: string | null;
}

/**
 * Upsert one provider's configuration. Returns the client-safe status.
 * Credentials are encrypted here; the plaintext never leaves this function.
 */
export async function saveProviderConfig(
  key: string,
  input: SaveProviderConfigInput
): Promise<ProviderConfigStatus | null> {
  const descriptor = getDescriptor(key);
  if (!descriptor) return null;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("email_verify_providers")
    .select("provider_key, enabled, priority, encrypted_credentials, updated_at")
    .eq("provider_key", key)
    .maybeSingle();
  const row = (existing ?? null) as ProviderRow | null;

  let encrypted = row?.encrypted_credentials ?? null;
  if (input.credentials === null) encrypted = null;
  else if (input.credentials !== undefined) {
    const trimmed: Record<string, string> = {};
    for (const field of descriptor.fields) {
      const v = (input.credentials[field.key] ?? "").trim();
      if (v) trimmed[field.key] = v;
    }
    encrypted = Object.keys(trimmed).length ? encodeCredentials(trimmed) : null;
  }

  const patch = {
    provider_key: key,
    enabled: input.enabled ?? (row ? row.enabled !== false : true),
    priority: input.priority ?? (typeof row?.priority === "number" ? row.priority : recommendedPriority(key)),
    encrypted_credentials: encrypted,
    updated_by: input.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("email_verify_providers").upsert(patch, { onConflict: "provider_key" });
  if (error) throw new Error(error.message);

  const creds = decodeCredentials(encrypted);
  return {
    key,
    enabled: patch.enabled,
    priority: patch.priority,
    configured: hasCompleteCredentials(descriptor, creds),
    hint: maskCredentialHint(descriptor, creds),
    updatedAt: patch.updated_at,
  };
}

/** Decrypted credentials for one provider. SERVER ONLY. */
export async function getProviderCredentials(key: string): Promise<Record<string, string> | null> {
  const configs = await getProviderConfigs();
  return configs.find((c) => c.key === key)?.credentials ?? null;
}
