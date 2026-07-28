import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/mail/crypto";
import type { HostProvider, HostStateStore, ImageHost } from "./types";
import { PROVIDER_RANK } from "./order";

/**
 * Operator-managed image host credentials. SERVER ONLY (service role).
 *
 * Credentials are AES-256-GCM encrypted with the same key and helpers as
 * mailboxes and AI providers. `listImageHosts()` DECRYPTS and is for server
 * callers only; `listImageHostStatuses()` is the ONLY shape that may reach a
 * client — it says whether a credential exists, never what it is.
 */

type Row = {
  id: string;
  provider: HostProvider;
  label: string;
  encrypted_credentials: string | null;
  position: number;
  enabled: boolean;
  exhausted_until: string | null;
  last_error: string | null;
  upload_count: number;
  last_used_at: string | null;
};

/** Client-safe projection. Never contains a secret. */
export type ImageHostStatus = {
  id: string;
  provider: HostProvider;
  label: string;
  position: number;
  enabled: boolean;
  configured: boolean;
  /** Last 4 characters of the key. Never the key. */
  hint: string | null;
  exhaustedUntil: string | null;
  lastError: string | null;
  uploadCount: number;
  lastUsedAt: string | null;
};

const CREDENTIAL_FIELD: Record<HostProvider, string | null> = {
  imgbb: "api_key",
  postimages: null, // no API, no keys — see the design, §8
  imgchest: "token",
};

function decrypt(row: Row): Record<string, string> | null {
  if (!row.encrypted_credentials) return null;
  try {
    return JSON.parse(decryptSecret(row.encrypted_credentials)) as Record<string, string>;
  } catch {
    return null;
  }
}

function toHost(row: Row): ImageHost {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    position: row.position,
    enabled: row.enabled,
    exhaustedUntil: row.exhausted_until ? new Date(row.exhausted_until) : null,
    credentials: decrypt(row),
  };
}

async function fetchRows(): Promise<Row[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("image_hosts")
    .select("id, provider, label, encrypted_credentials, position, enabled, exhausted_until, last_error, upload_count, last_used_at")
    .order("provider")
    .order("position");
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

/** Decrypted hosts for the upload chain. NEVER serialise these. */
export async function listImageHosts(): Promise<ImageHost[]> {
  return (await fetchRows()).map(toHost);
}

/** Client-safe list for the admin page. */
export async function listImageHostStatuses(): Promise<ImageHostStatus[]> {
  return (await fetchRows())
    .map((row) => {
      const field = CREDENTIAL_FIELD[row.provider];
      const secret = field ? decrypt(row)?.[field] ?? null : null;
      return {
        id: row.id,
        provider: row.provider,
        label: row.label,
        position: row.position,
        enabled: row.enabled,
        configured: field === null ? true : !!secret,
        // A secret of 4 characters or fewer must not be shown whole: slice(-4)
        // on a 4-char-or-shorter string returns the ENTIRE value, which would
        // defeat the mask. Mirrors maskCredentialHint in
        // lib/ai-tools/providers/registry.ts.
        hint: secret ? (secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`) : null,
        exhaustedUntil: row.exhausted_until,
        lastError: row.last_error,
        uploadCount: row.upload_count,
        lastUsedAt: row.last_used_at,
      };
    })
    .sort((a, b) => PROVIDER_RANK[a.provider] - PROVIDER_RANK[b.provider] || a.position - b.position);
}

/** Add a credential slot. New rows go to the END of their provider's order. */
export async function addImageHost(input: {
  provider: HostProvider;
  label: string;
  secret: string | null;
  createdBy: string;
}): Promise<{ id: string }> {
  const admin = createAdminClient();
  const field = CREDENTIAL_FIELD[input.provider];

  const { data: last, error: lastError } = await admin
    .from("image_hosts")
    .select("position")
    .eq("provider", input.provider)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A failed read here must not silently restart this provider's ordering at
  // 0 — that would scramble the operator's configured fallback order.
  if (lastError) throw new Error(lastError.message);

  const encrypted =
    field && input.secret?.trim() ? encryptSecret(JSON.stringify({ [field]: input.secret.trim() })) : null;

  const { data, error } = await admin
    .from("image_hosts")
    .insert({
      provider: input.provider,
      label: input.label.trim() || input.provider,
      encrypted_credentials: encrypted,
      position: (last?.position ?? -1) + 1,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string };
}

export async function updateImageHost(
  id: string,
  patch: { label?: string; enabled?: boolean; position?: number; secret?: string | null; clearError?: boolean }
): Promise<void> {
  const admin = createAdminClient();
  const update: Record<string, unknown> = {};
  if (patch.label !== undefined) update.label = patch.label.trim();
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.position !== undefined) update.position = patch.position;
  if (patch.clearError) {
    update.last_error = null;
    update.exhausted_until = null;
  }
  if (patch.secret !== undefined) {
    const { data: row, error: lookupError } = await admin
      .from("image_hosts")
      .select("provider")
      .eq("id", id)
      .single();
    // Must NOT continue on failure: `field` would fall to null below and the
    // update would CLEAR the operator's working credential instead of setting
    // it — a transient read failure must never be able to wipe a secret.
    if (lookupError || !row) throw new Error(lookupError?.message ?? "Image host not found");
    const field = CREDENTIAL_FIELD[row.provider as HostProvider];
    update.encrypted_credentials =
      field && patch.secret?.trim() ? encryptSecret(JSON.stringify({ [field]: patch.secret.trim() })) : null;
  }
  if (Object.keys(update).length === 0) return;
  const { error } = await admin.from("image_hosts").update(update).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteImageHost(id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("image_hosts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * The chain's persistence, backed by the table.
 *
 * These methods THROW on a write failure rather than swallowing it — bookkeeping
 * errors must be visible somewhere. It is the CALLER's job to decide how loud
 * that should be: `runUploadChain` (lib/photo-capture/hosts/chain.ts) already
 * wraps every one of these calls in its own `quietly()` helper, so a throw
 * here cannot sink an upload; it is simply swallowed one layer up, on purpose.
 */
export function imageHostStateStore(): HostStateStore {
  const admin = createAdminClient();
  return {
    async markExhausted(hostId, until, message) {
      const { error } = await admin
        .from("image_hosts")
        .update({ exhausted_until: until.toISOString(), last_error: message })
        .eq("id", hostId);
      if (error) throw new Error(error.message);
    },
    async markAuthFailed(hostId, message) {
      const { error } = await admin
        .from("image_hosts")
        .update({ enabled: false, last_error: message })
        .eq("id", hostId);
      if (error) throw new Error(error.message);
    },
    async recordSuccess(hostId) {
      const { data, error: readError } = await admin
        .from("image_hosts")
        .select("upload_count")
        .eq("id", hostId)
        .single();
      if (readError) throw new Error(readError.message);
      const { error } = await admin
        .from("image_hosts")
        .update({
          upload_count: (data?.upload_count ?? 0) + 1,
          last_used_at: new Date().toISOString(),
          last_error: null,
          exhausted_until: null,
        })
        .eq("id", hostId);
      if (error) throw new Error(error.message);
    },
  };
}
