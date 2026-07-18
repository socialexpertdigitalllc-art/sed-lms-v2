# Email System & Contract Management — Design

**Date:** 2026-07-18
**Status:** Approved for implementation
**Scope:** Sub-projects 1 (Mailbox Linking) + 2 (Contract Management). Sub-project 3 (in-dashboard inbox) is deferred to its own later cycle.

## Context & the governing constraint

The dashboard's users have company mailboxes on `socialexpertdigitalllc.com`, hosted on **Hostinger Email** (webmail `mail.hostinger.com`; `imap.hostinger.com:993` SSL / `smtp.hostinger.com:465` SSL; auth = full address + password, no OAuth).

**Hostinger has no public API to create mailboxes** — creation is manual in hPanel. Reading/sending over standard IMAP/SMTP with the mailbox's own credentials *is* fully supported. Therefore:

- Mailbox **provisioning** is **assisted**: created manually in hPanel, then **linked** in the dashboard (admin enters address + password once; stored encrypted).
- Mailbox **use** (send now; read later) runs over IMAP/SMTP off the stored credential.

Additional constraints that shape the design:
- **Shared Supabase DB** (dev + prod on `ikuvbxjkoojtgekapbul`). Migrations must be **additive only** (new tables / new nullable columns) — never destructive.
- **Shared hosting** runs the Node app — no headless Chrome / LibreOffice. PDF generation must be **pure-JS** (`@react-pdf/renderer`).
- **SMTP rate caps** (~500/hr on Hostinger) are fine for low-volume contract sends; not for bulk. No bulk email here.

## Decisions (locked)

| Question | Decision |
| --- | --- |
| Mail host | Hostinger Email |
| Provisioning | Assisted link (create in hPanel → register in dashboard) |
| Who links | **Admin** links & assigns for everyone (centralized) |
| PDF render | Code-owned template via `@react-pdf/renderer` (pure-JS) |
| Contract fields | Auto-merge from the lead (`business_name`, `business_phone`, `business_email`, `price_quoted` = one-time, `yearly_price` = yearly) |
| Signature | Uploaded PNG preferred, typed script-font fallback (agent chooses) |
| "Contract Sent" | A **badge** on the lead (derived from a sent contract existing) — **NOT** a pipeline status change |

---

## Sub-project 1 — Company Mailbox Linking

**Purpose:** register a manually-created Hostinger mailbox, tie it to a dashboard user, store its credential securely, verify it works. It exposes one seam every downstream feature uses.

### Data model — `company_mailboxes`
- `id` uuid pk
- `user_id` uuid — the owning dashboard user (FK)
- `email_address` text — e.g. `agent@socialexpertdigitalllc.com`
- `display_name` text — From-header / signature name
- `imap_host` text default `imap.hostinger.com`, `imap_port` int default `993`
- `smtp_host` text default `smtp.hostinger.com`, `smtp_port` int default `465`
- `encrypted_password` text — AES-256-GCM ciphertext (iv + tag + data), **never** returned to the client
- `status` text — `unverified` | `verified` | `error`
- `last_verified_at` timestamptz null
- `last_error` text null
- `created_by` uuid, `created_at` timestamptz default now()
- unique(`email_address`)

Storing host/port per-row (defaulted) means a future Titan or other-provider mailbox works with no code change.

### Credential security
- Encrypt at rest with **AES-256-GCM**, key from a new env secret `MAILBOX_ENC_KEY` (32-byte, base64). Helper `lib/mail/crypto.ts` — `encryptSecret(plain)` / `decryptSecret(cipher)`, storing `iv:tag:ciphertext`.
- The plaintext password is accepted once via the link form (POST), encrypted server-side, and **never** sent back. The UI only ever shows `status`. Never logged.
- Decryption happens only inside server-side connection code at send/read time.

### Verification
On link (and on demand), the server performs a real **IMAP login** (`imap.hostinger.com:993`) **and** an **SMTP login** (`smtp.hostinger.com:465`) with the credential. Both must succeed → `verified`; otherwise `error` with `last_error`. Wrong passwords fail loudly at link time.

### The seam
`getMailboxForUser(userId): Promise<ResolvedMailbox | null>` (server-only) → `{ address, displayName, imap{host,port}, smtp{host,port}, password }` (password decrypted in-memory). Contracts (send) and the future inbox (read) build on this and nothing else.

### UI (admin-only)
A **Company Mail** admin settings area: table of linked mailboxes (address, owner, status badge, last verified), a **Link mailbox** form (owner select, address, display name, password, host fields prefilled + collapsible advanced override), **Re-verify** and **Unlink** actions. Gated to admins via existing permission checks.

### New deps
`imapflow` (IMAP verify/read) + `nodemailer` (SMTP verify/send).

---

## Sub-project 2 — Contract Management

**Purpose:** turn a lead's stored details into a finished, signed contract PDF and send it from the agent's company mailbox — a reviewed, few-click flow replacing the manual copy-doc routine.

### Data model — `contracts`
- `id` uuid pk
- `lead_id` uuid (FK), `created_by` uuid, `mailbox_id` uuid (FK `company_mailboxes`)
- `template_key` text — which contract template (default `standard`; see enhancement)
- **field snapshot** captured at creation (a later lead edit never mutates a sent contract): `business_name`, `business_phone`, `business_email`, `one_time_price` numeric, `yearly_price` numeric, `agent_name`, `contract_date`
- `message_body` text — the cover message sent with the PDF
- `recipient_email` text
- `pdf_path` text — stored PDF (Supabase storage bucket `contracts`)
- `status` text — `draft` | `sent`
- `sent_at` timestamptz null, `created_at` timestamptz default now()

### Signature — `user_signatures` table
- `user_id` uuid pk/unique, `signature_image_path` text (uploaded PNG in Supabase storage, nullable), `typed_name` text (fallback). Render rule: image if present, else typed name in a script font. A dedicated table (not user-profile columns) keeps signature assets isolated and simple to manage.

### Flow
1. **Create contract** from a lead → merge lead fields into the chosen template, render a **PDF preview** + an editable cover message. Status `draft`.
2. Agent reviews, edits the message, confirms the **sending mailbox** (their verified company mailbox).
3. **Send** → generate the final PDF, send via SMTP (`nodemailer`) from the agent's mailbox to `recipient_email`, PDF attached + `message_body` + rendered signature. Persist PDF to storage, mark `sent`, set `sent_at`.

### PDF generation
`@react-pdf/renderer` — the contract laid out as a code component (`lib/contracts/ContractDocument.tsx`) matching the existing Google Docs template, merged with the snapshot, produced server-side as a PDF buffer. **Implementation input required:** the exact text/layout exported from the current Google Doc, to reproduce faithfully.

### Sending
`nodemailer` transport to `smtp.hostinger.com:465` (SSL) using the decrypted credential from `getMailboxForUser`. Subject + HTML body from `message_body`, PDF attachment, signature block. Send failures surface to the UI and leave the contract `draft` (never a false "sent").

### "Contract Sent" badge (derived)
A lead shows a **Contract Sent** badge when a `contracts` row with `status='sent'` exists for it. No new lead column, no status mutation — derived by joining/aggregating `contracts` when leads are loaded (a set of `lead_id`s with a sent contract). Rendered wherever leads are listed/detailed. Denormalization is explicitly deferred unless profiling shows the join is a bottleneck.

### Contracts list
Dashboard view (per-lead section + a global Contracts page): rows with business name, status, sent date, download PDF, **resend** (creates a new record — sent contracts are immutable).

### Safeguards
- Sending email is an **explicit, reviewed** action; the preview→Send step is the confirmation the safety rules require. Never auto-fires.
- Merged values are **snapshotted**; a `sent` contract is immutable — resend = new record.
- Missing-field guard (see enhancement) blocks preview if a required merge field is blank.

---

## Approved enhancements
1. **Contract templates library** — `template_key` selects among multiple contract types (e.g. `standard`, `premium`); each is a code component. MVP ships `standard`; the column + selector make more trivial to add.
2. **Auto-badge on send** — sending flips the derived **badge** (not status) on immediately.
3. **Merge-field validation** — before preview, warn/block if the lead is missing email or a price, so no blank-field contract is ever sent.
4. **PDF retained** — the generated PDF is stored (Supabase `contracts` bucket) and downloadable from the lead's record and the contracts list.

## Out of scope (future cycles)
- Customer **e-signature / countersigning** (we send a PDF today; MVP matches).
- **In-dashboard inbox** (sub-project 3) — IMAP read, threads, folders, compose. Its own spec.
- **Bulk / marketing email** — not this system.

## Testing
- Pure helpers get vitest: `lib/mail/crypto.ts` (encrypt→decrypt round-trip, tamper detection), merge-field mapping (lead → contract snapshot), missing-field validation, badge derivation, signature render-rule selection.
- IMAP/SMTP verification + sending are integration seams — thin wrappers, mocked in unit tests; real verification exercised manually against a live mailbox on prod.
- PDF: snapshot the react-pdf document tree / assert merged values appear; do not pixel-diff.

## Migration & rollout notes
- Two additive tables (`company_mailboxes`, `contracts`) + one signature table/columns + one storage bucket (`contracts`). **Additive only** — safe on the shared prod DB.
- New env secret `MAILBOX_ENC_KEY` must be set in `.env.local` and prod env before linking works.
- Ships as one release: link a mailbox → create & send a contract. Inbox follows separately.
