# Google Docs Contract Templates + Full Mailbox — Design

**Date:** 2026-07-19
**Status:** Approved for implementation
**Supersedes:** the react-pdf contract template as the *primary* generation path (kept only as a fallback). Adds the previously-deferred in-dashboard mailbox.

## Decisions (locked)

| Question | Decision |
| --- | --- |
| Google Drive access | **OAuth "Connect Google"** — app-wide single company connection, encrypted refresh token |
| Google API client | Raw `fetch` to Google REST (OAuth token + Drive v3 + Docs v1) — no heavy SDK, shared-hosting friendly |
| Mailbox scope (v1) | **Full read + send**: Inbox + Sent, live IMAP (no background sync) |
| Copied contract doc | **Kept** in Drive as a record; its link saved on the contract |
| Signature image in Doc | Out of scope v1 — templates use `{{agent_name}}` text; image insertion is a later enhancement |

Shared constraints: additive-only migrations (shared prod DB `ikuvbxjkoojtgekapbul`); credentials/refresh-tokens encrypted with existing `MAILBOX_ENC_KEY` AES-GCM; sending email is always an explicit user action; `runtime = "nodejs"` on routes using imapflow/nodemailer/node crypto.

---

## Sub-project A — Google Docs contract templates

### A1. OAuth connection (admin, app-wide)
- **Env:** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` (e.g. `https://<app>/api/admin/google/callback`).
- **Scopes:** `https://www.googleapis.com/auth/drive` + `https://www.googleapis.com/auth/documents` (listing a pre-existing folder + copy + edit + export requires full `drive`, not `drive.file`). `openid email` to capture the account.
- **Table `google_connection`** (single active row): `id`, `account_email`, `encrypted_refresh_token`, `scope`, `connected_by`, `created_at`, `updated_at`. Refresh token encrypted via `encryptSecret` (existing `lib/mail/crypto.ts`).
- **`lib/google/oauth.ts`** (pure-ish + fetch): `buildAuthUrl(state)`, `exchangeCode(code) → { refreshToken, accessToken, email, expiresAt }`, `getAccessToken() → string` (reads stored connection, refreshes via token endpoint, caches in-memory until expiry). `access_type=offline&prompt=consent` to guarantee a refresh token.
- **Routes** (gated `mail.manage` or a new `integrations.manage`): `GET /api/admin/google/connect` → redirect to consent (CSRF `state`); `GET /api/admin/google/callback` → exchange + store; `POST /api/admin/google/disconnect`; `GET /api/admin/google/status`.

### A2. Templates folder + registry
- **Setting:** the Drive **folder ID** holding template docs — stored in a `app_settings`-style row (`contract_templates_folder_id`) editable in the UI.
- **`lib/google/drive.ts`:** `listDocsInFolder(folderId) → [{ id, name, modifiedTime }]` (Drive v3 `files.list`, `mimeType='application/vnd.google-apps.document'`); `copyDoc(fileId, name) → newId`; `renameFile(fileId, name)`; `exportPdf(fileId) → Uint8Array` (Drive `files.export` `application/pdf`).
- **`lib/google/docs.ts`:** `getDocText(docId) → { title, text }` (Docs v1 `documents.get`, flatten body text); `replaceAllText(docId, replacements: {token,value}[])` (Docs `documents.batchUpdate` with one `replaceAllText` request per token, `matchCase:true`).
- **`lib/contracts/placeholders.ts`** (pure, tested): `extractPlaceholders(text) → string[]` (unique `{{...}}` tokens); `buildReplacements(snapshot) → {token,value}[]` mapping the supported tokens to snapshot values (see A4).
- **Table `contract_templates`:** `id`, `google_doc_id` (**unique** — enforces no-duplicate-add), `name`, `placeholders text[]`, `synced_at`, `created_by`, `created_at`.
- **Routes** (gated `contracts.send` for use; `mail.manage`/`integrations.manage` for manage): `GET /api/admin/contract-templates/available` (folder docs + which are already added); `POST /api/admin/contract-templates {google_doc_id}` (fetch doc, detect placeholders, insert; 409 on duplicate); `POST /api/admin/contract-templates/[id]/refresh` (re-pull name+placeholders, bump `synced_at`); `DELETE /api/admin/contract-templates/[id]`; `GET /api/contract-templates` (list for the composer).
- **UI — Admin → Contract Templates:** Google connection status + Connect/Disconnect; folder-ID field; **Available docs** list each with **Add** (disabled + "Added" if already registered); **Registered templates** list with **Refresh** + **Remove**, showing detected placeholders + last synced.

### A3. Contract creation via a Google template
- **`contracts` additive columns:** `google_template_id uuid null` (fk `contract_templates`), `generated_doc_id text null`, `generated_doc_url text null`.
- **Composer:** template selector now lists **registered Google templates** (from `GET /api/contract-templates`). If none exist or Google isn't connected → an inline message pointing to Admin → Contract Templates. (The built-in react-pdf "standard" remains selectable only as a labelled fallback.)
- **Create (`POST /api/contracts`)** when a Google template is chosen: snapshot + validate (existing gate) → **copy** the template doc (`copyDoc`) named `Contract — {business_name} — {date}` → **`replaceAllText`** with `buildReplacements(snapshot)` → **`exportPdf`** → store PDF to the `contracts` bucket, save `pdf_path`, `generated_doc_id`, `generated_doc_url`, `google_template_id`. Draft is created **with the PDF already rendered**.
- **Preview** (`GET /api/contracts/[id]/pdf`): serves the stored PDF (Google path) or renders react-pdf (fallback path).
- **Send:** unchanged — emails the stored PDF from the agent's mailbox.

### A4. Supported placeholders (document these for the user)
`{{business_name}}`, `{{business_phone}}`, `{{business_email}}`, `{{one_time_price}}`, `{{yearly_price}}`, `{{date}}`, `{{agent_name}}`, `{{provider_name}}`, `{{provider_phone}}`, `{{provider_email}}`. Prices formatted `$#,###.00`; unknown tokens are left untouched (surfaced in the UI as "unmapped" when a template is added).

---

## Sub-project B — Full mailbox (read + send)

### B1. Reading (live IMAP)
- **`lib/mail/imap.ts`** (server seams on top of `getMailboxForUser`): `listMessages(mailbox, { folder, page, pageSize }) → { total, messages: [{ uid, from, subject, date, seen, preview, hasAttachments }] }`; `getMessage(mailbox, folder, uid) → { from, to, subject, date, html?, text?, attachments: [{ filename, size, partId }] }`; `markSeen(mailbox, folder, uid)`. Uses `imapflow`; connections opened per request and closed in `finally`.
- **Pure helpers (tested), `lib/mail/message.ts`:** address formatting, preview truncation, `hasAttachments` from bodystructure, folder-name normalization.
- **Routes** (own mailbox only, resolved via `getMailboxForUser(user.id)`): `GET /api/mail/messages?folder=INBOX&page=1`; `GET /api/mail/messages/[uid]?folder=INBOX`; `POST /api/mail/messages/[uid]/seen`.

### B2. Sending (SMTP + Sent append)
- **`POST /api/mail/send`** `{ to, cc?, subject, body, attachments? }` → nodemailer send from the user's mailbox; then best-effort **IMAP append** of the raw message to the Sent folder so it appears there. Reply reuses this route (client prefills `to`/`subject`/quoted body).

### B3. UI
- **Nav:** "Mailbox" — visible when the user has a **verified** linked mailbox.
- **`components/mail/Mailbox.tsx`:** folder switch (Inbox / Sent), message list (from / subject / date, unread emphasis), reading pane rendering received **HTML in a sandboxed iframe** (`sandbox` without `allow-scripts`/`allow-same-origin` — same hardening as the site-preview iframe; never executes remote content), attachment list with download, **Compose** and **Reply**.
- **Attachments:** sending supported; receiving = list names + download the part. Inline image proxying is out of scope v1.

### B4. Security
- Every mail route resolves the mailbox from the **logged-in user's own** verified mailbox; no mailbox id is trusted from the client. Credentials decrypted only server-side at connection time; never logged. Received HTML never runs in this origin.

---

## Out of scope (later cycles)
Email search; full folder tree/labels; background IMAP sync + notifications; inline image proxy; signature-image insertion into the Google Doc; per-user (vs app-wide) Google connections.

## Testing
- Pure/tested: `extractPlaceholders`, `buildReplacements`, OAuth `buildAuthUrl`, message preview/address/attachment helpers.
- Network seams (Google REST, IMAP, SMTP) are thin wrappers — mocked in unit tests where cheap, otherwise exercised in live acceptance.

## Migration & rollout
- Additive: `google_connection`, `contract_templates` tables + 3 new nullable `contracts` columns + optional `integrations.manage` permission (or reuse `mail.manage`). Applied to the shared prod DB as a reviewed step.
- New env: `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`. Google Cloud OAuth app + test user is a one-time user setup; documented in the plan.
