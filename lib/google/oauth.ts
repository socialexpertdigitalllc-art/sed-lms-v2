import { decryptSecret } from "@/lib/mail/crypto";
import { getGoogleConnection } from "@/lib/google/connection";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

/** Full drive + documents so we can list a folder, copy, edit, and export. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "openid",
  "email",
].join(" ");

/** Pure: build the consent-screen URL for a CSRF `state`. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "",
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchange an auth code for tokens + the connected account email. */
export async function exchangeCode(code: string): Promise<{
  refreshToken: string;
  accessToken: string;
  email: string;
  expiresAt: number;
}> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "",
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { refresh_token?: string; access_token: string; expires_in: number };
  if (!data.refresh_token) {
    throw new Error("Google returned no refresh token — revoke the app's access and reconnect (prompt=consent).");
  }
  const uiRes = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${data.access_token}` } });
  const ui = uiRes.ok ? ((await uiRes.json()) as { email?: string }) : {};
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    email: ui.email ?? "",
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// In-memory access-token cache (per server process). Refreshed 60s before expiry.
let cachedToken: { token: string; expiresAt: number } | null = null;

/** A valid access token, refreshing from the stored refresh token as needed. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const conn = await getGoogleConnection();
  if (!conn) throw new Error("Google is not connected");
  const refreshToken = decryptSecret(conn.encrypted_refresh_token);
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

/** Test-only: reset the in-memory token cache. */
export function __resetTokenCache(): void {
  cachedToken = null;
}
