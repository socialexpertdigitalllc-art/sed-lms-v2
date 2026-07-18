# Email System & Contract Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin link a manually-created Hostinger company mailbox to a dashboard user (credential encrypted at rest, verified over IMAP+SMTP), then let an agent turn a lead's stored details into a merged PDF contract and email it from that mailbox — with a derived "Contract Sent" badge on the lead.

**Architecture:** Two additive sub-systems on the existing Next.js 16 App Router + Supabase stack. Sub-project 1 (mailbox linking) exposes one server-only seam, `getMailboxForUser(userId)` / `getMailboxById(id)`, that returns a decrypted `ResolvedMailbox`; everything downstream builds on it. Sub-project 2 (contracts) snapshots lead fields into an immutable `contracts` row, renders a pure-JS PDF with `@react-pdf/renderer`, and sends it via `nodemailer`. Credentials are AES-256-GCM encrypted, never returned to the client, never logged. All new tables/buckets/permissions are additive-only against the shared prod DB.

**Tech Stack:** Next.js 16 (App Router route handlers, `runtime = "nodejs"`), React 19, TypeScript, Supabase (`@supabase/supabase-js` service-role admin client + `@supabase/ssr` user client), Zod, Tailwind, lucide-react, vitest. New deps: `imapflow` (IMAP verify/read), `nodemailer` (SMTP verify/send), `@react-pdf/renderer` (pure-JS PDF).

---

## Conventions this plan mirrors (verified in-repo)

- **Admin (service-role) client:** `createAdminClient()` from `@/lib/supabase/admin` — bypasses RLS, server-only, import only after a permission check.
- **User (RLS) client:** `createClient()` from `@/lib/supabase/server` — reads `auth.getUser()`.
- **Permission gate in routes:** `getUserPermissions(user.id)` from `@/lib/permissions/resolver` returns a `Set<string>`; check `perms.has("<key>")`. Return `401 Unauthorized` / `403 Forbidden` JSON. See `app/api/payments/links/route.ts` for the `guard()` + `guardError()` pattern this plan copies.
- **Permission catalog:** SQL side seeds `public.permissions` + `public.department_permissions` in the migration; TS side lists keys in `lib/permissions/constants.ts` (`PERMISSIONS`, `PERMISSION_CATEGORIES`) for the admin grid.
- **Storage:** private buckets created in migration via `insert into storage.buckets ... on conflict do nothing`; upload with `admin.storage.from("<bucket>").upload(path, file, {...})`; stream private files with `admin.storage.from("<bucket>").download(path)` then `new Response(blob, { headers })` — see `app/api/template-engine/generations/[id]/download/route.ts` and `app/api/admin/settings/logo/route.ts`.
- **Env secrets:** read via `process.env.X!` server-side (see `lib/supabase/admin.ts`); document in `.env.example`.
- **Activity log:** `admin.from("activity_log").insert({ user_id, action, entity_type, entity_id?, new_value? })`.
- **UI tokens:** `cn` from `@/lib/utils`; `inputCls` + `Field` + `FormSection` from `@/components/forms/Field`; `useToast` from `@/components/common/Toast`; `CopyButton` from `@/components/common/CopyButton`; `Select` from `@/components/common/Select`; `SectionCard` from `@/components/forms/formShell`. Icons: **lucide-react only, no emojis**.
- **Lead fields for merge (from `lib/leads/types.ts`):** `business_name: string`, `business_phone: string | null`, `business_email: string | null`, `price_quoted: number | null` (one-time), `yearly_price: string | null` (yearly, **stored as string**), `no_email: boolean | null`.
- **Tests:** vitest, `@/` alias, files in `tests/*.test.ts`; add `// @vitest-environment node` for node-only helpers. House rule: **pure helpers get tests; client React components do NOT.**

## Migration application (shared prod DB)

Migration files under `supabase/migrations/` are the source of truth. There is **no local migration runner** in `package.json`. The new `0036_email_and_contracts.sql` is applied to the shared Supabase project (ref `ikuvbxjkoojtgekapbul`) as a **reviewed manual step** via the Supabase MCP `apply_migration` tool or the hosted SQL-editor. It is **ADDITIVE-ONLY** (new tables, new buckets, new permission rows) — no column drops, no type changes, no destructive edits — so it is safe on the shared dev+prod database. **Do not run test website generations against this DB.**

## Build / workflow constraints (bake into every task)

- Keep the dev server **down**. Verify with `npx vitest run <file>` (helpers) and `npx tsc --noEmit` (UI/route typecheck).
- A full production build, if needed, requires `NODE_OPTIONS=--max-old-space-size=6144 npm run build`.
- **Commit locally only** — do not push. Pushes happen separately via PowerShell.
- Every commit ends with the trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Route handlers that import `imapflow`, `nodemailer`, or `@react-pdf/renderer` MUST declare `export const runtime = "nodejs";`.
- Sending email is an **explicit reviewed action** (preview → Send). Never auto-send. Never log plaintext passwords or decrypted credentials.

---

## File Structure

### Sub-project 1 — Company Mailbox Linking
| File | Responsibility |
| --- | --- |
| `lib/mail/crypto.ts` | AES-256-GCM `encryptSecret` / `decryptSecret` (key from `MAILBOX_ENC_KEY`). Pure, tested. |
| `lib/mail/types.ts` | `MailboxStatus`, `CompanyMailboxRow`, `ResolvedMailbox`, `MAILBOX_DEFAULTS`. |
| `lib/mail/config.ts` | Pure config assembly: `resolveMailboxRow`, `buildImapConfig`, `buildSmtpConfig`. Tested. |
| `lib/mail/schema.ts` | Zod `linkMailboxSchema`. Pure, tested. |
| `lib/mail/mailbox.ts` | Server seams: `getMailboxById`, `getMailboxForUser`, `verifyMailboxCredentials` (imapflow + nodemailer). Thin, not unit-tested. |
| `app/api/admin/mail/mailboxes/route.ts` | `GET` list (no password) + `POST` link (encrypt → verify → insert). Gated `mail.manage`. |
| `app/api/admin/mail/mailboxes/[id]/route.ts` | `DELETE` unlink. Gated `mail.manage`. |
| `app/api/admin/mail/mailboxes/[id]/verify/route.ts` | `POST` re-verify. Gated `mail.manage`. |
| `app/(app)/admin/mail/page.tsx` | Server page: gate + load mailboxes (admin client, no password col) + owner names. |
| `components/mail/CompanyMailManager.tsx` | Client UI: table + link form (host defaults + advanced override) + re-verify/unlink. No test. |

### Sub-project 2 — Contract Management
| File | Responsibility |
| --- | --- |
| `lib/contracts/types.ts` | `ContractSnapshot`, `ContractRow`, `ContractListItem`. |
| `lib/contracts/merge.ts` | Pure: `parsePrice`, `buildContractSnapshot`, `validateMergeFields`, `contractLines`, `formatUsd`. Tested. |
| `lib/contracts/signature.ts` | Pure: `resolveSignature` render-rule. Tested. |
| `lib/contracts/badge.ts` | Pure: `sentContractLeadIds`. Tested. |
| `lib/contracts/templates.ts` | `CONTRACT_TEMPLATES` registry + `isContractTemplateKey`. Tested. |
| `lib/contracts/schema.ts` | Zod `createContractSchema`, `signatureSchema`. Pure, tested. |
| `lib/contracts/ContractDocument.tsx` | `@react-pdf/renderer` document + `renderContractPdf(snapshot, sig)` → `Buffer`. No component test (uses tested `contractLines`). |
| `app/api/me/signature/route.ts` | `GET` + `PUT` own signature (typed name / uploaded PNG). Self-scoped. |
| `app/api/contracts/route.ts` | `POST` create draft (merge → validate → insert). Gated `contracts.send`. |
| `app/api/contracts/[id]/pdf/route.ts` | `GET` preview (render draft) / download (stored sent PDF). Gated `contracts.view`. |
| `app/api/contracts/[id]/send/route.ts` | `POST` send via nodemailer, store PDF, mark sent. Gated `contracts.send`. |
| `app/(app)/contracts/page.tsx` | Global contracts list (gate `contracts.view`). |
| `app/(app)/account/signature/page.tsx` | Signature management page (self). |
| `components/account/SignatureCard.tsx` | Client UI: typed name + PNG upload. No test. |
| `components/contracts/ContractSentBadge.tsx` | Small "Contract Sent" pill. No test. |
| `components/contracts/LeadContractsCard.tsx` | Per-lead contracts list + "Create contract" composer entry. No test. |
| `components/contracts/ContractComposer.tsx` | Client dialog: message editor + mailbox select + preview iframe + Send. No test. |
| `components/contracts/ContractsList.tsx` | Client global list (download / resend). No test. |

### Shared / modified
| File | Change |
| --- | --- |
| `package.json` | Add `imapflow`, `nodemailer`, `@react-pdf/renderer`, `@types/nodemailer`. |
| `.env.example` | Add `MAILBOX_ENC_KEY=`. |
| `supabase/migrations/0036_email_and_contracts.sql` | New tables, buckets, permissions (additive). |
| `lib/permissions/constants.ts` | Add `mail.manage`, `contracts.view`, `contracts.send` + `mail`, `contracts` categories. |
| `components/layout/Sidebar.tsx` | Add "Contracts" (MAIN) + "Company Mail" (ADMIN) nav items. |
| `app/(app)/leads/page.tsx` | Load sent-contract lead ids (admin client); pass to `LeadsTable`. |
| `app/(app)/leads/[id]/page.tsx` | Load this lead's contracts + verified mailboxes + signature-presence; pass to `LeadDetail`. |
| `components/leads/LeadsTable.tsx` | Accept `contractSentLeadIds` prop; render badge in the `business_name` cell. |
| `components/leads/LeadDetail.tsx` | Accept contract props; render badge in header + `LeadContractsCard`. |

---

## Task 1: Dependencies + `MAILBOX_ENC_KEY` env

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install runtime deps**

Run:
```bash
npm install imapflow nodemailer @react-pdf/renderer
```
Expected: `package.json` gains `imapflow`, `nodemailer`, `@react-pdf/renderer` under `dependencies`; exit 0.

- [ ] **Step 2: Install types dev dep**

Run:
```bash
npm install -D @types/nodemailer
```
Expected: `@types/nodemailer` under `devDependencies`; exit 0. (`imapflow` and `@react-pdf/renderer` ship their own types.)

- [ ] **Step 3: Document the new secret in `.env.example`**

Append to `.env.example`:
```
# Company mailbox linking (Sub-project 1) — 32-byte base64 key for AES-256-GCM
# encryption of stored IMAP/SMTP passwords. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
MAILBOX_ENC_KEY=
```

- [ ] **Step 4: Set the key in local env (manual, not committed)**

Generate a key and add `MAILBOX_ENC_KEY=<base64>` to `.env.local` (git-ignored). Run:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Expected: a 44-char base64 string. Paste it as `MAILBOX_ENC_KEY=` in `.env.local`. **Note for rollout:** the same key must be set in the prod environment before linking works; changing the key later makes existing ciphertext undecryptable.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore(mail): add imapflow, nodemailer, @react-pdf/renderer + MAILBOX_ENC_KEY" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: `lib/mail/crypto.ts` — AES-256-GCM secret crypto (TDD)

**Files:**
- Create: `lib/mail/crypto.ts`
- Test: `tests/mailCrypto.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mailCrypto.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes } from "crypto";
import { encryptSecret, decryptSecret } from "@/lib/mail/crypto";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

describe("mail crypto (AES-256-GCM)", () => {
  beforeEach(() => {
    process.env.MAILBOX_ENC_KEY = KEY_A;
  });

  it("round-trips a secret", () => {
    const plain = "hunter2-p@ss word";
    const cipher = encryptSecret(plain);
    expect(cipher).not.toContain(plain);
    expect(cipher.split(":")).toHaveLength(3);
    expect(decryptSecret(cipher)).toBe(plain);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("fails the auth tag when the ciphertext is tampered", () => {
    const cipher = encryptSecret("secret");
    const [iv, tag, data] = cipher.split(":");
    const bytes = Buffer.from(data, "base64");
    bytes[0] = bytes[0] ^ 0xff; // flip a bit
    const tampered = [iv, tag, bytes.toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("fails to decrypt with the wrong key", () => {
    const cipher = encryptSecret("secret");
    process.env.MAILBOX_ENC_KEY = KEY_B;
    expect(() => decryptSecret(cipher)).toThrow();
  });

  it("throws when the key is missing or wrong length", () => {
    delete process.env.MAILBOX_ENC_KEY;
    expect(() => encryptSecret("x")).toThrow(/MAILBOX_ENC_KEY/);
    process.env.MAILBOX_ENC_KEY = Buffer.from("tooshort").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mailCrypto.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/mail/crypto"` / module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/mail/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Server-only. AES-256-GCM. Stored form is `iv:tag:ciphertext`, each part
// base64. The 32-byte key comes from MAILBOX_ENC_KEY (base64). Never log
// plaintext or the key.

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

function getKey(): Buffer {
  const raw = process.env.MAILBOX_ENC_KEY;
  if (!raw) throw new Error("MAILBOX_ENC_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MAILBOX_ENC_KEY must decode to 32 bytes");
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return pt.toString("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mailCrypto.test.ts`
Expected: PASS — 5 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/mail/crypto.ts tests/mailCrypto.test.ts
git commit -m "feat(mail): AES-256-GCM secret crypto helper" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Migration `0036` + permission catalog (additive)

**Files:**
- Create: `supabase/migrations/0036_email_and_contracts.sql`
- Modify: `lib/permissions/constants.ts`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0036_email_and_contracts.sql`:
```sql
-- 0036_email_and_contracts.sql — company mailbox linking + contract management
-- ADDITIVE ONLY. Shared prod DB (ikuvbxjkoojtgekapbul): new tables + buckets +
-- permission rows only. No column drops, no type changes, no destructive edits.

-- Sub-project 1: linked company mailboxes. Credential is AES-256-GCM ciphertext
-- (encrypted app-side) — this column is NEVER selected into a client response.
create table if not exists public.company_mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email_address text not null unique,
  display_name text not null default '',
  imap_host text not null default 'imap.hostinger.com',
  imap_port int not null default 993,
  smtp_host text not null default 'smtp.hostinger.com',
  smtp_port int not null default 465,
  encrypted_password text not null,
  status text not null default 'unverified' check (status in ('unverified','verified','error')),
  last_verified_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists company_mailboxes_user_idx on public.company_mailboxes (user_id);

-- Sub-project 2: contracts. Field snapshot is captured at creation and never
-- mutated — a later lead edit cannot change a sent contract. Resend = new row.
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  mailbox_id uuid references public.company_mailboxes(id) on delete set null,
  template_key text not null default 'standard',
  business_name text not null default '',
  business_phone text,
  business_email text,
  one_time_price numeric(10,2),
  yearly_price numeric(10,2),
  agent_name text not null default '',
  contract_date date not null default current_date,
  message_body text not null default '',
  recipient_email text,
  pdf_path text,
  status text not null default 'draft' check (status in ('draft','sent')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists contracts_lead_idx on public.contracts (lead_id, created_at desc);
create index if not exists contracts_sent_idx on public.contracts (lead_id) where status = 'sent';

-- Per-user signature asset (uploaded PNG preferred, typed name fallback).
create table if not exists public.user_signatures (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  signature_image_path text,
  typed_name text,
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.company_mailboxes enable row level security;
alter table public.contracts enable row level security;
alter table public.user_signatures enable row level security;

-- company_mailboxes: NO policies. Holds a credential — service-role only, all
-- access via the admin client in permission-gated routes/pages.

-- contracts: readable by users who can view or send contracts; writes via service role.
create policy "read contracts" on public.contracts for select to authenticated
  using (public.has_permission('contracts.view') or public.has_permission('contracts.send'));

-- user_signatures: a user reads/writes only their own row.
create policy "read own signature" on public.user_signatures for select to authenticated
  using (user_id = auth.uid());
create policy "insert own signature" on public.user_signatures for insert to authenticated
  with check (user_id = auth.uid());
create policy "update own signature" on public.user_signatures for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- storage buckets (private)
insert into storage.buckets (id, name, public) values
  ('contracts','contracts', false),
  ('signatures','signatures', false)
on conflict (id) do nothing;

-- permissions
insert into public.permissions (key, name, description, category, is_sensitive) values
  ('mail.manage','Manage Company Mailboxes',null,'mail',true),
  ('contracts.view','View Contracts',null,'contracts',false),
  ('contracts.send','Create & Send Contracts',null,'contracts',true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, k.key from public.departments d
  cross join (values ('contracts.view'),('contracts.send')) as k(key)
  where d.slug in ('sales','closing','admin')
on conflict do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'mail.manage' from public.departments d where d.slug in ('admin')
on conflict do nothing;
```

- [ ] **Step 2: Add the new permission keys + categories to the TS catalog**

In `lib/permissions/constants.ts`, add these entries to the `PERMISSIONS` array (immediately after the `payments.manage` line, before the `templates.*` block):
```ts
  { key: "mail.manage", name: "Manage Company Mailboxes", category: "mail", is_sensitive: true },
  { key: "contracts.view", name: "View Contracts", category: "contracts" },
  { key: "contracts.send", name: "Create & Send Contracts", category: "contracts", is_sensitive: true },
```

In the same file, extend `PERMISSION_CATEGORIES` to include the two new categories:
```ts
export const PERMISSION_CATEGORIES = ["leads", "pre_leads", "analytics", "ai_tools", "admin", "tickets", "feedback", "dashboard", "payments", "templates", "mail", "contracts"] as const;
```

- [ ] **Step 3: Typecheck the catalog change**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/permissions/constants.ts`.

- [ ] **Step 4: Apply the migration to the shared DB (reviewed manual step)**

Apply `0036_email_and_contracts.sql` via the Supabase MCP `apply_migration` tool (project ref `ikuvbxjkoojtgekapbul`) or the hosted SQL editor. It is additive-only and safe. Verify with `list_tables` (or `select` in the SQL editor) that `company_mailboxes`, `contracts`, `user_signatures` exist and the `contracts`/`signatures` buckets are present. **Do not run any test website generation against this DB.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0036_email_and_contracts.sql lib/permissions/constants.ts
git commit -m "feat(db): additive migration for mailboxes, contracts, signatures + perms" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: `lib/mail` types + config helpers (TDD) + server seam

**Files:**
- Create: `lib/mail/types.ts`
- Create: `lib/mail/config.ts`
- Create: `lib/mail/mailbox.ts`
- Test: `tests/mailboxConfig.test.ts`

- [ ] **Step 1: Write the types**

Create `lib/mail/types.ts`:
```ts
export type MailboxStatus = "unverified" | "verified" | "error";

/** Row shape of public.company_mailboxes (including the secret column). */
export interface CompanyMailboxRow {
  id: string;
  user_id: string;
  email_address: string;
  display_name: string;
  imap_host: string | null;
  imap_port: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
  encrypted_password: string;
  status: MailboxStatus;
  last_verified_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
}

/** Decrypted, defaults-applied mailbox handed to send/verify code. Server-only. */
export interface ResolvedMailbox {
  id: string;
  userId: string;
  address: string;
  displayName: string;
  imap: { host: string; port: number };
  smtp: { host: string; port: number };
  password: string;
}

export const MAILBOX_DEFAULTS = {
  imap_host: "imap.hostinger.com",
  imap_port: 993,
  smtp_host: "smtp.hostinger.com",
  smtp_port: 465,
} as const;
```

- [ ] **Step 2: Write the failing config test**

Create `tests/mailboxConfig.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes } from "crypto";
import { encryptSecret } from "@/lib/mail/crypto";
import { resolveMailboxRow, buildImapConfig, buildSmtpConfig } from "@/lib/mail/config";
import type { CompanyMailboxRow } from "@/lib/mail/types";

const KEY = randomBytes(32).toString("base64");

function row(overrides: Partial<CompanyMailboxRow> = {}): CompanyMailboxRow {
  return {
    id: "m1", user_id: "u1", email_address: "agent@socialexpertdigitalllc.com",
    display_name: "Agent One", imap_host: null, imap_port: null,
    smtp_host: null, smtp_port: null, encrypted_password: encryptSecret("pw!"),
    status: "verified", last_verified_at: null, last_error: null,
    created_by: "u1", created_at: "2026-07-18T00:00:00Z", ...overrides,
  };
}

describe("mailbox config assembly", () => {
  beforeEach(() => { process.env.MAILBOX_ENC_KEY = KEY; });

  it("resolves a row: decrypts password, applies Hostinger defaults", () => {
    const m = resolveMailboxRow(row());
    expect(m.address).toBe("agent@socialexpertdigitalllc.com");
    expect(m.displayName).toBe("Agent One");
    expect(m.password).toBe("pw!");
    expect(m.imap).toEqual({ host: "imap.hostinger.com", port: 993 });
    expect(m.smtp).toEqual({ host: "smtp.hostinger.com", port: 465 });
  });

  it("keeps per-row host/port overrides when present", () => {
    const m = resolveMailboxRow(row({ imap_host: "imap.titan.email", imap_port: 993, smtp_host: "smtp.titan.email", smtp_port: 587 }));
    expect(m.imap).toEqual({ host: "imap.titan.email", port: 993 });
    expect(m.smtp).toEqual({ host: "smtp.titan.email", port: 587 });
  });

  it("builds an SSL imapflow config from a resolved mailbox", () => {
    const m = resolveMailboxRow(row());
    expect(buildImapConfig(m)).toEqual({
      host: "imap.hostinger.com", port: 993, secure: true,
      auth: { user: "agent@socialexpertdigitalllc.com", pass: "pw!" },
    });
  });

  it("builds an SSL nodemailer transport config from a resolved mailbox", () => {
    const m = resolveMailboxRow(row());
    expect(buildSmtpConfig(m)).toEqual({
      host: "smtp.hostinger.com", port: 465, secure: true,
      auth: { user: "agent@socialexpertdigitalllc.com", pass: "pw!" },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/mailboxConfig.test.ts`
Expected: FAIL — cannot resolve `@/lib/mail/config`.

- [ ] **Step 4: Write the config helpers**

Create `lib/mail/config.ts`:
```ts
import { decryptSecret } from "@/lib/mail/crypto";
import { MAILBOX_DEFAULTS, type CompanyMailboxRow, type ResolvedMailbox } from "@/lib/mail/types";

/** Map a DB row → ResolvedMailbox: decrypt the password, fill host/port defaults. */
export function resolveMailboxRow(r: CompanyMailboxRow): ResolvedMailbox {
  return {
    id: r.id,
    userId: r.user_id,
    address: r.email_address,
    displayName: r.display_name,
    imap: { host: r.imap_host || MAILBOX_DEFAULTS.imap_host, port: r.imap_port || MAILBOX_DEFAULTS.imap_port },
    smtp: { host: r.smtp_host || MAILBOX_DEFAULTS.smtp_host, port: r.smtp_port || MAILBOX_DEFAULTS.smtp_port },
    password: decryptSecret(r.encrypted_password),
  };
}

export function buildImapConfig(m: ResolvedMailbox) {
  return { host: m.imap.host, port: m.imap.port, secure: true, auth: { user: m.address, pass: m.password } };
}

export function buildSmtpConfig(m: ResolvedMailbox) {
  return { host: m.smtp.host, port: m.smtp.port, secure: true, auth: { user: m.address, pass: m.password } };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/mailboxConfig.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 6: Write the server seam (thin, not unit-tested)**

Create `lib/mail/mailbox.ts`:
```ts
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveMailboxRow, buildImapConfig, buildSmtpConfig } from "@/lib/mail/config";
import type { CompanyMailboxRow, ResolvedMailbox } from "@/lib/mail/types";

// Server-only seams. Every downstream feature (contract send, future inbox)
// builds on getMailboxById / getMailboxForUser and nothing else.

export async function getMailboxById(id: string): Promise<ResolvedMailbox | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("company_mailboxes").select("*").eq("id", id).maybeSingle();
  return data ? resolveMailboxRow(data as CompanyMailboxRow) : null;
}

/** The earliest verified mailbox owned by a user (the send-from identity). */
export async function getMailboxForUser(userId: string): Promise<ResolvedMailbox | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_mailboxes")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "verified")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? resolveMailboxRow(data as CompanyMailboxRow) : null;
}

/** Real IMAP + SMTP login. Both must succeed. Never throws — returns a result. */
export async function verifyMailboxCredentials(
  m: ResolvedMailbox
): Promise<{ ok: true } | { ok: false; error: string }> {
  const imap = new ImapFlow({ ...buildImapConfig(m), logger: false });
  try {
    await imap.connect();
    await imap.logout();
  } catch (e) {
    try { await imap.close(); } catch { /* already closed */ }
    return { ok: false, error: `IMAP: ${(e as Error).message}` };
  }
  try {
    const transport = nodemailer.createTransport(buildSmtpConfig(m));
    await transport.verify();
  } catch (e) {
    return { ok: false, error: `SMTP: ${(e as Error).message}` };
  }
  return { ok: true };
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `lib/mail/*`.

- [ ] **Step 8: Commit**

```bash
git add lib/mail/types.ts lib/mail/config.ts lib/mail/mailbox.ts tests/mailboxConfig.test.ts
git commit -m "feat(mail): mailbox types, pure config assembly, and IMAP/SMTP seam" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Mailbox link/verify/unlink API routes (admin-gated)

**Files:**
- Create: `lib/mail/schema.ts`
- Create: `app/api/admin/mail/mailboxes/route.ts`
- Create: `app/api/admin/mail/mailboxes/[id]/route.ts`
- Create: `app/api/admin/mail/mailboxes/[id]/verify/route.ts`
- Test: `tests/mailSchema.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `tests/mailSchema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { linkMailboxSchema } from "@/lib/mail/schema";

const base = {
  user_id: "11111111-1111-1111-1111-111111111111",
  email_address: "agent@socialexpertdigitalllc.com",
  display_name: "Agent One",
  password: "s3cret",
};

describe("linkMailboxSchema", () => {
  it("accepts a minimal valid link (host/port optional)", () => {
    expect(linkMailboxSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a non-email address and empty password", () => {
    expect(linkMailboxSchema.safeParse({ ...base, email_address: "nope" }).success).toBe(false);
    expect(linkMailboxSchema.safeParse({ ...base, password: "" }).success).toBe(false);
  });
  it("rejects a bad user_id and non-positive port", () => {
    expect(linkMailboxSchema.safeParse({ ...base, user_id: "x" }).success).toBe(false);
    expect(linkMailboxSchema.safeParse({ ...base, imap_port: 0 }).success).toBe(false);
  });
  it("accepts advanced host/port overrides", () => {
    expect(linkMailboxSchema.safeParse({ ...base, imap_host: "imap.titan.email", imap_port: 993, smtp_host: "smtp.titan.email", smtp_port: 587 }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mailSchema.test.ts`
Expected: FAIL — cannot resolve `@/lib/mail/schema`.

- [ ] **Step 3: Write the schema**

Create `lib/mail/schema.ts`:
```ts
import { z } from "zod";

export const linkMailboxSchema = z.object({
  user_id: z.string().uuid(),
  email_address: z.string().trim().email().max(200),
  display_name: z.string().trim().max(120).default(""),
  password: z.string().min(1).max(500),
  imap_host: z.string().trim().min(1).max(200).optional(),
  imap_port: z.number().int().positive().max(65535).optional(),
  smtp_host: z.string().trim().min(1).max(200).optional(),
  smtp_port: z.number().int().positive().max(65535).optional(),
});
export type LinkMailboxInput = z.infer<typeof linkMailboxSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mailSchema.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Write the list + link route**

Create `app/api/admin/mail/mailboxes/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { linkMailboxSchema } from "@/lib/mail/schema";
import { encryptSecret } from "@/lib/mail/crypto";
import { resolveMailboxRow } from "@/lib/mail/config";
import { verifyMailboxCredentials } from "@/lib/mail/mailbox";
import { MAILBOX_DEFAULTS, type CompanyMailboxRow } from "@/lib/mail/types";

export const runtime = "nodejs";

// Columns safe to return to the client — NEVER encrypted_password.
const SAFE_COLS =
  "id, user_id, email_address, display_name, imap_host, imap_port, smtp_host, smtp_port, status, last_verified_at, last_error, created_at";

async function guard(): Promise<{ userId: string } | { error: 401 | 403 }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("mail.manage")) return { error: 403 };
  return { userId: user.id };
}

function guardError(status: 401 | 403) {
  return NextResponse.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}

export async function GET() {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);
  const admin = createAdminClient();
  const { data, error } = await admin.from("company_mailboxes").select(SAFE_COLS).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ mailboxes: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) return guardError(auth.error);

  const parsed = linkMailboxSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 422 });
  }
  const input = parsed.data;
  const admin = createAdminClient();

  // Insert unverified first (encrypted). Never store or log the plaintext.
  const insertRow = {
    user_id: input.user_id,
    email_address: input.email_address,
    display_name: input.display_name,
    imap_host: input.imap_host ?? MAILBOX_DEFAULTS.imap_host,
    imap_port: input.imap_port ?? MAILBOX_DEFAULTS.imap_port,
    smtp_host: input.smtp_host ?? MAILBOX_DEFAULTS.smtp_host,
    smtp_port: input.smtp_port ?? MAILBOX_DEFAULTS.smtp_port,
    encrypted_password: encryptSecret(input.password),
    status: "unverified" as const,
    created_by: auth.userId,
  };
  const { data: inserted, error: insErr } = await admin
    .from("company_mailboxes")
    .insert(insertRow)
    .select("*")
    .single();
  if (insErr || !inserted) {
    const dup = insErr?.code === "23505";
    return NextResponse.json(
      { error: dup ? "That email address is already linked" : insErr?.message ?? "Insert failed" },
      { status: dup ? 409 : 400 }
    );
  }

  // Real IMAP + SMTP login.
  const result = await verifyMailboxCredentials(resolveMailboxRow(inserted as CompanyMailboxRow));
  const patch = result.ok
    ? { status: "verified" as const, last_verified_at: new Date().toISOString(), last_error: null }
    : { status: "error" as const, last_error: result.error };
  await admin.from("company_mailboxes").update(patch).eq("id", inserted.id);

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "mailbox.linked",
    entity_type: "company_mailbox",
    entity_id: inserted.id,
    new_value: { email_address: input.email_address, status: patch.status },
  });

  const { data: safe } = await admin.from("company_mailboxes").select(SAFE_COLS).eq("id", inserted.id).single();
  return NextResponse.json({ mailbox: safe }, { status: 201 });
}
```

- [ ] **Step 6: Write the re-verify route**

Create `app/api/admin/mail/mailboxes/[id]/verify/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getMailboxById, verifyMailboxCredentials } from "@/lib/mail/mailbox";

export const runtime = "nodejs";

const SAFE_COLS =
  "id, user_id, email_address, display_name, imap_host, imap_port, smtp_host, smtp_port, status, last_verified_at, last_error, created_at";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("mail.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const mailbox = await getMailboxById(id);
  if (!mailbox) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });

  const result = await verifyMailboxCredentials(mailbox);
  const patch = result.ok
    ? { status: "verified" as const, last_verified_at: new Date().toISOString(), last_error: null }
    : { status: "error" as const, last_error: result.error };

  const admin = createAdminClient();
  await admin.from("company_mailboxes").update(patch).eq("id", id);
  const { data: safe } = await admin.from("company_mailboxes").select(SAFE_COLS).eq("id", id).single();
  return NextResponse.json({ mailbox: safe });
}
```

- [ ] **Step 7: Write the unlink route**

Create `app/api/admin/mail/mailboxes/[id]/route.ts`:
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
  if (!perms.has("mail.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { error } = await admin.from("company_mailboxes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: "mailbox.unlinked",
    entity_type: "company_mailbox",
    entity_id: id,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in the three new route files.

- [ ] **Step 9: Commit**

```bash
git add lib/mail/schema.ts tests/mailSchema.test.ts app/api/admin/mail
git commit -m "feat(mail): admin link/verify/unlink mailbox routes (encrypt, never return password)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Company Mail admin UI + nav

**Files:**
- Create: `app/(app)/admin/mail/page.tsx`
- Create: `components/mail/CompanyMailManager.tsx`
- Modify: `components/layout/Sidebar.tsx`

- [ ] **Step 1: Write the server page**

Create `app/(app)/admin/mail/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { CompanyMailManager, type MailboxListItem } from "@/components/mail/CompanyMailManager";

export default async function CompanyMailPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("mail.manage")) redirect("/dashboard");

  const admin = createAdminClient();
  // No encrypted_password in this select — the secret never reaches the client.
  const { data: mailboxes } = await admin
    .from("company_mailboxes")
    .select("id, user_id, email_address, display_name, imap_host, imap_port, smtp_host, smtp_port, status, last_verified_at, last_error, created_at")
    .order("created_at", { ascending: false });

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .eq("is_active", true)
    .order("display_name");

  const owners = (profiles ?? []).map((p) => ({ id: p.id, name: p.display_name ?? "—" }));
  const ownerName: Record<string, string> = {};
  for (const o of owners) ownerName[o.id] = o.name;

  const items: MailboxListItem[] = (mailboxes ?? []).map((m) => ({ ...m, owner_name: ownerName[m.user_id] ?? "—" }));

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">Company Mail</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Link a manually-created Hostinger mailbox to a user. The password is stored encrypted and used only to send/read mail server-side.
        </p>
      </div>
      <CompanyMailManager initial={items} owners={owners} />
    </div>
  );
}
```

- [ ] **Step 2: Write the client manager component**

Create `components/mail/CompanyMailManager.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, RefreshCw, Trash2, ChevronDown, ChevronUp, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, FormSection, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { MAILBOX_DEFAULTS } from "@/lib/mail/types";

export type MailboxListItem = {
  id: string; user_id: string; email_address: string; display_name: string;
  imap_host: string | null; imap_port: number | null; smtp_host: string | null; smtp_port: number | null;
  status: "unverified" | "verified" | "error"; last_verified_at: string | null; last_error: string | null;
  created_at: string; owner_name: string;
};
type Owner = { id: string; name: string };

const STATUS_PILL: Record<MailboxListItem["status"], string> = {
  verified: "bg-ready-bg text-ready-fg",
  error: "bg-dropped-bg text-dropped-fg",
  unverified: "bg-notready-bg text-notready-fg",
};
const STATUS_ICON = { verified: ShieldCheck, error: ShieldAlert, unverified: ShieldQuestion };

export function CompanyMailManager({ initial, owners }: { initial: MailboxListItem[]; owners: Owner[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<MailboxListItem[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [userId, setUserId] = useState(owners[0]?.id ?? "");
  const [address, setAddress] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [imapHost, setImapHost] = useState(MAILBOX_DEFAULTS.imap_host);
  const [imapPort, setImapPort] = useState(String(MAILBOX_DEFAULTS.imap_port));
  const [smtpHost, setSmtpHost] = useState(MAILBOX_DEFAULTS.smtp_host);
  const [smtpPort, setSmtpPort] = useState(String(MAILBOX_DEFAULTS.smtp_port));
  const [submitting, setSubmitting] = useState(false);

  async function link(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { user_id: userId, email_address: address, display_name: displayName, password };
      if (advanced) {
        body.imap_host = imapHost; body.imap_port = Number(imapPort);
        body.smtp_host = smtpHost; body.smtp_port = Number(smtpPort);
      }
      const res = await fetch("/api/admin/mail/mailboxes", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Link failed", body: data.error }); return; }
      setRows((prev) => [{ ...data.mailbox, owner_name: owners.find((o) => o.id === userId)?.name ?? "—" }, ...prev]);
      setPassword(""); setAddress(""); setDisplayName("");
      toast({
        kind: data.mailbox.status === "verified" ? "success" : "error",
        title: data.mailbox.status === "verified" ? "Mailbox verified" : "Linked, but verification failed",
        body: data.mailbox.last_error ?? undefined,
      });
      router.refresh();
    } finally { setSubmitting(false); }
  }

  async function reverify(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/mail/mailboxes/${id}/verify`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Verify failed", body: data.error }); return; }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...data.mailbox, owner_name: r.owner_name } : r)));
      toast({ kind: data.mailbox.status === "verified" ? "success" : "error", title: `Status: ${data.mailbox.status}`, body: data.mailbox.last_error ?? undefined });
    } finally { setBusyId(null); }
  }

  async function unlink(id: string) {
    if (!confirm("Unlink this mailbox? The stored credential is deleted.")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/mail/mailboxes/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); toast({ kind: "error", title: "Unlink failed", body: d.error }); return; }
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast({ kind: "success", title: "Mailbox unlinked" });
    } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={link} className="rounded-lg border border-border bg-surface p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text"><Mail className="w-4 h-4" /> Link a mailbox</div>
        <FormSection title="Mailbox">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Owner" required>
              <select className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <Field label="Display name">
              <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Agent One" />
            </Field>
            <Field label="Email address" required>
              <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="agent@socialexpertdigitalllc.com" />
            </Field>
            <Field label="Password" required hint="Stored encrypted; never shown again.">
              <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
        </FormSection>

        <button type="button" onClick={() => setAdvanced((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text">
          {advanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />} Advanced (host / port override)
        </button>
        {advanced && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="IMAP host"><input className={inputCls} value={imapHost} onChange={(e) => setImapHost(e.target.value)} /></Field>
            <Field label="IMAP port"><input className={inputCls} inputMode="numeric" value={imapPort} onChange={(e) => setImapPort(e.target.value)} /></Field>
            <Field label="SMTP host"><input className={inputCls} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} /></Field>
            <Field label="SMTP port"><input className={inputCls} inputMode="numeric" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} /></Field>
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={submitting || !address || !password} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
            {submitting ? "Linking…" : "Link & verify"}
          </button>
        </div>
      </form>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-text-muted">
            <tr>
              <th className="text-left font-medium px-3 py-2">Address</th>
              <th className="text-left font-medium px-3 py-2">Owner</th>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="text-left font-medium px-3 py-2">Last verified</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-text-faint">No mailboxes linked yet.</td></tr>
            )}
            {rows.map((r) => {
              const Icon = STATUS_ICON[r.status];
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium text-text">{r.email_address}</div>
                    {r.status === "error" && r.last_error && <div className="text-[11px] text-dropped-fg truncate max-w-xs">{r.last_error}</div>}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{r.owner_name}</td>
                  <td className="px-3 py-2">
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_PILL[r.status])}>
                      <Icon className="w-3 h-3" /> {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-faint">{r.last_verified_at ? new Date(r.last_verified_at).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => reverify(r.id)} disabled={busyId === r.id} title="Re-verify" className="p-1.5 rounded text-text-muted hover:text-text hover:bg-surface-2 disabled:opacity-50">
                        <RefreshCw className={cn("w-4 h-4", busyId === r.id && "animate-spin")} />
                      </button>
                      <button onClick={() => unlink(r.id)} disabled={busyId === r.id} title="Unlink" className="p-1.5 rounded text-text-muted hover:text-dropped-fg hover:bg-surface-2 disabled:opacity-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add nav items**

In `components/layout/Sidebar.tsx`, add `Mail` and `FileText` to the lucide-react import list at the top (extend the existing `import { ... } from "lucide-react";`). Then add to the `MAIN` array (after the Payments entry):
```ts
  { href: "/contracts", label: "Contracts", icon: FileText, perm: "contracts.view" },
```
And add to the `ADMIN` array (after the Add-ons entry):
```ts
  { href: "/admin/mail", label: "Company Mail", icon: Mail, perm: "mail.manage" },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `app/(app)/admin/mail/page.tsx`, `components/mail/CompanyMailManager.tsx`, `components/layout/Sidebar.tsx`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/admin/mail" components/mail/CompanyMailManager.tsx components/layout/Sidebar.tsx
git commit -m "feat(mail): Company Mail admin UI + nav entries" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: `lib/contracts/merge.ts` — snapshot + validation + display lines (TDD)

**Files:**
- Create: `lib/contracts/types.ts`
- Create: `lib/contracts/merge.ts`
- Test: `tests/contractMerge.test.ts`

- [ ] **Step 1: Write the types**

Create `lib/contracts/types.ts`:
```ts
export interface ContractSnapshot {
  business_name: string;
  business_phone: string | null;
  business_email: string | null;
  one_time_price: number | null;
  yearly_price: number | null;
  agent_name: string;
  contract_date: string; // YYYY-MM-DD
}

export interface ContractRow {
  id: string;
  lead_id: string;
  created_by: string | null;
  mailbox_id: string | null;
  template_key: string;
  business_name: string;
  business_phone: string | null;
  business_email: string | null;
  one_time_price: number | null;
  yearly_price: number | null;
  agent_name: string;
  contract_date: string;
  message_body: string;
  recipient_email: string | null;
  pdf_path: string | null;
  status: "draft" | "sent";
  sent_at: string | null;
  created_at: string;
}

/** Row shape for the contracts list (joins in a business/lead label). */
export interface ContractListItem extends ContractRow {
  lead_business_name: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/contractMerge.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { Lead } from "@/lib/leads/types";
import { parsePrice, buildContractSnapshot, validateMergeFields, contractLines, formatUsd } from "@/lib/contracts/merge";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "l1", status: "Ready", agent_id: null, business_name: "Acme Plumbing",
    business_phone: "+1 555 111 2222", business_email: "owner@acme.test", no_email: false,
    business_profile_link: null, website_link: null, logo_link: null, logo_via_sms: null,
    map_embed_link: null, site_type: null, platform: null, services: null, service_areas: null,
    has_service_areas: null, client_experience: null, num_webpages: null, specify_pages: null,
    color_scheme: null, color_same_as_logo: null, add_ons: null, price_quoted: 1200,
    yearly_price: "300", follow_up_time: null, last_followup_status: null, no_pickup_streak: 0,
    direct_line_saved: null, fresh_or_followup: null, reference_link: null, design_reference_links: null,
    image_links: null, rating: null, comments: null, created_by: null, closed_by: null,
    created_at: "2026-07-18T00:00:00Z", updated_at: "2026-07-18T00:00:00Z", deleted_at: null,
    ...overrides,
  };
}

describe("parsePrice", () => {
  it("passes numbers through when positive", () => expect(parsePrice(1200)).toBe(1200));
  it("parses a numeric string, stripping symbols/commas", () => expect(parsePrice("$1,200.50")).toBe(1200.5));
  it("returns null for null, blank, zero, negative, or garbage", () => {
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice(0)).toBeNull();
    expect(parsePrice(-5)).toBeNull();
    expect(parsePrice("abc")).toBeNull();
  });
});

describe("buildContractSnapshot", () => {
  it("copies lead fields, coercing yearly_price string → number", () => {
    const s = buildContractSnapshot(lead(), { agentName: "Jordan", contractDate: "2026-07-18" });
    expect(s).toEqual({
      business_name: "Acme Plumbing", business_phone: "+1 555 111 2222", business_email: "owner@acme.test",
      one_time_price: 1200, yearly_price: 300, agent_name: "Jordan", contract_date: "2026-07-18",
    });
  });
  it("nulls prices that are missing/invalid", () => {
    const s = buildContractSnapshot(lead({ price_quoted: null, yearly_price: null }), { agentName: "J", contractDate: "2026-07-18" });
    expect(s.one_time_price).toBeNull();
    expect(s.yearly_price).toBeNull();
  });
});

describe("validateMergeFields", () => {
  it("passes a complete lead", () => expect(validateMergeFields(lead())).toEqual({ ok: true, missing: [] }));
  it("flags a blank business name", () => {
    expect(validateMergeFields(lead({ business_name: "  " })).missing).toContain("Business name");
  });
  it("flags a missing email (even when no_email is set — can't send without a recipient)", () => {
    const v = validateMergeFields(lead({ business_email: null, no_email: true }));
    expect(v.ok).toBe(false);
    expect(v.missing).toContain("Business email");
  });
  it("flags a missing one-time price", () => {
    expect(validateMergeFields(lead({ price_quoted: null })).missing).toContain("One-time price");
  });
});

describe("contractLines / formatUsd", () => {
  it("formats currency and dashes for null", () => {
    expect(formatUsd(1200)).toBe("$1,200.00");
    expect(formatUsd(null)).toBe("—");
  });
  it("produces labelled display lines with merged values", () => {
    const s = buildContractSnapshot(lead(), { agentName: "Jordan", contractDate: "2026-07-18" });
    const lines = contractLines(s);
    expect(lines.find((l) => l.label === "Business")?.value).toBe("Acme Plumbing");
    expect(lines.find((l) => l.label === "One-time price")?.value).toBe("$1,200.00");
    expect(lines.find((l) => l.label === "Yearly price")?.value).toBe("$300.00");
    expect(lines.find((l) => l.label === "Prepared by")?.value).toBe("Jordan");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/contractMerge.test.ts`
Expected: FAIL — cannot resolve `@/lib/contracts/merge`.

- [ ] **Step 4: Write the implementation**

Create `lib/contracts/merge.ts`:
```ts
import type { Lead } from "@/lib/leads/types";
import type { ContractSnapshot } from "@/lib/contracts/types";

/** Coerce a price (number or string like "$1,200.50") to a positive number, else null. */
export function parsePrice(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Snapshot the lead's mergeable fields at contract-creation time. */
export function buildContractSnapshot(
  lead: Lead,
  opts: { agentName: string; contractDate: string }
): ContractSnapshot {
  return {
    business_name: lead.business_name ?? "",
    business_phone: lead.business_phone ?? null,
    business_email: lead.business_email ?? null,
    one_time_price: parsePrice(lead.price_quoted),
    yearly_price: parsePrice(lead.yearly_price),
    agent_name: opts.agentName,
    contract_date: opts.contractDate,
  };
}

/** Gate before preview: every required merge field must be present. */
export function validateMergeFields(lead: Lead): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!lead.business_name?.trim()) missing.push("Business name");
  if (!lead.business_email?.trim()) missing.push("Business email");
  if (parsePrice(lead.price_quoted) === null) missing.push("One-time price");
  return { ok: missing.length === 0, missing };
}

export function formatUsd(n: number | null): string {
  return n === null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Labelled display lines the PDF body renders (pure — asserted in tests). */
export function contractLines(s: ContractSnapshot): { label: string; value: string }[] {
  return [
    { label: "Business", value: s.business_name || "—" },
    { label: "Phone", value: s.business_phone || "—" },
    { label: "Email", value: s.business_email || "—" },
    { label: "One-time price", value: formatUsd(s.one_time_price) },
    { label: "Yearly price", value: formatUsd(s.yearly_price) },
    { label: "Prepared by", value: s.agent_name || "—" },
    { label: "Date", value: s.contract_date },
  ];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/contractMerge.test.ts`
Expected: PASS — all suites green.

- [ ] **Step 6: Commit**

```bash
git add lib/contracts/types.ts lib/contracts/merge.ts tests/contractMerge.test.ts
git commit -m "feat(contracts): lead→snapshot merge, missing-field validation, display lines" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: `lib/contracts/ContractDocument.tsx` — pure-JS PDF

**Files:**
- Create: `lib/contracts/ContractDocument.tsx`

> **Implementation input (later):** the exact wording/layout of the current Google-Doc contract is to be supplied and dropped into `INTRO_PARAGRAPHS` / `TERMS` below. Until then this faithful placeholder carries every merge field + a signature block so the pipeline is fully wired. No component test (house rule); the merged values it renders come from the tested `contractLines`.

- [ ] **Step 1: Write the document + render helper**

Create `lib/contracts/ContractDocument.tsx`:
```tsx
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { contractLines } from "@/lib/contracts/merge";
import type { ContractSnapshot } from "@/lib/contracts/types";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.5 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#666", marginBottom: 20 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 18, marginBottom: 8 },
  para: { marginBottom: 10 },
  row: { flexDirection: "row", marginBottom: 4 },
  label: { width: 130, color: "#666" },
  value: { flex: 1, fontFamily: "Helvetica-Bold" },
  sigBlock: { marginTop: 40, borderTop: "1 solid #ccc", paddingTop: 16 },
  sigImage: { width: 160, height: 60, objectFit: "contain" },
  sigTyped: { fontSize: 22, fontFamily: "Times-Italic" },
  sigName: { fontSize: 10, color: "#666", marginTop: 4 },
});

// Placeholder contract prose — replace with the exported Google-Doc text.
const INTRO_PARAGRAPHS = [
  "This agreement is made between Social Expert Digital LLC (\"Provider\") and the business named below (\"Client\") for the website services described herein.",
  "The Client agrees to the one-time build fee and, where applicable, the recurring yearly maintenance fee set out below.",
];
const TERMS = [
  "1. Scope: Provider will design and deliver the agreed website deliverables.",
  "2. Payment: The one-time price is due per the agreed schedule; the yearly price recurs annually where applicable.",
  "3. Ownership: On full payment, the delivered site assets transfer to the Client.",
];

export function ContractDocument({
  snapshot,
  signature,
}: {
  snapshot: ContractSnapshot;
  signature: { imageDataUrl?: string; typedName?: string };
}) {
  const lines = contractLines(snapshot);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Website Services Agreement</Text>
        <Text style={styles.subtitle}>Social Expert Digital LLC</Text>

        {INTRO_PARAGRAPHS.map((p, i) => <Text key={i} style={styles.para}>{p}</Text>)}

        <Text style={styles.h2}>Contract details</Text>
        {lines.map((l) => (
          <View key={l.label} style={styles.row}>
            <Text style={styles.label}>{l.label}</Text>
            <Text style={styles.value}>{l.value}</Text>
          </View>
        ))}

        <Text style={styles.h2}>Terms</Text>
        {TERMS.map((t, i) => <Text key={i} style={styles.para}>{t}</Text>)}

        <View style={styles.sigBlock}>
          {signature.imageDataUrl ? (
            <Image style={styles.sigImage} src={signature.imageDataUrl} />
          ) : signature.typedName ? (
            <Text style={styles.sigTyped}>{signature.typedName}</Text>
          ) : (
            <Text style={styles.sigTyped}> </Text>
          )}
          <Text style={styles.sigName}>{snapshot.agent_name || "Social Expert Digital LLC"}</Text>
        </View>
      </Page>
    </Document>
  );
}

/** Render the contract to a PDF Buffer (server-only). */
export async function renderContractPdf(
  snapshot: ContractSnapshot,
  signature: { imageDataUrl?: string; typedName?: string }
): Promise<Buffer> {
  return renderToBuffer(<ContractDocument snapshot={snapshot} signature={signature} />);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `lib/contracts/ContractDocument.tsx`. (If `renderToBuffer` on the JSX element reports a type mismatch, cast with `renderToBuffer(<ContractDocument … /> as never)` — `@react-pdf/renderer`'s element typing sometimes lags React 19.)

- [ ] **Step 3: Commit**

```bash
git add lib/contracts/ContractDocument.tsx
git commit -m "feat(contracts): pure-JS @react-pdf contract document + render helper" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: Signature render-rule helper (TDD) + upload route

**Files:**
- Create: `lib/contracts/signature.ts`
- Create: `lib/contracts/schema.ts`
- Create: `app/api/me/signature/route.ts`
- Test: `tests/contractSignature.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/contractSignature.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveSignature } from "@/lib/contracts/signature";
import { signatureSchema } from "@/lib/contracts/schema";

describe("resolveSignature", () => {
  it("prefers the uploaded image when present", () => {
    expect(resolveSignature({ signature_image_path: "u1/sig.png", typed_name: "Jordan" }))
      .toEqual({ kind: "image", path: "u1/sig.png" });
  });
  it("falls back to a typed name when there is no image", () => {
    expect(resolveSignature({ signature_image_path: null, typed_name: "Jordan" }))
      .toEqual({ kind: "typed", name: "Jordan" });
  });
  it("trims the typed name", () => {
    expect(resolveSignature({ signature_image_path: null, typed_name: "  Jordan  " }))
      .toEqual({ kind: "typed", name: "Jordan" });
  });
  it("returns none when both are empty or the row is missing", () => {
    expect(resolveSignature({ signature_image_path: null, typed_name: "   " })).toEqual({ kind: "none" });
    expect(resolveSignature(null)).toEqual({ kind: "none" });
  });
});

describe("signatureSchema", () => {
  it("accepts a typed name or null", () => {
    expect(signatureSchema.safeParse({ typed_name: "Jordan" }).success).toBe(true);
    expect(signatureSchema.safeParse({ typed_name: null }).success).toBe(true);
    expect(signatureSchema.safeParse({}).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/contractSignature.test.ts`
Expected: FAIL — cannot resolve `@/lib/contracts/signature`.

- [ ] **Step 3: Write the helper + schema**

Create `lib/contracts/signature.ts`:
```ts
export type SignatureRow = { signature_image_path: string | null; typed_name: string | null };
export type ResolvedSignature =
  | { kind: "image"; path: string }
  | { kind: "typed"; name: string }
  | { kind: "none" };

/** Render rule: uploaded image wins, else typed name, else nothing. */
export function resolveSignature(row: SignatureRow | null): ResolvedSignature {
  if (row?.signature_image_path) return { kind: "image", path: row.signature_image_path };
  const typed = row?.typed_name?.trim();
  if (typed) return { kind: "typed", name: typed };
  return { kind: "none" };
}
```

Create `lib/contracts/schema.ts`:
```ts
import { z } from "zod";

export const createContractSchema = z.object({
  lead_id: z.string().uuid(),
  mailbox_id: z.string().uuid(),
  template_key: z.string().trim().min(1).max(60).default("standard"),
  message_body: z.string().trim().max(5000).default(""),
});
export type CreateContractInput = z.infer<typeof createContractSchema>;

export const signatureSchema = z.object({
  typed_name: z.string().trim().max(120).nullable().optional(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/contractSignature.test.ts`
Expected: PASS — 5 passed.

- [ ] **Step 5: Write the signature route**

Create `app/api/me/signature/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { signatureSchema } from "@/lib/contracts/schema";

export const runtime = "nodejs";

const ALLOWED_TYPES: Record<string, string> = { "image/png": "png" };
const MAX_SIZE = 1 * 1024 * 1024;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_signatures")
    .select("signature_image_path, typed_name, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({ signature: data ?? null });
}

export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();

  const form = await req.formData();
  const typedParsed = signatureSchema.safeParse({ typed_name: form.get("typed_name") ?? undefined });
  if (!typedParsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: typedParsed.error.flatten() }, { status: 422 });
  }

  const patch: Record<string, unknown> = { user_id: user.id, updated_at: new Date().toISOString() };
  if (typedParsed.data.typed_name !== undefined) patch.typed_name = typedParsed.data.typed_name;

  const image = form.get("image");
  if (image instanceof File && image.size > 0) {
    if (!ALLOWED_TYPES[image.type]) return NextResponse.json({ error: "Signature must be a PNG" }, { status: 422 });
    if (image.size > MAX_SIZE) return NextResponse.json({ error: "Signature must be 1MB or smaller" }, { status: 422 });
    const path = `${user.id}/signature.png`;
    const { error: upErr } = await admin.storage.from("signatures").upload(path, image, { contentType: "image/png", upsert: true });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    patch.signature_image_path = path;
  } else if (form.get("clear_image") === "true") {
    patch.signature_image_path = null;
  }

  const { data, error } = await admin
    .from("user_signatures")
    .upsert(patch, { onConflict: "user_id" })
    .select("signature_image_path, typed_name, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ signature: data });
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/contracts/signature.ts lib/contracts/schema.ts app/api/me/signature/route.ts tests/contractSignature.test.ts
git commit -m "feat(contracts): signature render-rule + own-signature upload route" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: Contract create/preview API

**Files:**
- Create: `lib/contracts/pdf.ts`
- Create: `app/api/contracts/route.ts`
- Create: `app/api/contracts/[id]/pdf/route.ts`

- [ ] **Step 1: Write a shared PDF-prep helper (resolves the signature to render args)**

Create `lib/contracts/pdf.ts`:
```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSignature } from "@/lib/contracts/signature";

/** Load a user's signature and turn it into renderContractPdf's second arg. */
export async function signatureRenderArgs(userId: string): Promise<{ imageDataUrl?: string; typedName?: string }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_signatures")
    .select("signature_image_path, typed_name")
    .eq("user_id", userId)
    .maybeSingle();
  const resolved = resolveSignature(data ?? null);
  if (resolved.kind === "image") {
    const { data: blob } = await admin.storage.from("signatures").download(resolved.path);
    if (blob) {
      const b64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      return { imageDataUrl: `data:image/png;base64,${b64}` };
    }
  }
  if (resolved.kind === "typed") return { typedName: resolved.name };
  return {};
}
```

- [ ] **Step 2: Write the create-draft route**

Create `app/api/contracts/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { createContractSchema } from "@/lib/contracts/schema";
import { buildContractSnapshot, validateMergeFields } from "@/lib/contracts/merge";
import { isContractTemplateKey } from "@/lib/contracts/templates";
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

  // Load the lead (admin client — server-gated above).
  const { data: leadRaw } = await admin.from("leads").select("*").eq("id", input.lead_id).is("deleted_at", null).maybeSingle();
  if (!leadRaw) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const lead = leadRaw as Lead;

  // Merge-field validation gate — block before any draft/preview exists.
  const check = validateMergeFields(lead);
  if (!check.ok) {
    return NextResponse.json({ error: "Missing required fields", missing: check.missing }, { status: 422 });
  }

  // The mailbox must exist and be verified.
  const { data: mailbox } = await admin
    .from("company_mailboxes")
    .select("id, status")
    .eq("id", input.mailbox_id)
    .maybeSingle();
  if (!mailbox) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
  if (mailbox.status !== "verified") return NextResponse.json({ error: "Selected mailbox is not verified" }, { status: 409 });

  const { data: profile } = await admin.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const agentName = profile?.display_name ?? "";
  const contractDate = new Date().toISOString().slice(0, 10);
  const snapshot = buildContractSnapshot(lead, { agentName, contractDate });

  const { data: contract, error } = await admin
    .from("contracts")
    .insert({
      lead_id: input.lead_id,
      created_by: user.id,
      mailbox_id: input.mailbox_id,
      template_key: input.template_key,
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

  await admin.from("activity_log").insert({
    user_id: user.id, action: "contract.created", entity_type: "contract", entity_id: contract.id,
    new_value: { lead_id: input.lead_id },
  });

  return NextResponse.json({ contract }, { status: 201 });
}
```

- [ ] **Step 3: Write the preview/download PDF route**

Create `app/api/contracts/[id]/pdf/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { renderContractPdf } from "@/lib/contracts/ContractDocument";
import { signatureRenderArgs } from "@/lib/contracts/pdf";
import type { ContractRow } from "@/lib/contracts/types";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("contracts.view") && !perms.has("contracts.send")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: c } = await admin.from("contracts").select("*").eq("id", id).maybeSingle();
  if (!c) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  const contract = c as ContractRow;

  // Sent contracts serve their retained PDF; drafts render live from the snapshot.
  if (contract.status === "sent" && contract.pdf_path) {
    const { data: blob } = await admin.storage.from("contracts").download(contract.pdf_path);
    if (blob) {
      return new Response(blob, {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="contract-${id}.pdf"` },
      });
    }
  }

  const sig = await signatureRenderArgs(contract.created_by ?? user.id);
  const buffer = await renderContractPdf(
    {
      business_name: contract.business_name,
      business_phone: contract.business_phone,
      business_email: contract.business_email,
      one_time_price: contract.one_time_price,
      yearly_price: contract.yearly_price,
      agent_name: contract.agent_name,
      contract_date: contract.contract_date,
    },
    sig
  );
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="contract-${id}.pdf"` },
  });
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in the two route files or `lib/contracts/pdf.ts`. (`isContractTemplateKey` is created in Task 14; if executing strictly in order, temporarily inline `input.template_key === "standard"` here and switch to `isContractTemplateKey` in Task 14 Step 3. Prefer doing Task 14 Step 1–2 first so the import resolves.)

- [ ] **Step 5: Commit**

```bash
git add lib/contracts/pdf.ts app/api/contracts/route.ts "app/api/contracts/[id]/pdf/route.ts"
git commit -m "feat(contracts): create-draft API (merge+validate) and preview/download PDF route" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: Contract send API

**Files:**
- Create: `app/api/contracts/[id]/send/route.ts`

- [ ] **Step 1: Write the send route**

Create `app/api/contracts/[id]/send/route.ts`:
```ts
import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { getMailboxById } from "@/lib/mail/mailbox";
import { buildSmtpConfig } from "@/lib/mail/config";
import { renderContractPdf } from "@/lib/contracts/ContractDocument";
import { signatureRenderArgs } from "@/lib/contracts/pdf";
import type { ContractRow } from "@/lib/contracts/types";

export const runtime = "nodejs";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!perms.has("contracts.send")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: c } = await admin.from("contracts").select("*").eq("id", id).maybeSingle();
  if (!c) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  const contract = c as ContractRow;

  if (contract.status === "sent") return NextResponse.json({ error: "Contract already sent — resend creates a new record" }, { status: 409 });
  if (!contract.mailbox_id) return NextResponse.json({ error: "No sending mailbox on this contract" }, { status: 409 });
  if (!contract.recipient_email) return NextResponse.json({ error: "No recipient email on this contract" }, { status: 409 });

  const mailbox = await getMailboxById(contract.mailbox_id);
  if (!mailbox) return NextResponse.json({ error: "Sending mailbox not found" }, { status: 409 });

  // Render the final PDF from the immutable snapshot.
  const sig = await signatureRenderArgs(contract.created_by ?? user.id);
  const pdf = await renderContractPdf(
    {
      business_name: contract.business_name, business_phone: contract.business_phone,
      business_email: contract.business_email, one_time_price: contract.one_time_price,
      yearly_price: contract.yearly_price, agent_name: contract.agent_name, contract_date: contract.contract_date,
    },
    sig
  );

  // Send via SMTP. Any failure leaves the contract a draft (never a false "sent").
  try {
    const transport = nodemailer.createTransport(buildSmtpConfig(mailbox));
    const bodyHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;white-space:pre-wrap">${escapeHtml(contract.message_body || "Please find your contract attached.")}</div>`;
    await transport.sendMail({
      from: `"${mailbox.displayName || mailbox.address}" <${mailbox.address}>`,
      to: contract.recipient_email,
      subject: `Website Services Agreement — ${contract.business_name}`,
      html: bodyHtml,
      attachments: [{ filename: `contract-${contract.business_name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`, content: pdf, contentType: "application/pdf" }],
    });
  } catch (e) {
    return NextResponse.json({ error: `Send failed: ${(e as Error).message}` }, { status: 502 });
  }

  // Persist the PDF and flip to sent only after a successful send.
  const pdfPath = `${contract.id}.pdf`;
  await admin.storage.from("contracts").upload(pdfPath, new Uint8Array(pdf), { contentType: "application/pdf", upsert: true });

  const sentAt = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("contracts")
    .update({ status: "sent", sent_at: sentAt, pdf_path: pdfPath })
    .eq("id", contract.id)
    .eq("status", "draft") // guard against a concurrent double-send
    .select("*")
    .single();
  if (error || !updated) return NextResponse.json({ error: "Sent, but failed to record status — check the contract" }, { status: 500 });

  await admin.from("activity_log").insert({
    user_id: user.id, action: "contract.sent", entity_type: "contract", entity_id: contract.id,
    new_value: { recipient_email: contract.recipient_email, sent_at: sentAt },
  });

  return NextResponse.json({ contract: updated });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in the send route.

- [ ] **Step 3: Commit**

```bash
git add "app/api/contracts/[id]/send/route.ts"
git commit -m "feat(contracts): send API — SMTP via mailbox seam, retain PDF, mark sent" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 12: Contract composer UI from a lead + signature page

**Files:**
- Create: `components/contracts/ContractComposer.tsx`
- Create: `components/contracts/LeadContractsCard.tsx`
- Create: `components/account/SignatureCard.tsx`
- Create: `app/(app)/account/signature/page.tsx`
- Modify: `app/(app)/leads/[id]/page.tsx`
- Modify: `components/leads/LeadDetail.tsx`

- [ ] **Step 1: Write the composer dialog**

Create `components/contracts/ContractComposer.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Send, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";

type Mailbox = { id: string; email_address: string; display_name: string };

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
  const [templateKey, setTemplateKey] = useState(CONTRACT_TEMPLATES[0].key);
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? "");
  const [message, setMessage] = useState("Hi,\n\nPlease find your website services agreement attached. Let me know if you have any questions.\n\nThank you.");
  const [contractId, setContractId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createDraft() {
    setBusy(true);
    try {
      const res = await fetch("/api/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, mailbox_id: mailboxId, template_key: templateKey, message_body: message }),
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
            <select className={inputCls} value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} disabled={!!contractId}>
              {CONTRACT_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Send from" required>
            <select className={inputCls} value={mailboxId} onChange={(e) => setMailboxId(e.target.value)} disabled={!!contractId}>
              {mailboxes.length === 0 && <option value="">No verified mailbox</option>}
              {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email_address}</option>)}
            </select>
          </Field>
        </div>

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

- [ ] **Step 2: Write the per-lead contracts card**

Create `components/contracts/LeadContractsCard.tsx`:
```tsx
"use client";

import { useState } from "react";
import { FileText, Download, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContractComposer } from "@/components/contracts/ContractComposer";
import { ContractSentBadge } from "@/components/contracts/ContractSentBadge";
import type { ContractRow } from "@/lib/contracts/types";

type Mailbox = { id: string; email_address: string; display_name: string };

export function LeadContractsCard({
  leadId,
  contracts,
  mailboxes,
  canSend,
}: {
  leadId: string;
  contracts: ContractRow[];
  mailboxes: Mailbox[];
  canSend: boolean;
}) {
  const [composing, setComposing] = useState(false);
  const anySent = contracts.some((c) => c.status === "sent");

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <FileText className="w-4 h-4" /> Contracts {anySent && <ContractSentBadge />}
        </div>
        {canSend && (
          <button onClick={() => setComposing(true)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text hover:bg-surface-2">
            <Plus className="w-3.5 h-3.5" /> New contract
          </button>
        )}
      </div>

      {contracts.length === 0 ? (
        <p className="text-xs text-text-faint">No contracts yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {contracts.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium mr-2", c.status === "sent" ? "bg-ready-bg text-ready-fg" : "bg-notready-bg text-notready-fg")}>{c.status}</span>
                <span className="text-text-muted">{c.contract_date}</span>
                {c.sent_at && <span className="text-text-faint ml-2">sent {new Date(c.sent_at).toLocaleDateString()}</span>}
              </div>
              <a href={`/api/contracts/${c.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-ink hover:underline">
                <Download className="w-3.5 h-3.5" /> PDF
              </a>
            </li>
          ))}
        </ul>
      )}

      {composing && <ContractComposer leadId={leadId} mailboxes={mailboxes} onClose={() => setComposing(false)} />}
    </div>
  );
}
```

- [ ] **Step 3: Write the signature card + page**

Create `components/account/SignatureCard.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";

export function SignatureCard({ initialTypedName, hasImage }: { initialTypedName: string; hasImage: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [typedName, setTypedName] = useState(initialTypedName);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("typed_name", typedName);
      if (file) fd.set("image", file);
      const res = await fetch("/api/me/signature", { method: "PUT", body: fd });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Save failed", body: data.error }); return; }
      toast({ kind: "success", title: "Signature saved" });
      setFile(null);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text"><PenLine className="w-4 h-4" /> Contract signature</div>
      <p className="text-xs text-text-faint">Used on contracts you send. An uploaded PNG takes priority; otherwise the typed name is drawn in a script style.</p>
      <Field label="Typed name (fallback)">
        <input className={inputCls} value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Jordan Rivera" />
      </Field>
      <Field label={hasImage ? "Replace signature image (PNG)" : "Signature image (PNG, optional)"}>
        <label className={cn(inputCls, "flex items-center gap-2 cursor-pointer")}>
          <Upload className="w-4 h-4 text-text-muted" />
          <span className="text-text-muted truncate">{file ? file.name : hasImage ? "Current image on file" : "Choose a PNG"}</span>
          <input type="file" accept="image/png" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </Field>
      <div className="flex justify-end">
        <button onClick={save} disabled={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">{busy ? "Saving…" : "Save signature"}</button>
      </div>
    </div>
  );
}
```

Create `app/(app)/account/signature/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SignatureCard } from "@/components/account/SignatureCard";

export default async function SignaturePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data } = await admin.from("user_signatures").select("typed_name, signature_image_path").eq("user_id", user.id).maybeSingle();

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">Signature</h1>
        <p className="text-sm text-text-muted mt-0.5">Your signature block for outgoing contracts.</p>
      </div>
      <SignatureCard initialTypedName={data?.typed_name ?? ""} hasImage={!!data?.signature_image_path} />
    </div>
  );
}
```

- [ ] **Step 4: Wire the card + badge into the lead detail page**

In `app/(app)/leads/[id]/page.tsx`, after the existing ticket/permission loads and before the `return (`, add:
```ts
  const canSendContracts = perms.has("contracts.send");
  const canViewContracts = canSendContracts || perms.has("contracts.view");

  const { data: contractsRaw } = await admin
    .from("contracts")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });
  const leadContracts = (contractsRaw ?? []) as import("@/lib/contracts/types").ContractRow[];
  const hasContractSent = leadContracts.some((c) => c.status === "sent");

  const { data: verifiedMailboxes } = await admin
    .from("company_mailboxes")
    .select("id, email_address, display_name")
    .eq("status", "verified")
    .order("email_address");
```
Then extend the `<LeadDetail ... />` props with:
```tsx
      canViewContracts={canViewContracts}
      canSendContracts={canSendContracts}
      contracts={leadContracts}
      hasContractSent={hasContractSent}
      verifiedMailboxes={verifiedMailboxes ?? []}
```

- [ ] **Step 5: Render badge + card in `LeadDetail`**

In `components/leads/LeadDetail.tsx`:

Add imports near the other component imports:
```tsx
import { LeadContractsCard } from "@/components/contracts/LeadContractsCard";
import { ContractSentBadge } from "@/components/contracts/ContractSentBadge";
import type { ContractRow } from "@/lib/contracts/types";
```

Extend the destructured props and its type with:
```tsx
  canViewContracts,
  canSendContracts,
  contracts,
  hasContractSent,
  verifiedMailboxes,
```
```tsx
  canViewContracts: boolean;
  canSendContracts: boolean;
  contracts: ContractRow[];
  hasContractSent: boolean;
  verifiedMailboxes: { id: string; email_address: string; display_name: string }[];
```

In the header, change the status row (currently line ~173) to include the badge:
```tsx
            <div className="mt-1.5 flex items-center gap-2">
              <StatusPill status={lead.status} />
              {hasContractSent && <ContractSentBadge />}
              <span className="font-mono text-xs text-text-faint">#{lead.id.slice(0, 8)}</span>
            </div>
```

Render the contracts card inside the detail body (place it alongside the existing right-column cards, e.g. just before the `<RecentFollowUps ... />` block at line ~384):
```tsx
            {canViewContracts && (
              <LeadContractsCard
                leadId={lead.id}
                contracts={contracts}
                mailboxes={verifiedMailboxes}
                canSend={canSendContracts}
              />
            )}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`ContractSentBadge` is created in Task 13 Step 4 and `CONTRACT_TEMPLATES` in Task 14 — if executing strictly in order, do Task 13 Step 4 and Task 14 Step 1–2 before this typecheck, or stub them; final consolidated typecheck is in Task 14.)

- [ ] **Step 7: Commit**

```bash
git add components/contracts/ContractComposer.tsx components/contracts/LeadContractsCard.tsx components/account/SignatureCard.tsx "app/(app)/account/signature" "app/(app)/leads/[id]/page.tsx" components/leads/LeadDetail.tsx
git commit -m "feat(contracts): lead composer + preview/send UI, signature page, sent badge in detail" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 13: Contracts list + derived "Contract Sent" badge (TDD helper)

**Files:**
- Create: `lib/contracts/badge.ts`
- Create: `components/contracts/ContractSentBadge.tsx`
- Create: `components/contracts/ContractsList.tsx`
- Create: `app/(app)/contracts/page.tsx`
- Modify: `app/(app)/leads/page.tsx`
- Modify: `components/leads/LeadsTable.tsx`
- Test: `tests/contractBadge.test.ts`

- [ ] **Step 1: Write the failing badge-derivation test**

Create `tests/contractBadge.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sentContractLeadIds } from "@/lib/contracts/badge";

describe("sentContractLeadIds", () => {
  it("returns the set of lead ids with at least one sent contract", () => {
    const rows = [
      { lead_id: "a", status: "sent" },
      { lead_id: "b", status: "draft" },
      { lead_id: "a", status: "draft" },
      { lead_id: "c", status: "sent" },
    ];
    const s = sentContractLeadIds(rows);
    expect(s.has("a")).toBe(true);
    expect(s.has("c")).toBe(true);
    expect(s.has("b")).toBe(false);
    expect(s.size).toBe(2);
  });
  it("handles an empty input", () => {
    expect(sentContractLeadIds([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/contractBadge.test.ts`
Expected: FAIL — cannot resolve `@/lib/contracts/badge`.

- [ ] **Step 3: Write the derivation helper**

Create `lib/contracts/badge.ts`:
```ts
/** Lead ids that have at least one contract in status 'sent'. Derived — no
 *  lead-column mutation, no pipeline status change. */
export function sentContractLeadIds(rows: { lead_id: string; status: string }[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) if (r.status === "sent") s.add(r.lead_id);
  return s;
}
```

- [ ] **Step 4: Run test + write the badge component**

Run: `npx vitest run tests/contractBadge.test.ts`
Expected: PASS — 2 passed.

Create `components/contracts/ContractSentBadge.tsx`:
```tsx
import { FileCheck } from "lucide-react";

/** Derived pill shown on a lead that has a sent contract. */
export function ContractSentBadge({ className = "" }: { className?: string }) {
  return (
    <span className={"inline-flex items-center gap-1 rounded-full bg-ready-bg px-2 py-0.5 text-[10px] font-medium text-ready-fg " + className}>
      <FileCheck className="w-3 h-3" /> Contract Sent
    </span>
  );
}
```

- [ ] **Step 5: Write the global contracts list component**

Create `components/contracts/ContractsList.tsx`:
```tsx
"use client";

import Link from "next/link";
import { Download, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContractListItem } from "@/lib/contracts/types";

export function ContractsList({ contracts }: { contracts: ContractListItem[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-text-muted">
          <tr>
            <th className="text-left font-medium px-3 py-2">Business</th>
            <th className="text-left font-medium px-3 py-2">Status</th>
            <th className="text-left font-medium px-3 py-2">Sent</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {contracts.length === 0 && (
            <tr><td colSpan={4} className="px-3 py-6 text-center text-text-faint">No contracts yet.</td></tr>
          )}
          {contracts.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="px-3 py-2 font-medium text-text">{c.lead_business_name || c.business_name}</td>
              <td className="px-3 py-2">
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", c.status === "sent" ? "bg-ready-bg text-ready-fg" : "bg-notready-bg text-notready-fg")}>{c.status}</span>
              </td>
              <td className="px-3 py-2 text-text-faint">{c.sent_at ? new Date(c.sent_at).toLocaleString() : "—"}</td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-3">
                  <a href={`/api/contracts/${c.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-ink hover:underline">
                    <Download className="w-3.5 h-3.5" /> PDF
                  </a>
                  {/* Resend = create a NEW record from the lead (sent contracts are immutable). */}
                  <Link href={`/leads/${c.lead_id}`} className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text">
                    <RotateCcw className="w-3.5 h-3.5" /> Resend
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

> **Resend semantics:** sent contracts are immutable (the send route rejects a second send on the same row). "Resend" therefore links to the lead, where **New contract** in `LeadContractsCard` creates a fresh draft/record — matching the spec's "resend creates a new record."

- [ ] **Step 6: Write the global contracts page**

Create `app/(app)/contracts/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { ContractsList } from "@/components/contracts/ContractsList";
import type { ContractListItem, ContractRow } from "@/lib/contracts/types";

export default async function ContractsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("contracts.view") && !perms.has("contracts.send")) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("contracts")
    .select("*, leads(business_name)")
    .order("created_at", { ascending: false });

  const contracts: ContractListItem[] = (rows ?? []).map((r: ContractRow & { leads?: { business_name: string } | null }) => ({
    ...r,
    lead_business_name: r.leads?.business_name ?? r.business_name,
  }));

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">Contracts</h1>
        <p className="text-sm text-text-muted mt-0.5">Every contract created or sent across your leads.</p>
      </div>
      <ContractsList contracts={contracts} />
    </div>
  );
}
```

- [ ] **Step 7: Derive badge ids on the leads list page + pass to the table**

In `app/(app)/leads/page.tsx`, add a sent-contracts fetch. After the existing `Promise.all([...])` block that loads leads, insert:
```ts
  const admin = createAdminClient();
  const { data: sentRows } = await admin.from("contracts").select("lead_id, status").eq("status", "sent");
  const contractSentLeadIds = Array.from(sentContractLeadIds(sentRows ?? []));
```
Add the imports at the top of the file:
```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { sentContractLeadIds } from "@/lib/contracts/badge";
```
Then pass the prop to the table:
```tsx
    <LeadsTable
      ...
      contractSentLeadIds={contractSentLeadIds}
    />
```

- [ ] **Step 8: Render badge in the LeadsTable business cell**

In `components/leads/LeadsTable.tsx`:

Add to the destructured props (in the `export function LeadsTable({ ... })` list) and its prop-type block:
```tsx
  contractSentLeadIds = [],
```
```tsx
  contractSentLeadIds?: string[];
```
Add near the top of the component body (after other `useMemo`/hook setup):
```tsx
  const sentContractSet = useMemo(() => new Set(contractSentLeadIds), [contractSentLeadIds]);
```
Add the import:
```tsx
import { ContractSentBadge } from "@/components/contracts/ContractSentBadge";
```
In the `business_name` column `cell` (currently around line 255, after the email `<div>`), add:
```tsx
              {sentContractSet.has(c.row.original.id) && (
                <div className="mt-1"><ContractSentBadge /></div>
              )}
```

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Depends on Task 14's `CONTRACT_TEMPLATES` only through the composer; run Task 14 Step 1–2 first if strictly ordered.)

- [ ] **Step 10: Commit**

```bash
git add lib/contracts/badge.ts tests/contractBadge.test.ts components/contracts/ContractSentBadge.tsx components/contracts/ContractsList.tsx "app/(app)/contracts" "app/(app)/leads/page.tsx" components/leads/LeadsTable.tsx
git commit -m "feat(contracts): global contracts list + derived Contract Sent badge on leads" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 14: Template registry + enhancement wiring + final verification

**Files:**
- Create: `lib/contracts/templates.ts`
- Test: `tests/contractTemplates.test.ts`

- [ ] **Step 1: Write the failing templates test**

Create `tests/contractTemplates.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CONTRACT_TEMPLATES, isContractTemplateKey } from "@/lib/contracts/templates";

describe("contract templates", () => {
  it("ships the standard template", () => {
    expect(CONTRACT_TEMPLATES.some((t) => t.key === "standard")).toBe(true);
  });
  it("validates known keys and rejects unknown", () => {
    expect(isContractTemplateKey("standard")).toBe(true);
    expect(isContractTemplateKey("premium-nope")).toBe(false);
    expect(isContractTemplateKey("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test (fails), then write the registry**

Run: `npx vitest run tests/contractTemplates.test.ts`
Expected: FAIL — cannot resolve `@/lib/contracts/templates`.

Create `lib/contracts/templates.ts`:
```ts
/** Contract template registry. MVP ships `standard`; adding a type is a row +
 *  a branch in ContractDocument. The `template_key` column + selector already
 *  carry the choice end-to-end. */
export const CONTRACT_TEMPLATES = [
  { key: "standard", label: "Standard Website Contract" },
] as const;

export type ContractTemplateKey = (typeof CONTRACT_TEMPLATES)[number]["key"];

export function isContractTemplateKey(v: string): boolean {
  return CONTRACT_TEMPLATES.some((t) => t.key === v);
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/contractTemplates.test.ts`
Expected: PASS — 2 passed.

- [ ] **Step 4: Confirm enhancement wiring is complete**

Verify (read-only) that each approved enhancement is now wired:
- **Template library** — `template_key` column (migration), selector in `ContractComposer`, validated by `isContractTemplateKey` in `app/api/contracts/route.ts` and rendered via `template_key` on the contract.
- **Auto-badge on send** — the badge is derived from `status='sent'`; the send route sets `status='sent'`, so the badge appears on the next load. `router.refresh()` after send re-fetches immediately.
- **Merge-field validation** — `validateMergeFields` gate in `POST /api/contracts` returns `422 { missing: [...] }` before any draft/preview; the composer surfaces the missing list and never opens a preview on failure.
- **PDF retained** — the send route uploads the PDF to the `contracts` bucket and stores `pdf_path`; `GET /api/contracts/[id]/pdf` streams it; download links exist in `LeadContractsCard` and `ContractsList`.

- [ ] **Step 5: Run the full unit-test suite**

Run: `npx vitest run`
Expected: all tests pass, including `mailCrypto`, `mailboxConfig`, `mailSchema`, `contractMerge`, `contractSignature`, `contractBadge`, `contractTemplates`, and the pre-existing suites.

- [ ] **Step 6: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors across the project.

- [ ] **Step 7: Commit**

```bash
git add lib/contracts/templates.ts tests/contractTemplates.test.ts
git commit -m "feat(contracts): template registry + finalize enhancement wiring" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 8 (optional, on request): production build sanity check**

If a build check is wanted (dev server stays down), run:
```bash
NODE_OPTIONS=--max-old-space-size=6144 npm run build
```
Expected: build completes without type/route errors. Do not deploy; leave all commits local (push happens separately via PowerShell).

---

## Manual verification checklist (live mailbox on prod — not automated)

These exercise the integration seams the unit tests mock. Run against a real linked Hostinger mailbox after deploy:
1. Admin → Company Mail → link a real mailbox with a correct password → status flips to **verified** (IMAP+SMTP both logged in).
2. Link with a wrong password → status **error** with a readable `last_error`; the plaintext never appears in logs or responses.
3. Account → Signature → set a typed name (and/or upload a PNG).
4. Open a lead with a business email + one-time price → Contracts card → New contract → preview renders with merged values → Send → recipient receives the email + PDF; the lead shows the **Contract Sent** badge in the list and detail; the PDF is downloadable from the contracts list.
5. A lead missing email or price → New contract is blocked with the missing-field list (no draft created).

---

## Notes / constraints recap
- **Additive migrations only** on the shared prod DB (`ikuvbxjkoojtgekapbul`). No destructive edits. Do not run test website generations against it.
- **Pure-JS PDF** (`@react-pdf/renderer`) — no Puppeteer/LibreOffice (shared hosting).
- **Sending is explicit** (preview → Send). Never auto-send.
- **Credentials** encrypted at rest, never returned to the client (`SAFE_COLS` selects exclude `encrypted_password`), never logged.
- **Node runtime** on every route touching `imapflow`/`nodemailer`/`@react-pdf/renderer`.
- **Build** needs `NODE_OPTIONS=--max-old-space-size=6144`; keep the dev server down; **commit locally only** — push via PowerShell separately.
- **Commit trailer** on every commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
</content>
</invoke>
