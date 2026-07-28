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
        hint: secret ? `••••${secret.slice(-4)}` : null,
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

  const { data: last } = await admin
    .from("image_hosts")
    .select("position")
    .eq("provider", input.provider)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

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
    const { data: row } = await admin.from("image_hosts").select("provider").eq("id", id).single();
    const field = row ? CREDENTIAL_FIELD[row.provider as HostProvider] : null;
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

/** The chain's persistence, backed by the table. */
export function imageHostStateStore(): HostStateStore {
  const admin = createAdminClient();
  return {
    async markExhausted(hostId, until, message) {
      await admin
        .from("image_hosts")
        .update({ exhausted_until: until.toISOString(), last_error: message })
        .eq("id", hostId);
    },
    async markAuthFailed(hostId, message) {
      await admin.from("image_hosts").update({ enabled: false, last_error: message }).eq("id", hostId);
    },
    async recordSuccess(hostId) {
      const { data } = await admin.from("image_hosts").select("upload_count").eq("id", hostId).single();
      await admin
        .from("image_hosts")
        .update({
          upload_count: (data?.upload_count ?? 0) + 1,
          last_used_at: new Date().toISOString(),
          last_error: null,
          exhausted_until: null,
        })
        .eq("id", hostId);
    },
  };
}
