# Google Docs Contract Templates + Full Mailbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OAuth-connected Google Docs contract templates (copy → merge → export PDF, react-pdf kept as fallback) and a full in-dashboard mailbox (live IMAP read + SMTP send) to the already-merged email+contracts system.

**Architecture:** Two additive sub-projects on the shared prod DB. **A (Google templates):** an app-wide "Connect Google" OAuth connection (encrypted refresh token, reusing `lib/mail/crypto.ts`), raw `fetch` to Google REST (no `googleapis` SDK), a Drive-folder-backed template registry, and a contract-create flow that copies a template doc, runs Docs `replaceAllText`, exports a PDF, and stores it — falling back to react-pdf when no Google template is chosen. **B (Mailbox):** per-request `imapflow` read + `nodemailer` send, both resolved from the logged-in user's own verified mailbox via the existing `getMailboxForUser` seam, with received HTML rendered in a script-less sandboxed iframe.

**Tech Stack:** Next.js 16 (App Router, `runtime = "nodejs"` route handlers, awaited `params`/`cookies`), TypeScript, Supabase (service-role admin client + RLS), `imapflow`, `nodemailer` (+ `nodemailer/lib/mail-composer`), `@react-pdf/renderer` (fallback), Vitest (jsdom + node env), Zod, Tailwind, lucide-react.

---

## Conventions (read before every task)

- **This is NOT the Next.js you know** (per `AGENTS.md`). Before writing a route/page, skim the matching guide under `node_modules/next/dist/docs/`. All patterns below are copied from **verified** files in this repo (Next 16): route params are `Promise` and must be awaited; `createClient()` from `@/lib/supabase/server` is async; `cookies()` from `next/headers` is async.
- **Server auth guard** (verified in `app/api/admin/mail/mailboxes/route.ts`): `const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser();` then `const perms = await getUserPermissions(user.id);` — `perms` is a `Set<string>`, test with `perms.has("<key>")`.
- **Admin DB access:** `createAdminClient()` from `@/lib/supabase/admin` (service role, bypasses RLS) — only after a permission check.
- **Secrets:** encrypt with `encryptSecret` / decrypt with `decryptSecret` from `@/lib/mail/crypto` (AES-256-GCM, key `MAILBOX_ENC_KEY`). Never return a secret column to the client; never log plaintext.
- **`export const runtime = "nodejs";`** on every route handler in this plan (they use node crypto / imapflow / nodemailer / admin client).
- **Tests** live in `tests/` (flat), run under Vitest globals. Node-only tests start with `// @vitest-environment node`. Run a single file with `npx vitest run tests/<file>.test.ts`. Typecheck with `npx tsc --noEmit`.
- **Constraints for the whole plan:** keep the dev server DOWN; commits are LOCAL only (no push); run the production build (`NODE_OPTIONS=--max-old-space-size=6144 npm run build`) ONLY in the final task; each task ends with a commit whose trailer is exactly:

  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```

---

## File Structure

**Sub-project A — Google templates**

- `supabase/migrations/0037_google_templates_and_mailbox.sql` — CREATE: all additive schema for A **and** B (single reviewed migration).
- `lib/permissions/constants.ts` — MODIFY: add `integrations.manage` permission + `integrations` category.
- `lib/google/oauth.ts` — CREATE: `buildAuthUrl` (pure, tested), `exchangeCode`, `getAccessToken` (network).
- `lib/google/connection.ts` — CREATE: DB seam for the single `google_connection` row (get/save/clear/status).
- `lib/google/drive.ts` — CREATE: `listDocsInFolder`, `copyDoc`, `renameFile`, `exportPdf`, `docUrl` (network).
- `lib/google/docs.ts` — CREATE: `getDocText`, `replaceAllText` (network).
- `lib/contracts/placeholders.ts` — CREATE: `extractPlaceholders`, `buildReplacements`, `SUPPORTED_PLACEHOLDERS`, `unmappedPlaceholders` (pure, tested).
- `app/api/admin/google/connect/route.ts` — CREATE: GET → redirect to Google consent.
- `app/api/admin/google/callback/route.ts` — CREATE: GET → exchange code + store connection.
- `app/api/admin/google/disconnect/route.ts` — CREATE: POST → clear connection.
- `app/api/admin/google/status/route.ts` — CREATE: GET → `{ connected, account_email }`.
- `app/api/admin/contract-templates/folder/route.ts` — CREATE: PUT → save folder id to `app_settings`.
- `app/api/admin/contract-templates/available/route.ts` — CREATE: GET → folder docs + which are registered.
- `app/api/admin/contract-templates/route.ts` — CREATE: POST → register a template (409 on dup).
- `app/api/admin/contract-templates/[id]/refresh/route.ts` — CREATE: POST → re-pull name+placeholders.
- `app/api/admin/contract-templates/[id]/route.ts` — CREATE: DELETE → remove a template.
- `app/api/contract-templates/route.ts` — CREATE: GET → registered templates for the composer.
- `lib/settings/appSettings.ts` — MODIFY: add `contract_templates_folder_id` to type + select.
- `components/contracts/ContractTemplatesManager.tsx` — CREATE: admin UI (connection + folder + available + registered).
- `app/(app)/admin/contract-templates/page.tsx` — CREATE: server page wiring the manager.
- `lib/contracts/types.ts` — MODIFY: add `google_template_id` / `generated_doc_id` / `generated_doc_url` to `ContractRow`.
- `lib/contracts/schema.ts` — MODIFY: allow optional `google_template_id` on create.
- `app/api/contracts/route.ts` — MODIFY: Google create-flow (copy→replace→export→store) + react-pdf fallback.
- `app/api/contracts/[id]/pdf/route.ts` — MODIFY: serve stored PDF whenever `pdf_path` is set.
- `app/api/contracts/[id]/send/route.ts` — MODIFY: attach the stored PDF when present.
- `components/contracts/ContractComposer.tsx` — MODIFY: template selector lists Google templates.
- `components/layout/Sidebar.tsx` — MODIFY: add "Contract Templates" (admin) + "Mailbox" (conditional) nav.

**Sub-project B — Mailbox**

- `lib/mail/message.ts` — CREATE: pure helpers (address/preview/attachment/folder), tested.
- `lib/mail/imap.ts` — CREATE: `listMessages`, `getMessage`, `markSeen`, `appendToSent`, `getAttachment` (network).
- `lib/mail/guard.ts` — CREATE: `requireOwnMailbox` route guard.
- `lib/mail/sendSchema.ts` — CREATE: Zod schema for the send route.
- `app/api/mail/status/route.ts` — CREATE: GET → `{ hasMailbox }`.
- `app/api/mail/messages/route.ts` — CREATE: GET → list.
- `app/api/mail/messages/[uid]/route.ts` — CREATE: GET → single message.
- `app/api/mail/messages/[uid]/seen/route.ts` — CREATE: POST → mark seen.
- `app/api/mail/messages/[uid]/attachment/route.ts` — CREATE: GET → download a part.
- `app/api/mail/send/route.ts` — CREATE: POST → send + Sent append.
- `hooks/useHasMailbox.ts` — CREATE: client hook for conditional nav.
- `components/mail/Mailbox.tsx` — CREATE: folder switch + list + sandboxed reading pane + compose/reply.
- `app/(app)/mailbox/page.tsx` — CREATE: server page (verified-mailbox gate).

**Tests**

- `tests/contractPlaceholders.test.ts`, `tests/googleOauth.test.ts`, `tests/mailMessage.test.ts`.

---

# Sub-project A — Google Docs contract templates

## Task 1: Additive migration, permission, and env

**Files:**
- Create: `supabase/migrations/0037_google_templates_and_mailbox.sql`
- Modify: `lib/permissions/constants.ts`
- Modify: `.env.example`, `.env.local` (env docs; `.env.local` is git-ignored — do NOT commit it)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0037_google_templates_and_mailbox.sql`:

```sql
-- 0037_google_templates_and_mailbox.sql — Google Docs contract templates + full mailbox
-- ADDITIVE ONLY. Shared prod DB (ikuvbxjkoojtgekapbul): new tables + nullable
-- columns + permission rows only. No drops, no type changes, no destructive edits.

-- App-wide single Google OAuth connection. The refresh token is AES-256-GCM
-- ciphertext (encrypted app-side) and is NEVER selected into a client response.
-- `singleton` enforces exactly one active row (upsert onConflict, like app_settings).
create table if not exists public.google_connection (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique,
  account_email text,
  encrypted_refresh_token text not null,
  scope text,
  connected_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Registry of Google Docs templates pulled from the configured Drive folder.
-- google_doc_id UNIQUE => a doc can be registered at most once (409 on dup add).
create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  google_doc_id text not null unique,
  name text not null default '',
  placeholders text[] not null default '{}',
  synced_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Contracts: link the chosen Google template + the generated Drive doc. All
-- nullable => a react-pdf contract (google_template_id null) still works.
alter table public.contracts
  add column if not exists google_template_id uuid references public.contract_templates(id) on delete set null,
  add column if not exists generated_doc_id text,
  add column if not exists generated_doc_url text;

-- Drive folder id holding the template docs — a single editable setting.
alter table public.app_settings
  add column if not exists contract_templates_folder_id text;

-- RLS
alter table public.google_connection enable row level security;
alter table public.contract_templates enable row level security;

-- google_connection: NO policies. Holds a credential — service-role only.

-- contract_templates: readable by users who can send contracts or manage
-- integrations; writes via the service role in permission-gated routes.
create policy "read contract templates" on public.contract_templates for select to authenticated
  using (public.has_permission('contracts.send') or public.has_permission('integrations.manage'));

-- permissions
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('integrations.manage','Manage Integrations (Google, Templates)',null,'integrations',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'integrations.manage' from public.departments d where d.slug in ('admin')
on conflict do nothing;
```

- [ ] **Step 2: Register the new permission in the static catalog**

In `lib/permissions/constants.ts`, add one entry to the `PERMISSIONS` array (place it just after the `mail.manage` line) — note `as const` is on the array, so insert a plain object literal:

```ts
  { key: "integrations.manage", name: "Manage Integrations (Google, Templates)", category: "integrations", is_sensitive: true },
```

Then add `"integrations"` to `PERMISSION_CATEGORIES`:

```ts
export const PERMISSION_CATEGORIES = ["leads", "pre_leads", "analytics", "ai_tools", "admin", "tickets", "feedback", "dashboard", "payments", "templates", "mail", "contracts", "integrations"] as const;
```

- [ ] **Step 3: Document the new env vars**

Append to `.env.example`:

```
# Google OAuth (Drive + Docs) for contract templates
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=https://<app-host>/api/admin/google/callback
```

Add the same keys with real values to `.env.local` (git-ignored) for local runs. One-time user setup (documented, not automated): create a Google Cloud OAuth 2.0 Web client, add the redirect URI above, enable the Drive API + Docs API, and add the operator's Google account as a test user.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (new permission key is additive; nothing references the new tables yet).

- [ ] **Step 5: Commit** (do NOT stage `.env.local`)

```bash
git add supabase/migrations/0037_google_templates_and_mailbox.sql lib/permissions/constants.ts .env.example
git commit -m "feat(migrations): additive 0037 — google_connection, contract_templates, contract columns, integrations.manage

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

> The migration is applied to the shared prod DB as a separate reviewed step (out of band). Do not run it against prod from within task execution.

---

## Task 2: Google OAuth library (`buildAuthUrl` TDD + exchange/refresh)

**Files:**
- Create: `lib/google/connection.ts`
- Create: `lib/google/oauth.ts`
- Test: `tests/googleOauth.test.ts`

- [ ] **Step 1: Write the DB seam (`connection.ts`)**

`lib/google/connection.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing test for `buildAuthUrl`**

`tests/googleOauth.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { buildAuthUrl, GOOGLE_SCOPES } from "@/lib/google/oauth";

describe("buildAuthUrl", () => {
  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-123.apps.googleusercontent.com";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://app.test/api/admin/google/callback";
  });

  it("targets Google's consent endpoint", () => {
    expect(buildAuthUrl("st8")).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
  });

  it("requests offline access with forced consent so a refresh token is always returned", () => {
    const url = new URL(buildAuthUrl("st8"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("carries the client id, redirect uri, state, and Drive+Docs scopes", () => {
    const url = new URL(buildAuthUrl("st8"));
    expect(url.searchParams.get("client_id")).toBe("client-123.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.test/api/admin/google/callback");
    expect(url.searchParams.get("state")).toBe("st8");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_SCOPES);
    expect(GOOGLE_SCOPES).toContain("https://www.googleapis.com/auth/drive");
    expect(GOOGLE_SCOPES).toContain("https://www.googleapis.com/auth/documents");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/googleOauth.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/google/oauth"` / `buildAuthUrl is not a function`.

- [ ] **Step 4: Implement `oauth.ts`**

`lib/google/oauth.ts`:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/googleOauth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/google/connection.ts lib/google/oauth.ts tests/googleOauth.test.ts
git commit -m "feat(google): OAuth lib — buildAuthUrl (tested), exchangeCode, getAccessToken + connection seam

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Google connect / callback / disconnect / status routes

**Files:**
- Create: `app/api/admin/google/connect/route.ts`
- Create: `app/api/admin/google/callback/route.ts`
- Create: `app/api/admin/google/disconnect/route.ts`
- Create: `app/api/admin/google/status/route.ts`

- [ ] **Step 1: Connect route (redirect to consent, set CSRF cookie)**

`app/api/admin/google/connect/route.ts`:

```ts
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { buildAuthUrl } from "@/lib/google/oauth";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const state = randomUUID();
  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set("g_oauth_state", state, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600,
  });
  return res;
}
```

- [ ] **Step 2: Callback route (verify state, exchange, store)**

`app/api/admin/google/callback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { exchangeCode, GOOGLE_SCOPES } from "@/lib/google/oauth";
import { saveGoogleConnection } from "@/lib/google/connection";

export const runtime = "nodejs";

const DEST = "/admin/contract-templates";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  const jar = await cookies();
  const expected = jar.get("g_oauth_state")?.value;
  const origin = url.origin;

  const fail = (reason: string) => {
    const r = NextResponse.redirect(`${origin}${DEST}?google_error=${encodeURIComponent(reason)}`);
    r.cookies.set("g_oauth_state", "", { path: "/", maxAge: 0 });
    return r;
  };

  if (err) return fail(err);
  if (!code) return fail("missing_code");
  if (!state || !expected || state !== expected) return fail("state_mismatch");

  try {
    const { refreshToken, email } = await exchangeCode(code);
    await saveGoogleConnection({ refreshToken, email, scope: GOOGLE_SCOPES, userId: user.id });
    await createAdminClient().from("activity_log").insert({
      user_id: user.id, action: "google.connected", entity_type: "google_connection",
      new_value: { account_email: email },
    });
  } catch (e) {
    return fail((e as Error).message);
  }

  const ok = NextResponse.redirect(`${origin}${DEST}?google_connected=1`);
  ok.cookies.set("g_oauth_state", "", { path: "/", maxAge: 0 });
  return ok;
}
```

- [ ] **Step 3: Disconnect route**

`app/api/admin/google/disconnect/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { clearGoogleConnection } from "@/lib/google/connection";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await clearGoogleConnection();
  await createAdminClient().from("activity_log").insert({
    user_id: user.id, action: "google.disconnected", entity_type: "google_connection",
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Status route**

`app/api/admin/google/status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getGoogleStatus } from "@/lib/google/connection";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json(await getGoogleStatus());
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/google/
git commit -m "feat(google): connect/callback/disconnect/status routes with CSRF state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Google Drive + Docs REST wrappers

**Files:**
- Create: `lib/google/drive.ts`
- Create: `lib/google/docs.ts`

- [ ] **Step 1: Drive wrapper**

`lib/google/drive.ts`:

```ts
import { getAccessToken } from "@/lib/google/oauth";

const DRIVE = "https://www.googleapis.com/drive/v3";

async function authHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}` };
}

export interface DriveDoc {
  id: string;
  name: string;
  modifiedTime: string;
}

/** List Google Docs (not folders/other files) inside a Drive folder. */
export async function listDocsInFolder(folderId: string): Promise<DriveDoc[]> {
  const q = `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`;
  const params = new URLSearchParams({
    q,
    fields: "files(id,name,modifiedTime)",
    orderBy: "name",
    pageSize: "100",
  });
  const res = await fetch(`${DRIVE}/files?${params.toString()}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { files?: DriveDoc[] };
  return data.files ?? [];
}

/** Copy a doc, returning the new file id. */
export async function copyDoc(fileId: string, name: string): Promise<string> {
  const res = await fetch(`${DRIVE}/files/${fileId}/copy`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Drive copy failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function renameFile(fileId: string, name: string): Promise<void> {
  const res = await fetch(`${DRIVE}/files/${fileId}`, {
    method: "PATCH",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Drive rename failed: ${res.status} ${await res.text()}`);
}

/** Export a Google Doc as PDF bytes. */
export async function exportPdf(fileId: string): Promise<Uint8Array> {
  const res = await fetch(`${DRIVE}/files/${fileId}/export?mimeType=application/pdf`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`Drive export failed: ${res.status} ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Human-facing edit URL for a generated doc. */
export function docUrl(fileId: string): string {
  return `https://docs.google.com/document/d/${fileId}/edit`;
}
```

- [ ] **Step 2: Docs wrapper**

`lib/google/docs.ts`:

```ts
import { getAccessToken } from "@/lib/google/oauth";

const DOCS = "https://docs.googleapis.com/v1/documents";

async function authHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}` };
}

type DocElement = {
  paragraph?: { elements?: { textRun?: { content?: string } }[] };
  table?: { tableRows?: { tableCells?: { content?: DocElement[] }[] }[] };
};

function flattenDocText(content: DocElement[]): string {
  let out = "";
  for (const el of content) {
    if (el.paragraph?.elements) {
      for (const pe of el.paragraph.elements) {
        if (pe.textRun?.content) out += pe.textRun.content;
      }
    } else if (el.table?.tableRows) {
      for (const row of el.table.tableRows) {
        for (const cell of row.tableCells ?? []) {
          out += flattenDocText(cell.content ?? []);
        }
      }
    }
  }
  return out;
}

/** Fetch a doc's title and its flattened plain text (for placeholder detection). */
export async function getDocText(docId: string): Promise<{ title: string; text: string }> {
  const res = await fetch(`${DOCS}/${docId}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Docs get failed: ${res.status} ${await res.text()}`);
  const doc = (await res.json()) as { title?: string; body?: { content?: DocElement[] } };
  return { title: doc.title ?? "", text: flattenDocText(doc.body?.content ?? []) };
}

/** Replace every `{{token}}` occurrence — one replaceAllText request per token. */
export async function replaceAllText(
  docId: string,
  replacements: { token: string; value: string }[]
): Promise<void> {
  const requests = replacements.map((r) => ({
    replaceAllText: { containsText: { text: r.token, matchCase: true }, replaceText: r.value },
  }));
  const res = await fetch(`${DOCS}/${docId}:batchUpdate`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) throw new Error(`Docs batchUpdate failed: ${res.status} ${await res.text()}`);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/google/drive.ts lib/google/docs.ts
git commit -m "feat(google): Drive (list/copy/rename/export) + Docs (getText/replaceAllText) REST wrappers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Placeholder detection + replacement mapping (pure, TDD)

**Files:**
- Create: `lib/contracts/placeholders.ts`
- Test: `tests/contractPlaceholders.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/contractPlaceholders.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ContractSnapshot } from "@/lib/contracts/types";
import {
  extractPlaceholders,
  buildReplacements,
  SUPPORTED_PLACEHOLDERS,
  unmappedPlaceholders,
} from "@/lib/contracts/placeholders";

const snapshot: ContractSnapshot = {
  business_name: "Acme Plumbing",
  business_phone: "+1 555 111 2222",
  business_email: "owner@acme.test",
  one_time_price: 1200,
  yearly_price: 300,
  agent_name: "Jordan",
  contract_date: "2026-07-19",
};

describe("extractPlaceholders", () => {
  it("returns unique {{token}} strings in first-seen order", () => {
    const text = "Hi {{business_name}}, total {{one_time_price}} for {{business_name}}.";
    expect(extractPlaceholders(text)).toEqual(["{{business_name}}", "{{one_time_price}}"]);
  });
  it("tolerates internal whitespace and normalizes to {{token}}", () => {
    expect(extractPlaceholders("{{ agent_name }}")).toEqual(["{{agent_name}}"]);
  });
  it("returns [] when there are no placeholders", () => {
    expect(extractPlaceholders("no tokens here")).toEqual([]);
  });
});

describe("buildReplacements", () => {
  it("maps every supported token to a formatted snapshot value", () => {
    const map = new Map(buildReplacements(snapshot).map((r) => [r.token, r.value]));
    expect(map.get("{{business_name}}")).toBe("Acme Plumbing");
    expect(map.get("{{one_time_price}}")).toBe("$1,200.00");
    expect(map.get("{{yearly_price}}")).toBe("$300.00");
    expect(map.get("{{date}}")).toBe("2026-07-19");
    expect(map.get("{{provider_name}}")).toBe("Social Expert Digital");
    expect(map.get("{{provider_phone}}")).toBe("(252) 401-2775");
    expect(map.get("{{provider_email}}")).toBe("socialexpertdigitalllc@gmail.com");
  });
  it("covers exactly the SUPPORTED_PLACEHOLDERS set", () => {
    const tokens = buildReplacements(snapshot).map((r) => r.token).sort();
    expect(tokens).toEqual([...SUPPORTED_PLACEHOLDERS].sort());
  });
  it("renders null prices as an em dash", () => {
    const map = new Map(
      buildReplacements({ ...snapshot, one_time_price: null, yearly_price: null }).map((r) => [r.token, r.value])
    );
    expect(map.get("{{one_time_price}}")).toBe("—");
  });
});

describe("unmappedPlaceholders", () => {
  it("flags tokens a template uses that we don't support", () => {
    const found = ["{{business_name}}", "{{signature_image}}", "{{date}}"];
    expect(unmappedPlaceholders(found)).toEqual(["{{signature_image}}"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/contractPlaceholders.test.ts`
Expected: FAIL — cannot resolve `@/lib/contracts/placeholders`.

- [ ] **Step 3: Implement `placeholders.ts`**

`lib/contracts/placeholders.ts`:

```ts
import type { ContractSnapshot } from "@/lib/contracts/types";
import { formatUsd } from "@/lib/contracts/merge";
import { SERVICE_PROVIDER } from "@/lib/contracts/provider";

/** All tokens the merge engine knows how to fill (see design A4). */
export const SUPPORTED_PLACEHOLDERS = [
  "{{business_name}}",
  "{{business_phone}}",
  "{{business_email}}",
  "{{one_time_price}}",
  "{{yearly_price}}",
  "{{date}}",
  "{{agent_name}}",
  "{{provider_name}}",
  "{{provider_phone}}",
  "{{provider_email}}",
] as const;

/** Unique `{{token}}` strings in first-seen order (whitespace-tolerant). */
export function extractPlaceholders(text: string): string[] {
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = `{{${m[1]}}}`;
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

/** Map supported tokens → formatted snapshot values (design A4). */
export function buildReplacements(s: ContractSnapshot): { token: string; value: string }[] {
  return [
    { token: "{{business_name}}", value: s.business_name || "" },
    { token: "{{business_phone}}", value: s.business_phone || "" },
    { token: "{{business_email}}", value: s.business_email || "" },
    { token: "{{one_time_price}}", value: formatUsd(s.one_time_price) },
    { token: "{{yearly_price}}", value: formatUsd(s.yearly_price) },
    { token: "{{date}}", value: s.contract_date },
    { token: "{{agent_name}}", value: s.agent_name || "" },
    { token: "{{provider_name}}", value: SERVICE_PROVIDER.name },
    { token: "{{provider_phone}}", value: SERVICE_PROVIDER.phone },
    { token: "{{provider_email}}", value: SERVICE_PROVIDER.email },
  ];
}

/** Tokens a template uses that we can't fill — surfaced in the UI as "unmapped". */
export function unmappedPlaceholders(found: string[]): string[] {
  const supported = new Set<string>(SUPPORTED_PLACEHOLDERS);
  return found.filter((t) => !supported.has(t));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/contractPlaceholders.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/contracts/placeholders.ts tests/contractPlaceholders.test.ts
git commit -m "feat(contracts): placeholder extraction + snapshot replacement mapping (tested)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Templates-folder setting + registry routes

**Files:**
- Modify: `lib/settings/appSettings.ts`
- Create: `app/api/admin/contract-templates/folder/route.ts`
- Create: `app/api/admin/contract-templates/available/route.ts`
- Create: `app/api/admin/contract-templates/route.ts`
- Create: `app/api/admin/contract-templates/[id]/refresh/route.ts`
- Create: `app/api/admin/contract-templates/[id]/route.ts`
- Create: `app/api/contract-templates/route.ts`

- [ ] **Step 1: Extend `AppSettings` with the folder id**

In `lib/settings/appSettings.ts`, add the field to the `AppSettings` type and to the default and the select. Apply these three edits:

Add to the `AppSettings` type (after `logo_path`):

```ts
  contract_templates_folder_id: string | null;
```

Add to `DEFAULT_APP_SETTINGS` (after `logo_path: null,`):

```ts
  contract_templates_folder_id: null,
```

Extend the select string in `getAppSettings` to include the new column:

```ts
    .select("work_start_time, work_timezone, idle_timeout_minutes, ticket_sla, ticket_retention_days, company_name, logo_path, contract_templates_folder_id")
```

- [ ] **Step 2: Folder-save route**

`app/api/admin/contract-templates/folder/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";

export const runtime = "nodejs";

const schema = z.object({ folder_id: z.string().trim().max(200) });

export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 422 });

  const admin = createAdminClient();
  const { error } = await admin.from("app_settings").upsert(
    { singleton: true, contract_templates_folder_id: parsed.data.folder_id || null, updated_at: new Date().toISOString(), updated_by: user.id },
    { onConflict: "singleton" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ contract_templates_folder_id: parsed.data.folder_id || null });
}
```

- [ ] **Step 3: Available-docs route**

`app/api/admin/contract-templates/available/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAppSettings } from "@/lib/settings/appSettings";
import { listDocsInFolder } from "@/lib/google/drive";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const settings = await getAppSettings();
  const folderId = settings.contract_templates_folder_id;
  if (!folderId) return NextResponse.json({ folderMissing: true, docs: [] });

  const admin = createAdminClient();
  const { data: registered } = await admin.from("contract_templates").select("google_doc_id");
  const registeredIds = new Set((registered ?? []).map((r) => r.google_doc_id));

  try {
    const docs = await listDocsInFolder(folderId);
    return NextResponse.json({
      docs: docs.map((d) => ({ ...d, registered: registeredIds.has(d.id) })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, docs: [] }, { status: 502 });
  }
}
```

- [ ] **Step 4: Register-template route (POST)**

`app/api/admin/contract-templates/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getDocText } from "@/lib/google/docs";
import { extractPlaceholders } from "@/lib/contracts/placeholders";

export const runtime = "nodejs";

const schema = z.object({ google_doc_id: z.string().trim().min(1).max(200) });

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 422 });

  let doc: { title: string; text: string };
  try {
    doc = await getDocText(parsed.data.google_doc_id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  const placeholders = extractPlaceholders(doc.text);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contract_templates")
    .insert({
      google_doc_id: parsed.data.google_doc_id,
      name: doc.title || "Untitled template",
      placeholders,
      synced_at: new Date().toISOString(),
      created_by: user.id,
    })
    .select("id, google_doc_id, name, placeholders, synced_at")
    .single();

  if (error || !data) {
    const dup = error?.code === "23505";
    return NextResponse.json(
      { error: dup ? "That document is already added as a template" : error?.message ?? "Insert failed" },
      { status: dup ? 409 : 400 }
    );
  }
  return NextResponse.json({ template: data }, { status: 201 });
}
```

- [ ] **Step 5: Refresh route**

`app/api/admin/contract-templates/[id]/refresh/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getDocText } from "@/lib/google/docs";
import { extractPlaceholders } from "@/lib/contracts/placeholders";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: row } = await admin.from("contract_templates").select("google_doc_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  let doc: { title: string; text: string };
  try {
    doc = await getDocText(row.google_doc_id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const { data, error } = await admin
    .from("contract_templates")
    .update({ name: doc.title || "Untitled template", placeholders: extractPlaceholders(doc.text), synced_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, google_doc_id, name, placeholders, synced_at")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  return NextResponse.json({ template: data });
}
```

- [ ] **Step 6: Delete route**

`app/api/admin/contract-templates/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { error } = await admin.from("contract_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Composer list route**

`app/api/contract-templates/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getGoogleStatus } from "@/lib/google/connection";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("contracts.send")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("contract_templates")
    .select("id, name, placeholders")
    .order("name", { ascending: true });
  const status = await getGoogleStatus();
  return NextResponse.json({ connected: status.connected, templates: data ?? [] });
}
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add lib/settings/appSettings.ts app/api/admin/contract-templates/ app/api/contract-templates/
git commit -m "feat(contracts): templates folder setting + registry routes (available/add/refresh/remove/list)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: Admin → Contract Templates UI + nav

**Files:**
- Create: `components/contracts/ContractTemplatesManager.tsx`
- Create: `app/(app)/admin/contract-templates/page.tsx`
- Modify: `components/layout/Sidebar.tsx`

- [ ] **Step 1: Build the manager component**

`components/contracts/ContractTemplatesManager.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plug, RefreshCw, Trash2, Plus, FolderInput, CheckCircle2, AlertTriangle } from "lucide-react";
import { Field, FormSection, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { SUPPORTED_PLACEHOLDERS } from "@/lib/contracts/placeholders";

export type RegisteredTemplate = { id: string; google_doc_id: string; name: string; placeholders: string[]; synced_at: string | null };
export type AvailableDoc = { id: string; name: string; modifiedTime: string; registered: boolean };
type GoogleStatus = { connected: boolean; account_email: string | null };

function unmapped(placeholders: string[]): string[] {
  const supported = new Set<string>(SUPPORTED_PLACEHOLDERS);
  return placeholders.filter((p) => !supported.has(p));
}

export function ContractTemplatesManager({
  status,
  folderId,
  available,
  folderMissing,
  registered,
}: {
  status: GoogleStatus;
  folderId: string;
  available: AvailableDoc[];
  folderMissing: boolean;
  registered: RegisteredTemplate[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<RegisteredTemplate[]>(registered);
  const [docs, setDocs] = useState<AvailableDoc[]>(available);
  const [folder, setFolder] = useState(folderId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingFolder, setSavingFolder] = useState(false);

  async function disconnect() {
    if (!confirm("Disconnect Google? Existing contracts keep their stored PDFs, but new Google-template contracts will fail until reconnected.")) return;
    const res = await fetch("/api/admin/google/disconnect", { method: "POST" });
    if (!res.ok) { toast({ kind: "error", title: "Disconnect failed" }); return; }
    toast({ kind: "success", title: "Google disconnected" });
    router.refresh();
  }

  async function saveFolder(e: React.FormEvent) {
    e.preventDefault();
    setSavingFolder(true);
    try {
      const res = await fetch("/api/admin/contract-templates/folder", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder_id: folder }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Save failed", body: data.error }); return; }
      toast({ kind: "success", title: "Folder saved" });
      router.refresh();
    } finally { setSavingFolder(false); }
  }

  async function addDoc(id: string) {
    setBusyId(id);
    try {
      const res = await fetch("/api/admin/contract-templates", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ google_doc_id: id }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Add failed", body: data.error }); return; }
      setRows((prev) => [...prev, data.template]);
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, registered: true } : d)));
      toast({ kind: "success", title: "Template added" });
    } finally { setBusyId(null); }
  }

  async function refresh(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/contract-templates/${id}/refresh`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Refresh failed", body: data.error }); return; }
      setRows((prev) => prev.map((r) => (r.id === id ? data.template : r)));
      toast({ kind: "success", title: "Template refreshed" });
    } finally { setBusyId(null); }
  }

  async function remove(id: string) {
    if (!confirm("Remove this template from the registry? The Google Doc is not deleted.")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/contract-templates/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); toast({ kind: "error", title: "Remove failed", body: d.error }); return; }
      const removed = rows.find((r) => r.id === id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      if (removed) setDocs((prev) => prev.map((d) => (d.id === removed.google_doc_id ? { ...d, registered: false } : d)));
      toast({ kind: "success", title: "Template removed" });
    } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-6">
      {/* Connection */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-text"><Plug className="w-4 h-4" /> Google connection</div>
        {status.connected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <CheckCircle2 className="w-4 h-4 text-ready-fg" /> Connected as <span className="font-medium text-text">{status.account_email || "—"}</span>
            </div>
            <button onClick={disconnect} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-2">Disconnect</button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-muted">Not connected. Connect a Google account with access to the templates folder.</p>
            <a href="/api/admin/google/connect" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink">Connect Google</a>
          </div>
        )}
      </div>

      {/* Folder */}
      <form onSubmit={saveFolder} className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-text"><FolderInput className="w-4 h-4" /> Templates folder</div>
        <Field label="Google Drive folder ID" hint="From the folder URL: drive.google.com/drive/folders/<THIS_ID>">
          <input className={inputCls} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="1AbC…" />
        </Field>
        <div className="flex justify-end">
          <button type="submit" disabled={savingFolder} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
            {savingFolder ? "Saving…" : "Save folder"}
          </button>
        </div>
      </form>

      {/* Available */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="text-sm font-semibold text-text">Available docs in folder</div>
        {folderMissing ? (
          <p className="text-xs text-text-faint">Set a folder ID above to list template docs.</p>
        ) : docs.length === 0 ? (
          <p className="text-xs text-text-faint">No Google Docs found in that folder.</p>
        ) : (
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-text">{d.name}</span>
                <button
                  onClick={() => addDoc(d.id)}
                  disabled={d.registered || busyId === d.id}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text hover:bg-surface-2 disabled:opacity-50"
                >
                  {d.registered ? "Added" : <><Plus className="w-3.5 h-3.5" /> Add</>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Registered */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="text-sm font-semibold text-text">Registered templates</div>
        {rows.length === 0 ? (
          <p className="text-xs text-text-faint">No templates registered yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const bad = unmapped(r.placeholders);
              return (
                <li key={r.id} className="py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text">{r.name}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => refresh(r.id)} disabled={busyId === r.id} title="Refresh" className="p-1.5 rounded text-text-muted hover:text-text hover:bg-surface-2 disabled:opacity-50">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button onClick={() => remove(r.id)} disabled={busyId === r.id} title="Remove" className="p-1.5 rounded text-text-muted hover:text-dropped-fg hover:bg-surface-2 disabled:opacity-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {r.placeholders.length === 0 && <span className="text-[11px] text-text-faint">No placeholders detected.</span>}
                    {r.placeholders.map((p) => (
                      <span key={p} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-muted font-mono">{p}</span>
                    ))}
                  </div>
                  {bad.length > 0 && (
                    <div className="flex items-center gap-1 text-[11px] text-dropped-fg">
                      <AlertTriangle className="w-3.5 h-3.5" /> Unmapped (left as-is): {bad.join(", ")}
                    </div>
                  )}
                  <div className="text-[11px] text-text-faint">Last synced {r.synced_at ? new Date(r.synced_at).toLocaleString() : "—"}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build the server page**

`app/(app)/admin/contract-templates/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getAppSettings } from "@/lib/settings/appSettings";
import { getGoogleStatus } from "@/lib/google/connection";
import { listDocsInFolder } from "@/lib/google/drive";
import { ContractTemplatesManager, type AvailableDoc, type RegisteredTemplate } from "@/components/contracts/ContractTemplatesManager";

export default async function ContractTemplatesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("integrations.manage")) redirect("/dashboard");

  const admin = createAdminClient();
  const status = await getGoogleStatus();
  const settings = await getAppSettings();
  const folderId = settings.contract_templates_folder_id ?? "";

  const { data: registeredRaw } = await admin
    .from("contract_templates")
    .select("id, google_doc_id, name, placeholders, synced_at")
    .order("name", { ascending: true });
  const registered = (registeredRaw ?? []) as RegisteredTemplate[];
  const registeredIds = new Set(registered.map((r) => r.google_doc_id));

  let available: AvailableDoc[] = [];
  let folderMissing = !folderId;
  if (folderId && status.connected) {
    try {
      const docs = await listDocsInFolder(folderId);
      available = docs.map((d) => ({ ...d, registered: registeredIds.has(d.id) }));
    } catch {
      available = [];
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">Contract Templates</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Connect Google, point at a Drive folder of template docs, and register the ones agents can use. Contracts copy the doc, fill{" "}
          <span className="font-mono text-xs">{"{{placeholders}}"}</span>, and export a PDF.
        </p>
      </div>
      <ContractTemplatesManager status={status} folderId={folderId} available={available} folderMissing={folderMissing} registered={registered} />
    </div>
  );
}
```

- [ ] **Step 3: Add the admin nav item**

In `components/layout/Sidebar.tsx`, add to the `ADMIN` array (after the Company Mail entry). `LayoutTemplate` is already imported:

```ts
  { href: "/admin/contract-templates", label: "Contract Templates", icon: LayoutTemplate, perm: "integrations.manage" },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/contracts/ContractTemplatesManager.tsx "app/(app)/admin/contract-templates/page.tsx" components/layout/Sidebar.tsx
git commit -m "feat(contracts): admin Contract Templates UI (connection, folder, available, registered) + nav

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: Contract create-flow via Google template + composer wiring

**Files:**
- Modify: `lib/contracts/types.ts`
- Modify: `lib/contracts/schema.ts`
- Modify: `app/api/contracts/route.ts`
- Modify: `app/api/contracts/[id]/pdf/route.ts`
- Modify: `app/api/contracts/[id]/send/route.ts`
- Modify: `components/contracts/ContractComposer.tsx`

- [ ] **Step 1: Extend `ContractRow`**

In `lib/contracts/types.ts`, add three fields to the `ContractRow` interface (after `pdf_path: string | null;`):

```ts
  google_template_id: string | null;
  generated_doc_id: string | null;
  generated_doc_url: string | null;
```

- [ ] **Step 2: Allow `google_template_id` on create**

In `lib/contracts/schema.ts`, add one field to `createContractSchema`:

```ts
export const createContractSchema = z.object({
  lead_id: z.string().uuid(),
  mailbox_id: z.string().uuid(),
  template_key: z.string().trim().min(1).max(60).default("standard"),
  google_template_id: z.string().uuid().nullable().optional(),
  message_body: z.string().trim().max(5000).default(""),
});
```

- [ ] **Step 3: Rewrite the create route with the Google flow + react-pdf fallback**

Replace the body of `app/api/contracts/route.ts` from the `const snapshot = ...` line onward. The full file:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { createContractSchema } from "@/lib/contracts/schema";
import { buildContractSnapshot, validateMergeFields } from "@/lib/contracts/merge";
import { isContractTemplateKey } from "@/lib/contracts/templates";
import { buildReplacements } from "@/lib/contracts/placeholders";
import { copyDoc, exportPdf, docUrl } from "@/lib/google/drive";
import { replaceAllText } from "@/lib/google/docs";
import type { Lead } from "@/lib/leads/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("contracts.send")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createContractSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }
  const input = parsed.data;
  if (!isContractTemplateKey(input.template_key)) {
    return NextResponse.json({ error: "Unknown contract template" }, { status: 422 });
  }

  const admin = createAdminClient();

  const { data: leadRaw } = await admin.from("leads").select("*").eq("id", input.lead_id).is("deleted_at", null).maybeSingle();
  if (!leadRaw) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const lead = leadRaw as Lead;

  const check = validateMergeFields(lead);
  if (!check.ok) {
    return NextResponse.json({ error: "Missing required fields", missing: check.missing }, { status: 422 });
  }

  const { data: mailbox } = await admin.from("company_mailboxes").select("id, status").eq("id", input.mailbox_id).maybeSingle();
  if (!mailbox) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
  if (mailbox.status !== "verified") return NextResponse.json({ error: "Selected mailbox is not verified" }, { status: 409 });

  const { data: profile } = await admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const agentName = profile?.display_name ?? "";
  const contractDate = new Date().toISOString().slice(0, 10);
  const snapshot = buildContractSnapshot(lead, { agentName, contractDate });

  // Resolve the Google template (if chosen).
  let googleDocId: string | null = null;
  if (input.google_template_id) {
    const { data: tpl } = await admin
      .from("contract_templates")
      .select("id, google_doc_id")
      .eq("id", input.google_template_id)
      .maybeSingle();
    if (!tpl) return NextResponse.json({ error: "Selected template not found" }, { status: 404 });
    googleDocId = tpl.google_doc_id;
  }

  // Insert the draft first so we own an id for the stored PDF path.
  const { data: contract, error } = await admin
    .from("contracts")
    .insert({
      lead_id: input.lead_id,
      created_by: user.id,
      mailbox_id: input.mailbox_id,
      template_key: input.template_key,
      google_template_id: input.google_template_id ?? null,
      business_name: snapshot.business_name,
      business_phone: snapshot.business_phone,
      business_email: snapshot.business_email,
      one_time_price: snapshot.one_time_price,
      yearly_price: snapshot.yearly_price,
      agent_name: snapshot.agent_name,
      contract_date: snapshot.contract_date,
      message_body: input.message_body,
      recipient_email: snapshot.business_email,
      status: "draft",
    })
    .select("*")
    .single();
  if (error || !contract) return NextResponse.json({ error: error?.message ?? "Create failed" }, { status: 400 });

  // Google path: copy → replaceAllText → export PDF → store. On any failure,
  // delete the just-created draft so we don't leave a broken record.
  if (googleDocId) {
    try {
      const name = `Contract — ${snapshot.business_name || "Client"} — ${contractDate}`;
      const newDocId = await copyDoc(googleDocId, name);
      await replaceAllText(newDocId, buildReplacements(snapshot));
      const pdf = await exportPdf(newDocId);
      const pdfPath = `${contract.id}.pdf`;
      await admin.storage.from("contracts").upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });
      await admin
        .from("contracts")
        .update({ pdf_path: pdfPath, generated_doc_id: newDocId, generated_doc_url: docUrl(newDocId) })
        .eq("id", contract.id);
      contract.pdf_path = pdfPath;
      contract.generated_doc_id = newDocId;
      contract.generated_doc_url = docUrl(newDocId);
    } catch (e) {
      await admin.from("contracts").delete().eq("id", contract.id);
      return NextResponse.json({ error: `Google template generation failed: ${(e as Error).message}` }, { status: 502 });
    }
  }

  await admin.from("activity_log").insert({
    user_id: user.id, action: "contract.created", entity_type: "contract", entity_id: contract.id,
    new_value: { lead_id: input.lead_id, google: !!googleDocId },
  });

  return NextResponse.json({ contract }, { status: 201 });
}
```

- [ ] **Step 4: Serve the stored PDF whenever present**

In `app/api/contracts/[id]/pdf/route.ts`, change the stored-PDF condition so Google drafts (which already have `pdf_path`) serve the stored file. Replace:

```ts
  // Sent contracts serve their retained PDF; drafts render live from the snapshot.
  if (contract.status === "sent" && contract.pdf_path) {
```

with:

```ts
  // Any contract with a stored PDF (Google-generated draft, or a sent contract)
  // serves the retained file; react-pdf drafts render live from the snapshot.
  if (contract.pdf_path) {
```

- [ ] **Step 5: Attach the stored PDF on send when present**

In `app/api/contracts/[id]/send/route.ts`, replace the render block:

```ts
  // Render the final PDF from the immutable snapshot.
  const sig = await signatureRenderArgs(contract.created_by ?? user.id);
  const pdf = await renderContractPdf(
    {
      business_name: contract.business_name, business_phone: contract.business_phone,
      business_email: contract.business_email, one_time_price: contract.one_time_price,
      yearly_price: contract.yearly_price, agent_name: contract.agent_name, contract_date: contract.contract_date,
    },
    sig,
    contract.template_key
  );
```

with:

```ts
  // Prefer the already-stored PDF (Google-template path). Otherwise render
  // react-pdf live from the immutable snapshot (fallback path).
  let pdf: Buffer;
  if (contract.pdf_path) {
    const { data: blob } = await admin.storage.from("contracts").download(contract.pdf_path);
    if (!blob) return NextResponse.json({ error: "Stored contract PDF is missing" }, { status: 409 });
    pdf = Buffer.from(await blob.arrayBuffer());
  } else {
    const sig = await signatureRenderArgs(contract.created_by ?? user.id);
    pdf = await renderContractPdf(
      {
        business_name: contract.business_name, business_phone: contract.business_phone,
        business_email: contract.business_email, one_time_price: contract.one_time_price,
        yearly_price: contract.yearly_price, agent_name: contract.agent_name, contract_date: contract.contract_date,
      },
      sig,
      contract.template_key
    );
  }
```

> The existing lines further down (`const pdfPath = ...; await admin.storage...upload(...)`) stay as-is; re-uploading the same bytes to `${contract.id}.pdf` is idempotent (`upsert: true`).

- [ ] **Step 6: Wire the composer's template selector**

Replace `components/contracts/ContractComposer.tsx` with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Send, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";

type Mailbox = { id: string; email_address: string; display_name: string };
type Template = { id: string; name: string; placeholders: string[] };

const BUILTIN_VALUE = "builtin:standard";

export function ContractComposer({
  leadId,
  mailboxes,
  onClose,
}: {
  leadId: string;
  mailboxes: Mailbox[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [connected, setConnected] = useState(false);
  const [selection, setSelection] = useState<string>(BUILTIN_VALUE);
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? "");
  const [message, setMessage] = useState("Hi,\n\nPlease find your website services agreement attached. Let me know if you have any questions.\n\nThank you.");
  const [contractId, setContractId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/contract-templates")
      .then((r) => r.json())
      .then((d: { connected: boolean; templates: Template[] }) => {
        setConnected(!!d.connected);
        setTemplates(d.templates ?? []);
        if ((d.templates ?? []).length > 0) setSelection(`google:${d.templates[0].id}`);
      })
      .catch(() => {});
  }, []);

  async function createDraft() {
    setBusy(true);
    try {
      const google_template_id = selection.startsWith("google:") ? selection.slice("google:".length) : null;
      const res = await fetch("/api/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, mailbox_id: mailboxId, template_key: "standard", google_template_id, message_body: message }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.missing ? `Missing: ${data.missing.join(", ")}` : data.error;
        toast({ kind: "error", title: "Cannot create contract", body: detail });
        return;
      }
      setContractId(data.contract.id);
      toast({ kind: "success", title: "Draft ready — review the preview below" });
    } finally { setBusy(false); }
  }

  async function send() {
    if (!contractId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Send failed", body: data.error }); return; }
      toast({ kind: "success", title: "Contract sent" });
      onClose();
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-surface p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-text"><FileText className="w-4 h-4" /> New contract</div>
          <button onClick={onClose} className="p-1 rounded text-text-faint hover:text-text"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Template">
            <select className={inputCls} value={selection} onChange={(e) => setSelection(e.target.value)} disabled={!!contractId}>
              {templates.map((t) => <option key={t.id} value={`google:${t.id}`}>{t.name}</option>)}
              <option value={BUILTIN_VALUE}>Built-in — Website Development Agreement (no Google)</option>
            </select>
          </Field>
          <Field label="Send from" required>
            <select className={inputCls} value={mailboxId} onChange={(e) => setMailboxId(e.target.value)} disabled={!!contractId}>
              {mailboxes.length === 0 && <option value="">No verified mailbox</option>}
              {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email_address}</option>)}
            </select>
          </Field>
        </div>

        {templates.length === 0 && (
          <p className="text-xs text-text-faint">
            {connected
              ? "No Google templates registered yet. An admin can add them in Admin → Contract Templates. Using the built-in template."
              : "Google is not connected. An admin can connect it in Admin → Contract Templates. Using the built-in template."}
          </p>
        )}

        <Field label="Cover message">
          <textarea className={cn(inputCls, "min-h-[120px]")} value={message} onChange={(e) => setMessage(e.target.value)} disabled={!!contractId} />
        </Field>

        {!contractId ? (
          <div className="flex justify-end">
            <button onClick={createDraft} disabled={busy || !mailboxId} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
              {busy ? "Preparing…" : "Create & preview"}
            </button>
          </div>
        ) : (
          <>
            <div className="rounded-md border border-border overflow-hidden" style={{ height: 480 }}>
              <iframe title="Contract preview" src={`/api/contracts/${contractId}/pdf`} className="w-full h-full" />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-faint">Review carefully. Sending emails the PDF from the selected mailbox.</p>
              <button onClick={send} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
                <Send className="w-4 h-4" /> {busy ? "Sending…" : "Send contract"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Confirm the placeholder test still passes and typecheck**

Run: `npx vitest run tests/contractPlaceholders.test.ts tests/contractMerge.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/contracts/types.ts lib/contracts/schema.ts app/api/contracts/route.ts "app/api/contracts/[id]/pdf/route.ts" "app/api/contracts/[id]/send/route.ts" components/contracts/ContractComposer.tsx
git commit -m "feat(contracts): Google-template create flow (copy/replace/export/store) + composer selector, react-pdf fallback kept

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# Sub-project B — Full mailbox

## Task 9: Mail message pure helpers (TDD)

**Files:**
- Create: `lib/mail/message.ts`
- Test: `tests/mailMessage.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/mailMessage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatAddress, formatAddressList, makePreview, hasAttachments, normalizeFolder } from "@/lib/mail/message";

describe("formatAddress / formatAddressList", () => {
  it("renders 'Name <email>' when a name is present", () => {
    expect(formatAddress({ name: "Jane Doe", address: "jane@x.test" })).toBe("Jane Doe <jane@x.test>");
  });
  it("falls back to the bare address when there's no name", () => {
    expect(formatAddress({ address: "jane@x.test" })).toBe("jane@x.test");
  });
  it("returns '' for missing/addressless input", () => {
    expect(formatAddress(undefined)).toBe("");
    expect(formatAddress({ name: "Nobody" })).toBe("");
  });
  it("joins a list with commas, dropping empties", () => {
    expect(formatAddressList([{ name: "A", address: "a@x.test" }, { address: "b@x.test" }])).toBe("A <a@x.test>, b@x.test");
    expect(formatAddressList([])).toBe("");
    expect(formatAddressList(undefined)).toBe("");
  });
});

describe("makePreview", () => {
  it("collapses whitespace and trims", () => {
    expect(makePreview("  hello\n\t world  ")).toBe("hello world");
  });
  it("truncates with an ellipsis past the limit", () => {
    expect(makePreview("abcdefghij", 5)).toBe("abcd…");
  });
  it("returns '' for empty input", () => {
    expect(makePreview("")).toBe("");
    expect(makePreview(null)).toBe("");
  });
});

describe("hasAttachments", () => {
  it("detects a node disposed as attachment", () => {
    expect(hasAttachments({ childNodes: [{ type: "text/plain" }, { disposition: "attachment", type: "application/pdf" }] })).toBe(true);
  });
  it("is false for a plain text-only structure", () => {
    expect(hasAttachments({ type: "text/plain" })).toBe(false);
  });
  it("is false for null", () => {
    expect(hasAttachments(null)).toBe(false);
  });
});

describe("normalizeFolder", () => {
  it("maps 'sent' (any case) to Sent", () => {
    expect(normalizeFolder("Sent")).toBe("Sent");
    expect(normalizeFolder("SENT")).toBe("Sent");
  });
  it("defaults everything else to INBOX", () => {
    expect(normalizeFolder("INBOX")).toBe("INBOX");
    expect(normalizeFolder("Junk")).toBe("INBOX");
    expect(normalizeFolder(undefined)).toBe("INBOX");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/mailMessage.test.ts`
Expected: FAIL — cannot resolve `@/lib/mail/message`.

- [ ] **Step 3: Implement `message.ts`**

`lib/mail/message.ts`:

```ts
export type MailAddress = { name?: string | null; address?: string | null };

/** "Name <email>" | "email" | "" */
export function formatAddress(a: MailAddress | undefined | null): string {
  if (!a || !a.address) return "";
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

export function formatAddressList(list: MailAddress[] | undefined | null): string {
  if (!list || list.length === 0) return "";
  return list.map(formatAddress).filter(Boolean).join(", ");
}

/** Collapse whitespace, trim, truncate with an ellipsis (default 140 chars). */
export function makePreview(text: string | undefined | null, max = 140): string {
  if (!text) return "";
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

type BodyNode = { disposition?: string | null; type?: string | null; childNodes?: BodyNode[] | null };

/** True if any part of the bodystructure is an attachment. */
export function hasAttachments(node: BodyNode | undefined | null): boolean {
  if (!node) return false;
  if (node.disposition && node.disposition.toLowerCase() === "attachment") return true;
  if (node.childNodes) return node.childNodes.some((c) => hasAttachments(c));
  return false;
}

/** Canonicalize a client-supplied folder to the small allowlist we support. */
export function normalizeFolder(folder: string | undefined | null): "INBOX" | "Sent" {
  if (folder && folder.trim().toLowerCase() === "sent") return "Sent";
  return "INBOX";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/mailMessage.test.ts`
Expected: PASS (14 assertions across 4 groups).

- [ ] **Step 5: Commit**

```bash
git add lib/mail/message.ts tests/mailMessage.test.ts
git commit -m "feat(mail): pure message helpers — address/preview/attachment/folder (tested)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: IMAP read/send seams (`lib/mail/imap.ts`)

**Files:**
- Create: `lib/mail/imap.ts`

- [ ] **Step 1: Implement the IMAP wrapper**

`lib/mail/imap.ts`:

```ts
import { ImapFlow, type ListResponse } from "imapflow";
import { Readable } from "stream";
import { buildImapConfig } from "@/lib/mail/config";
import type { ResolvedMailbox } from "@/lib/mail/types";
import { formatAddressList, makePreview, hasAttachments, normalizeFolder } from "@/lib/mail/message";

export interface MailListItem {
  uid: number;
  from: string;
  subject: string;
  date: string;
  seen: boolean;
  preview: string;
  hasAttachments: boolean;
}
export interface MailListResult {
  total: number;
  messages: MailListItem[];
}
export interface MailAttachment {
  filename: string;
  size: number;
  partId: string;
}
export interface MailFull {
  from: string;
  to: string;
  subject: string;
  date: string;
  html: string | null;
  text: string | null;
  attachments: MailAttachment[];
}

type BodyStruct = {
  part?: string;
  type?: string;
  disposition?: string | null;
  parameters?: Record<string, string>;
  dispositionParameters?: Record<string, string>;
  size?: number;
  childNodes?: BodyStruct[];
};

function newClient(m: ResolvedMailbox): ImapFlow {
  return new ImapFlow({ ...buildImapConfig(m), logger: false });
}

async function resolvePath(client: ImapFlow, folder: "INBOX" | "Sent"): Promise<string> {
  if (folder === "INBOX") return "INBOX";
  const list = (await client.list()) as ListResponse[];
  const sent =
    list.find((b) => b.specialUse === "\\Sent") ??
    list.find((b) => /(^|[./])sent($|[./])/i.test(b.path));
  return sent?.path ?? "INBOX.Sent";
}

function firstPart(node: BodyStruct | undefined, mime: string): string | undefined {
  if (!node) return undefined;
  const isAttach = (node.disposition ?? "").toLowerCase() === "attachment";
  if ((node.type ?? "").toLowerCase() === mime && !isAttach) return node.part ?? "1";
  for (const child of node.childNodes ?? []) {
    const found = firstPart(child, mime);
    if (found) return found;
  }
  return undefined;
}

function collectAttachments(node: BodyStruct | undefined): MailAttachment[] {
  const out: MailAttachment[] = [];
  const walk = (n: BodyStruct) => {
    const filename = n.dispositionParameters?.filename || n.parameters?.name;
    const isAttach = (n.disposition ?? "").toLowerCase() === "attachment" || !!filename;
    if (isAttach && n.part) {
      out.push({ filename: filename || `part-${n.part}`, size: n.size ?? 0, partId: n.part });
    }
    for (const c of n.childNodes ?? []) walk(c);
  };
  if (node) walk(node);
  return out;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Page a folder newest-first. page 1 = the newest `pageSize` messages. */
export async function listMessages(
  m: ResolvedMailbox,
  opts: { folder?: string; page?: number; pageSize?: number }
): Promise<MailListResult> {
  const folder = normalizeFolder(opts.folder);
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 25));
  const client = newClient(m);
  await client.connect();
  try {
    const path = await resolvePath(client, folder);
    const mailbox = await client.mailboxOpen(path, { readOnly: true });
    const total = mailbox.exists;
    if (total === 0) return { total: 0, messages: [] };
    const end = total - (page - 1) * pageSize;
    if (end < 1) return { total, messages: [] };
    const start = Math.max(1, end - pageSize + 1);

    const messages: MailListItem[] = [];
    for await (const msg of client.fetch(
      `${start}:${end}`,
      { uid: true, envelope: true, flags: true, bodyStructure: true, bodyParts: ["1"] }
    )) {
      const previewBuf = msg.bodyParts?.get("1");
      const preview = previewBuf ? makePreview(previewBuf.toString("utf8")) : "";
      messages.push({
        uid: msg.uid,
        from: formatAddressList(msg.envelope?.from),
        subject: msg.envelope?.subject || "(no subject)",
        date: (msg.envelope?.date ?? new Date()).toISOString(),
        seen: msg.flags?.has("\\Seen") ?? false,
        preview,
        hasAttachments: hasAttachments(msg.bodyStructure as unknown as BodyStruct),
      });
    }
    messages.reverse(); // newest first
    return { total, messages };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Full message by UID: html/text bodies + attachment metadata. */
export async function getMessage(m: ResolvedMailbox, folderInput: string, uid: number): Promise<MailFull | null> {
  const folder = normalizeFolder(folderInput);
  const client = newClient(m);
  await client.connect();
  try {
    const path = await resolvePath(client, folder);
    await client.mailboxOpen(path, { readOnly: true });
    const meta = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true }, { uid: true });
    if (!meta) return null;
    const struct = meta.bodyStructure as unknown as BodyStruct;

    let html: string | null = null;
    let text: string | null = null;
    const htmlPart = firstPart(struct, "text/html");
    const textPart = firstPart(struct, "text/plain");
    if (htmlPart) {
      const dl = await client.download(String(uid), htmlPart, { uid: true });
      if (dl?.content) html = (await streamToBuffer(dl.content)).toString("utf8");
    }
    if (textPart) {
      const dl = await client.download(String(uid), textPart, { uid: true });
      if (dl?.content) text = (await streamToBuffer(dl.content)).toString("utf8");
    }

    return {
      from: formatAddressList(meta.envelope?.from),
      to: formatAddressList(meta.envelope?.to),
      subject: meta.envelope?.subject || "(no subject)",
      date: (meta.envelope?.date ?? new Date()).toISOString(),
      html,
      text,
      attachments: collectAttachments(struct),
    };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export async function markSeen(m: ResolvedMailbox, folderInput: string, uid: number): Promise<void> {
  const folder = normalizeFolder(folderInput);
  const client = newClient(m);
  await client.connect();
  try {
    const path = await resolvePath(client, folder);
    await client.mailboxOpen(path, { readOnly: false });
    await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Best-effort append of a raw RFC822 message to the Sent folder. */
export async function appendToSent(m: ResolvedMailbox, raw: Buffer): Promise<void> {
  const client = newClient(m);
  await client.connect();
  try {
    const path = await resolvePath(client, "Sent");
    await client.append(path, raw, ["\\Seen"]);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Download one attachment part for the download route. */
export async function getAttachment(
  m: ResolvedMailbox,
  folderInput: string,
  uid: number,
  partId: string
): Promise<{ content: Buffer; filename: string; contentType: string } | null> {
  const folder = normalizeFolder(folderInput);
  const client = newClient(m);
  await client.connect();
  try {
    const path = await resolvePath(client, folder);
    await client.mailboxOpen(path, { readOnly: true });
    const dl = await client.download(String(uid), partId, { uid: true });
    if (!dl?.content) return null;
    return {
      content: await streamToBuffer(dl.content),
      filename: dl.meta?.filename || `attachment-${partId}`,
      contentType: dl.meta?.contentType || "application/octet-stream",
    };
  } finally {
    await client.logout().catch(() => client.close());
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (These are thin network wrappers — not unit-tested; exercised via the routes + live acceptance.)

- [ ] **Step 3: Commit**

```bash
git add lib/mail/imap.ts
git commit -m "feat(mail): imapflow read/send seams — list/get/markSeen/appendToSent/getAttachment

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: Mail read routes + own-mailbox guard

**Files:**
- Create: `lib/mail/guard.ts`
- Create: `app/api/mail/status/route.ts`
- Create: `app/api/mail/messages/route.ts`
- Create: `app/api/mail/messages/[uid]/route.ts`
- Create: `app/api/mail/messages/[uid]/seen/route.ts`
- Create: `app/api/mail/messages/[uid]/attachment/route.ts`

- [ ] **Step 1: Own-mailbox guard**

`lib/mail/guard.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { getMailboxForUser } from "@/lib/mail/mailbox";
import type { ResolvedMailbox } from "@/lib/mail/types";

/**
 * Resolve the caller's OWN verified mailbox. Never trusts a mailbox id from
 * the client. 401 = not signed in; 403 = signed in but no verified mailbox.
 */
export async function requireOwnMailbox(): Promise<{ mailbox: ResolvedMailbox } | { error: 401 | 403 }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const mailbox = await getMailboxForUser(user.id);
  if (!mailbox) return { error: 403 };
  return { mailbox };
}
```

- [ ] **Step 2: Status route (for conditional nav)**

`app/api/mail/status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMailboxForUser } from "@/lib/mail/mailbox";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ hasMailbox: false });
  const mailbox = await getMailboxForUser(user.id);
  return NextResponse.json({ hasMailbox: !!mailbox });
}
```

- [ ] **Step 3: List route**

`app/api/mail/messages/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireOwnMailbox } from "@/lib/mail/guard";
import { listMessages } from "@/lib/mail/imap";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireOwnMailbox();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "No mailbox" }, { status: auth.error });

  const url = new URL(req.url);
  const folder = url.searchParams.get("folder") ?? "INBOX";
  const page = Number(url.searchParams.get("page") ?? "1") || 1;

  try {
    const result = await listMessages(auth.mailbox, { folder, page });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 4: Single-message route**

`app/api/mail/messages/[uid]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireOwnMailbox } from "@/lib/mail/guard";
import { getMessage } from "@/lib/mail/imap";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const auth = await requireOwnMailbox();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "No mailbox" }, { status: auth.error });

  const folder = new URL(req.url).searchParams.get("folder") ?? "INBOX";
  const uidNum = Number(uid);
  if (!Number.isInteger(uidNum) || uidNum < 1) return NextResponse.json({ error: "Bad uid" }, { status: 400 });

  try {
    const message = await getMessage(auth.mailbox, folder, uidNum);
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    return NextResponse.json({ message });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 5: Mark-seen route**

`app/api/mail/messages/[uid]/seen/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireOwnMailbox } from "@/lib/mail/guard";
import { markSeen } from "@/lib/mail/imap";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const auth = await requireOwnMailbox();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "No mailbox" }, { status: auth.error });

  const folder = new URL(req.url).searchParams.get("folder") ?? "INBOX";
  const uidNum = Number(uid);
  if (!Number.isInteger(uidNum) || uidNum < 1) return NextResponse.json({ error: "Bad uid" }, { status: 400 });

  try {
    await markSeen(auth.mailbox, folder, uidNum);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 6: Attachment-download route**

`app/api/mail/messages/[uid]/attachment/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireOwnMailbox } from "@/lib/mail/guard";
import { getAttachment } from "@/lib/mail/imap";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const auth = await requireOwnMailbox();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "No mailbox" }, { status: auth.error });

  const url = new URL(req.url);
  const folder = url.searchParams.get("folder") ?? "INBOX";
  const part = url.searchParams.get("part");
  const uidNum = Number(uid);
  if (!part) return NextResponse.json({ error: "Missing part" }, { status: 400 });
  if (!Number.isInteger(uidNum) || uidNum < 1) return NextResponse.json({ error: "Bad uid" }, { status: 400 });

  try {
    const att = await getAttachment(auth.mailbox, folder, uidNum, part);
    if (!att) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    return new Response(new Uint8Array(att.content), {
      headers: {
        "Content-Type": att.contentType,
        "Content-Disposition": `attachment; filename="${att.filename.replace(/"/g, "")}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/mail/guard.ts app/api/mail/status/ app/api/mail/messages/
git commit -m "feat(mail): own-mailbox guard + read routes (status/list/get/seen/attachment)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 12: Send route (SMTP + Sent append)

**Files:**
- Create: `lib/mail/sendSchema.ts`
- Create: `app/api/mail/send/route.ts`

- [ ] **Step 1: Send schema**

`lib/mail/sendSchema.ts`:

```ts
import { z } from "zod";

export const sendMailSchema = z.object({
  to: z.string().trim().email().max(320),
  cc: z.string().trim().max(2000).optional().default(""),
  subject: z.string().trim().max(500).default(""),
  body: z.string().max(100_000).default(""),
  attachments: z
    .array(
      z.object({
        filename: z.string().trim().min(1).max(255),
        contentBase64: z.string().max(15_000_000),
        contentType: z.string().trim().max(200).default("application/octet-stream"),
      })
    )
    .max(10)
    .optional()
    .default([]),
});
export type SendMailInput = z.infer<typeof sendMailSchema>;
```

- [ ] **Step 2: Send route**

`app/api/mail/send/route.ts`:

```ts
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { requireOwnMailbox } from "@/lib/mail/guard";
import { buildSmtpConfig } from "@/lib/mail/config";
import { appendToSent } from "@/lib/mail/imap";
import { sendMailSchema } from "@/lib/mail/sendSchema";

export const runtime = "nodejs";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(req: Request) {
  const auth = await requireOwnMailbox();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "No mailbox" }, { status: auth.error });

  const parsed = sendMailSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  const input = parsed.data;
  const mailbox = auth.mailbox;

  const from = `"${mailbox.displayName || mailbox.address}" <${mailbox.address}>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;white-space:pre-wrap">${escapeHtml(input.body)}</div>`;
  const attachments = input.attachments.map((a) => ({
    filename: a.filename,
    content: Buffer.from(a.contentBase64, "base64"),
    contentType: a.contentType,
  }));
  const mail = { from, to: input.to, cc: input.cc || undefined, subject: input.subject, html, attachments };

  // Send via SMTP.
  try {
    const transport = nodemailer.createTransport(buildSmtpConfig(mailbox));
    await transport.sendMail(mail);
  } catch (e) {
    return NextResponse.json({ error: `Send failed: ${(e as Error).message}` }, { status: 502 });
  }

  // Best-effort: append the raw message to Sent so it shows there. Never fails the send.
  try {
    const raw: Buffer = await new Promise((resolve, reject) => {
      new MailComposer(mail).compile().build((err, message) => (err ? reject(err) : resolve(message)));
    });
    await appendToSent(mailbox, raw);
  } catch {
    // ignore — the message was already delivered
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

> If tsc reports missing types for `nodemailer/lib/mail-composer`, add a one-line module declaration file `types/mail-composer.d.ts` with `declare module "nodemailer/lib/mail-composer";` and include it (the repo already ships `nodemailer` types for the main entry). Only add this if tsc actually complains.

- [ ] **Step 4: Commit**

```bash
git add lib/mail/sendSchema.ts app/api/mail/send/
git commit -m "feat(mail): send route — SMTP send + best-effort Sent append

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 13: Mailbox UI + conditional nav

**Files:**
- Create: `hooks/useHasMailbox.ts`
- Create: `components/mail/Mailbox.tsx`
- Create: `app/(app)/mailbox/page.tsx`
- Modify: `components/layout/Sidebar.tsx`

- [ ] **Step 1: `useHasMailbox` hook**

`hooks/useHasMailbox.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

/** Whether the current user has a verified linked mailbox (drives nav visibility). */
export function useHasMailbox(): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/mail/status")
      .then((r) => r.json())
      .then((d: { hasMailbox: boolean }) => { if (alive) setHas(!!d.hasMailbox); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return has;
}
```

- [ ] **Step 2: Mailbox component**

`components/mail/Mailbox.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox, Send as SendIcon, RefreshCw, Paperclip, X, CornerUpLeft, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";

type Folder = "INBOX" | "Sent";
type ListItem = { uid: number; from: string; subject: string; date: string; seen: boolean; preview: string; hasAttachments: boolean };
type Attachment = { filename: string; size: number; partId: string };
type FullMessage = { from: string; to: string; subject: string; date: string; html: string | null; text: string | null; attachments: Attachment[] };

export function Mailbox({ address }: { address: string }) {
  const { toast } = useToast();
  const [folder, setFolder] = useState<Folder>("INBOX");
  const [items, setItems] = useState<ListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [openUid, setOpenUid] = useState<number | null>(null);
  const [message, setMessage] = useState<FullMessage | null>(null);
  const [composing, setComposing] = useState<null | { to: string; subject: string; body: string }>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async (f: Folder) => {
    setLoading(true);
    setOpenUid(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/mail/messages?folder=${f}&page=1`);
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Could not load mail", body: data.error }); return; }
      setItems(data.messages ?? []);
      setTotal(data.total ?? 0);
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(folder); }, [folder, load]);

  async function open(uid: number) {
    setOpenUid(uid);
    setMessage(null);
    const res = await fetch(`/api/mail/messages/${uid}?folder=${folder}`);
    const data = await res.json();
    if (!res.ok) { toast({ kind: "error", title: "Could not open message", body: data.error }); return; }
    setMessage(data.message);
    if (folder === "INBOX") {
      fetch(`/api/mail/messages/${uid}/seen?folder=${folder}`, { method: "POST" }).catch(() => {});
      setItems((prev) => prev.map((m) => (m.uid === uid ? { ...m, seen: true } : m)));
    }
  }

  function startReply() {
    if (!message) return;
    const subject = message.subject.startsWith("Re:") ? message.subject : `Re: ${message.subject}`;
    const quoted = `\n\n----- Original message -----\nFrom: ${message.from}\nDate: ${new Date(message.date).toLocaleString()}\nSubject: ${message.subject}\n\n${message.text ?? ""}`;
    // reply-to address is the sender's bare address portion
    const to = message.from.match(/<([^>]+)>/)?.[1] ?? message.from;
    setComposing({ to, subject, body: quoted });
  }

  async function send() {
    if (!composing) return;
    setSending(true);
    try {
      const res = await fetch("/api/mail/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: composing.to, subject: composing.subject, body: composing.body }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Send failed", body: data.error }); return; }
      toast({ kind: "success", title: "Message sent" });
      setComposing(null);
      if (folder === "Sent") load("Sent");
    } finally { setSending(false); }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
      {/* Left: folders + list */}
      <div className="space-y-3">
        <div className="flex items-center gap-1">
          <button onClick={() => setFolder("INBOX")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", folder === "INBOX" ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")}>
            <Inbox className="w-4 h-4" /> Inbox
          </button>
          <button onClick={() => setFolder("Sent")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", folder === "Sent" ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")}>
            <SendIcon className="w-4 h-4" /> Sent
          </button>
          <button onClick={() => load(folder)} title="Refresh" className="ml-auto p-1.5 rounded text-text-muted hover:text-text hover:bg-surface-2">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
        <button onClick={() => setComposing({ to: "", subject: "", body: "" })} className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink">Compose</button>

        <div className="rounded-lg border border-border bg-surface divide-y divide-border max-h-[70vh] overflow-y-auto">
          {items.length === 0 && !loading && <p className="px-3 py-6 text-center text-sm text-text-faint">No messages.</p>}
          {items.map((m) => (
            <button key={m.uid} onClick={() => open(m.uid)} className={cn("w-full text-left px-3 py-2.5", openUid === m.uid ? "bg-surface-2" : "hover:bg-surface-2")}>
              <div className="flex items-center justify-between gap-2">
                <span className={cn("truncate text-sm", m.seen ? "text-text-muted" : "font-semibold text-text")}>{m.from || "(unknown)"}</span>
                <span className="shrink-0 text-[11px] text-text-faint">{new Date(m.date).toLocaleDateString()}</span>
              </div>
              <div className={cn("truncate text-sm flex items-center gap-1", m.seen ? "text-text-muted" : "text-text")}>
                {m.hasAttachments && <Paperclip className="w-3 h-3 shrink-0" />} {m.subject}
              </div>
              <div className="truncate text-[11px] text-text-faint">{m.preview}</div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-faint">{total} message{total === 1 ? "" : "s"} in {folder}</p>
      </div>

      {/* Right: reading pane */}
      <div className="rounded-lg border border-border bg-surface p-4 min-h-[300px]">
        {!message ? (
          <div className="h-full flex items-center justify-center text-sm text-text-faint">Select a message to read.</div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-text">{message.subject}</h2>
                <p className="text-xs text-text-muted mt-0.5">From {message.from}</p>
                <p className="text-xs text-text-muted">To {message.to}</p>
                <p className="text-[11px] text-text-faint">{new Date(message.date).toLocaleString()}</p>
              </div>
              <button onClick={startReply} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text hover:bg-surface-2">
                <CornerUpLeft className="w-3.5 h-3.5" /> Reply
              </button>
            </div>

            {message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {message.attachments.map((a) => (
                  <a key={a.partId} href={`/api/mail/messages/${openUid}/attachment?folder=${folder}&part=${encodeURIComponent(a.partId)}`} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text hover:bg-surface-2">
                    <Paperclip className="w-3 h-3" /> {a.filename}
                  </a>
                ))}
              </div>
            )}

            {/* Received HTML rendered in a script-less, origin-less sandbox — never runs in our origin. */}
            {message.html ? (
              <iframe
                title="Message body"
                sandbox=""
                srcDoc={message.html}
                className="w-full rounded-md border border-border bg-white"
                style={{ height: 480 }}
              />
            ) : (
              <pre className="whitespace-pre-wrap text-sm text-text">{message.text ?? "(no content)"}</pre>
            )}
          </div>
        )}
      </div>

      {/* Compose / Reply modal */}
      {composing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setComposing(null)}>
          <div className="w-full max-w-2xl rounded-lg border border-border bg-surface p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-text"><Mail className="w-4 h-4" /> New message · from {address}</div>
              <button onClick={() => setComposing(null)} className="p-1 rounded text-text-faint hover:text-text"><X className="w-4 h-4" /></button>
            </div>
            <Field label="To" required>
              <input className={inputCls} value={composing.to} onChange={(e) => setComposing({ ...composing, to: e.target.value })} placeholder="recipient@example.com" />
            </Field>
            <Field label="Subject">
              <input className={inputCls} value={composing.subject} onChange={(e) => setComposing({ ...composing, subject: e.target.value })} />
            </Field>
            <Field label="Message">
              <textarea className={cn(inputCls, "min-h-[200px]")} value={composing.body} onChange={(e) => setComposing({ ...composing, body: e.target.value })} />
            </Field>
            <div className="flex justify-end">
              <button onClick={send} disabled={sending || !composing.to} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
                <SendIcon className="w-4 h-4" /> {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mailbox page (verified-mailbox gate)**

`app/(app)/mailbox/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMailboxForUser } from "@/lib/mail/mailbox";
import { Mailbox } from "@/components/mail/Mailbox";

export default async function MailboxPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const mailbox = await getMailboxForUser(user.id);
  if (!mailbox) redirect("/dashboard");

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">Mailbox</h1>
        <p className="text-sm text-text-muted mt-0.5">{mailbox.address}</p>
      </div>
      <Mailbox address={mailbox.address} />
    </div>
  );
}
```

- [ ] **Step 4: Conditional nav item**

In `components/layout/Sidebar.tsx`:

(a) Add the import near the top of the component body (after `const counts = useNavCounts();`):

```ts
  const hasMailbox = useHasMailbox();
```

and add the import at the top of the file:

```ts
import { useHasMailbox } from "@/hooks/useHasMailbox";
```

(b) Add `Mailbox`-appropriate icon — `Inbox` — to the lucide import list, then build a conditional item and append it to `mainVisible`. Replace the `const mainVisible = ...` line with:

```ts
  const mainVisible = MAIN.filter((n) => (n.perm ? has(n.perm) : true));
  if (hasMailbox) mainVisible.push({ href: "/mailbox", label: "Mailbox", icon: Inbox });
```

Add `Inbox` to the existing `lucide-react` import in `Sidebar.tsx`.

> `NavItem.perm` is optional, so an item with no `perm` is always rendered once pushed — visibility is fully controlled by `hasMailbox`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add hooks/useHasMailbox.ts components/mail/Mailbox.tsx "app/(app)/mailbox/page.tsx" components/layout/Sidebar.tsx
git commit -m "feat(mail): Mailbox UI (list + sandboxed reading pane + compose/reply) + conditional nav

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 14: Full verification (tests, typecheck, production build)

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit suite**

Run: `npx vitest run`
Expected: PASS — including the pre-existing suites plus the three new files (`tests/contractPlaceholders.test.ts`, `tests/googleOauth.test.ts`, `tests/mailMessage.test.ts`). No failures.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint the touched files**

Run: `npm run lint`
Expected: no errors (warnings acceptable if pre-existing).

- [ ] **Step 4: Production build (memory-bumped, dev server must be DOWN)**

Run: `NODE_OPTIONS=--max-old-space-size=6144 npm run build`
Expected: build completes; all new routes compile as `nodejs` runtime handlers; no type or bundling errors.

> On Windows PowerShell, set the env var separately: `$env:NODE_OPTIONS = "--max-old-space-size=6144"; npm run build`.

- [ ] **Step 5: Commit (only if lint/build required a fix)**

```bash
git add -A
git commit -m "chore(google-mailbox): final verification fixes (tests, tsc, build)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Manual live acceptance (documented; requires real Google + mailbox creds)**

These exercise the untested network seams end-to-end (run against a staging/live instance, not in CI):

1. Admin → Contract Templates → **Connect Google** → consent → returns connected.
2. Set the templates **folder ID** → **Available docs** lists the folder's Google Docs.
3. **Add** a doc containing `{{business_name}}` / `{{one_time_price}}` → it appears under Registered with detected placeholders; adding it twice returns "already added".
4. On a lead with a business name, email, and price → **New contract** → pick the Google template → **Create & preview** shows the exported PDF with merged values → **Send** delivers it and flips to sent.
5. Pick the **Built-in** option on another lead → react-pdf preview still renders and sends (fallback intact).
6. **Mailbox** nav appears for a user with a verified mailbox → Inbox lists messages, a message opens (HTML in the sandboxed iframe, no script execution), an attachment downloads, **Reply**/**Compose** sends and the message lands in **Sent**.

---

## Self-Review (performed against the design spec)

**Spec coverage — every requirement maps to a task:**

- A1 OAuth (env, `google_connection`, `lib/google/oauth.ts` buildAuthUrl/exchangeCode/getAccessToken with offline+consent, encrypted refresh token, connect/callback/disconnect/status routes gated by `integrations.manage`) → Tasks 1, 2, 3.
- A2 Templates folder + registry (`app_settings` folder id, `lib/google/drive.ts`, `lib/google/docs.ts`, `lib/contracts/placeholders.ts`, `contract_templates` unique doc id, available/add(409)/refresh/remove/list routes, admin UI) → Tasks 1, 4, 5, 6, 7.
- A3 Contract creation (additive `contracts` columns, composer selector, copy→replaceAllText→exportPdf→store, react-pdf fallback, preview serves stored PDF, unchanged send emailing stored PDF) → Tasks 1, 8.
- A4 Supported placeholders (all 10 tokens, `$#,###.00` via `formatUsd`, unmapped surfaced in UI) → Tasks 5 (`buildReplacements`/`unmappedPlaceholders`), 7 (UI badge).
- B1 Reading (`lib/mail/imap.ts` list/get/markSeen, pure helpers in `lib/mail/message.ts`, own-mailbox routes) → Tasks 9, 10, 11.
- B2 Sending (`POST /api/mail/send` nodemailer + IMAP Sent append; reply reuses the route) → Task 12 (route) + Task 13 (reply UI reuse).
- B3 UI (Mailbox nav gated on verified mailbox, folder switch, list, sandboxed iframe, attachment download, compose/reply) → Task 13.
- B4 Security (mailbox resolved from the logged-in user via `getMailboxForUser`, never a client id; creds decrypted server-side only; received HTML `sandbox=""` — no `allow-scripts`/`allow-same-origin`) → Tasks 11 (`requireOwnMailbox`), 13 (iframe).
- Migration & rollout (additive-only 0037: new tables, nullable columns, `integrations.manage`; new env documented; Google Cloud one-time setup noted) → Task 1.
- Testing (tested: `extractPlaceholders`, `buildReplacements`, `buildAuthUrl`, message preview/address/attachment helpers; network seams thin + live-exercised) → Tasks 2, 5, 9; live acceptance in Task 14.

**Placeholder scan:** No "TBD"/"TODO"/"handle edge cases"/"similar to Task N" — every code step contains complete code, exact paths, exact run commands, and expected output. The one conditional instruction (mail-composer `.d.ts`) is fully specified and gated on an actual tsc error.

**Type/name consistency (checked across tasks):** `ContractSnapshot` fields (`one_time_price`, `yearly_price`, `contract_date`, `agent_name`) are used identically in `buildReplacements` (Task 5) and the create route (Task 8). `{{token}}` string form is consistent between `extractPlaceholders`, `buildReplacements`, `replaceAllText` (containsText `{{token}}`), and the UI badge. `getAccessToken` (Task 2) is the single token source imported by `drive.ts`/`docs.ts` (Task 4). `requireOwnMailbox` (Task 11) is reused by the send route (Task 12). `MailListItem`/`MailFull`/`MailAttachment` shapes returned by `imap.ts` (Task 10) match the `ListItem`/`FullMessage`/`Attachment` types consumed by `Mailbox.tsx` (Task 13) and the route JSON (Task 11). `contract_templates_folder_id` is added to the DB (Task 1), the `AppSettings` type + select (Task 6), and read in the folder/available routes and the admin page (Tasks 6, 7). `google_template_id`/`generated_doc_id`/`generated_doc_url` are added to the DB (Task 1), `ContractRow` (Task 8), and written by the create route (Task 8).

**Design decision noted:** the spec sketched the contracts columns under A3 and the two Google tables under A1/A2; this plan puts ALL additive schema (both sub-projects) in a single reviewed migration `0037` in Task 1, because the shared prod DB is safest applied in one reviewed pass and every column is additive/nullable. Consumers of those columns still land in their own later tasks.
