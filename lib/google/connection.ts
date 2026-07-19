import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/mail/crypto";

export interface GoogleConnectionRow {
  id: string;
  singleton: boolean;
  account_email: string | null;
  encrypted_refresh_token: string;
  scope: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
}

/** The single active Google connection row, or null when disconnected. */
export async function getGoogleConnection(): Promise<GoogleConnectionRow | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("google_connection").select("*").eq("singleton", true).maybeSingle();
  return (data as GoogleConnectionRow | null) ?? null;
}

/** Upsert the single connection, encrypting the refresh token. */
export async function saveGoogleConnection(input: {
  refreshToken: string;
  email: string;
  scope: string;
  userId: string;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from("google_connection").upsert(
    {
      singleton: true,
      account_email: input.email,
      encrypted_refresh_token: encryptSecret(input.refreshToken),
      scope: input.scope,
      connected_by: input.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "singleton" }
  );
}

export async function clearGoogleConnection(): Promise<void> {
  const admin = createAdminClient();
  await admin.from("google_connection").delete().eq("singleton", true);
}

export async function getGoogleStatus(): Promise<{ connected: boolean; account_email: string | null }> {
  const conn = await getGoogleConnection();
  return { connected: !!conn, account_email: conn?.account_email ?? null };
}
