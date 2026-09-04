# Form Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted, web3forms-compatible form submission service inside the dashboard: client sites POST to `/api/forms/submit`, the submission is stored, emailed to the client from a linked Hostinger mailbox, and shown in a Forms inbox and on the lead page.

**Architecture:** One public route ingests (parse → gate → insert → respond → `after()` delivery), a secret-authed sweep retries failed deliveries, and a set of permission-gated routes/pages manage endpoints and submissions. Pure logic (parse, gate, email, snippet, access) lives in `lib/forms/*` and is unit-tested; routes are thin and tested by importing the handlers with mocked Supabase clients (repo convention).

**Tech Stack:** Next.js 16 App Router (route handlers, `after` from `next/server`), Supabase Postgres via `@supabase/supabase-js` (no ORM; SQL migration), nodemailer over the existing `lib/mail` mailbox layer, zod 4, vitest, Tailwind v4 with the hand-rolled `components/common` kit.

**Spec:** `docs/superpowers/specs/2026-09-05-form-relay-design.md`. Phase 2 (Site Builder auto-endpoint + key rewrite) is NOT in this plan; it gets its own plan after this ships.

**Conventions the engineer must know:**
- Migrations are SQL files in `supabase/migrations/NNNN_name.sql`. The agent writes the file only; the operator applies it to prod via the Supabase MCP. Code must tolerate the migration not yet being applied where the spec says so (submit route → 503).
- Auth in routes/pages: `createClient()` (user session) → `getUserPermissions(user.id)` → `createAdminClient()` (service role, bypasses RLS) only after the permission check.
- Tests: `tests/<camelCase>.test.ts`, vitest, `// @vitest-environment node` at the top of route/lib tests. Run one file with `npx vitest run tests/<file>.test.ts`.
- Typecheck with `npx tsc --noEmit -p tsconfig.json`. Lint with `npm run lint`.
- Commit after every task. Never commit `lib/site-builder/prompt.ts` or the two untracked `tests/_scratch_*`/`tests/siteStudioProductionRouteWiring.test.ts` files — they are someone else's in-progress work in the same working tree. Always `git add` explicit paths.
- Native `<input type="date|time|datetime-local">` is banned in this repo; this plan needs no date inputs.

---

## File structure

**Create**
- `supabase/migrations/0073_form_relay.sql` — tables, indexes, RLS, settings column, permission + rule seeds.
- `lib/forms/types.ts` — row types + shared constants.
- `lib/forms/parse.ts` — request body → `{reserved, payload}`; submitter extraction.
- `lib/forms/gate.ts` — origin/honeypot/rate decisions; client IP; per-IP bucket.
- `lib/forms/email.ts` — subject resolution + HTML/text message building.
- `lib/forms/snippet.ts` — public submit URL + copyable HTML/JS snippets.
- `lib/forms/access.ts` — visibility scope (mirrors `lib/tickets/scope.ts`).
- `lib/forms/schema.ts` — zod for endpoint create/patch + `generateAccessKey()`.
- `lib/forms/guard.ts` — `requireForms("view"|"manage")` for dashboard routes/pages.
- `lib/forms/load.ts` — `loadVisibleEndpoint` / `loadVisibleSubmission` (scope-checked single-row loaders shared by routes).
- `lib/forms/editorOptions.ts` — lead + mailbox options for the endpoint editor pages.
- `lib/forms/deliver.ts` — sender resolution, SMTP send (seam), row update, notification.
- `app/api/forms/submit/route.ts` — public ingest (+ `OPTIONS`).
- `app/api/forms/deliver/route.ts` — secret-authed retry sweep.
- `app/api/forms/endpoints/route.ts`, `app/api/forms/endpoints/[id]/route.ts`, `app/api/forms/endpoints/[id]/test/route.ts`.
- `app/api/forms/submissions/route.ts`, `app/api/forms/submissions/[id]/route.ts`, `app/api/forms/submissions/[id]/resend/route.ts`.
- `app/(app)/forms/page.tsx` (inbox), `app/(app)/forms/endpoints/page.tsx`, `app/(app)/forms/endpoints/new/page.tsx`, `app/(app)/forms/endpoints/[id]/page.tsx`.
- `components/form-relay/FormsTabs.tsx`, `DeliveryPill.tsx`, `SubmissionsInbox.tsx`, `SubmissionDrawer.tsx`, `EndpointsTable.tsx`, `EndpointEditor.tsx`, `IntegrationCard.tsx`, `LeadFormsCard.tsx`.
- Tests: `tests/formsParse.test.ts`, `formsGate.test.ts`, `formsEmail.test.ts`, `formsSnippet.test.ts`, `formsAccess.test.ts`, `formsSchema.test.ts`, `formsDeliver.test.ts`, `formsSubmitRoute.test.ts`, `formsDeliverRoute.test.ts`, `formsEndpointsRoute.test.ts`, `formsSubmissionsRoute.test.ts`, `formsNavCounts.test.ts`.

**Modify**
- `lib/permissions/constants.ts` — two keys + `forms` category.
- `lib/notifications/events.ts` — `form_submission_received`.
- `lib/supabase/middleware.ts` — allowlist `/api/forms/submit` and `/api/forms/deliver`.
- `instrumentation.ts` — 2-minute sweep poller.
- `lib/settings/appSettings.ts`, `app/api/admin/settings/route.ts`, `components/admin/AppSettingsCard.tsx`, `app/(app)/admin/settings/page.tsx` — default sender mailbox.
- `lib/nav/counts.ts`, `app/api/nav-counts/route.ts`, `components/layout/Sidebar.tsx` — Forms nav entry + unread badge.
- `app/(app)/leads/[id]/page.tsx`, `components/leads/LeadDetail.tsx` — Forms panel.
- `.env.example` — `FORM_RELAY_PUBLIC_URL`.
- `lib/version/changelog.ts` — release note.

---

### Task 1: Migration, permission keys, notification event

**Files:**
- Create: `supabase/migrations/0073_form_relay.sql`
- Modify: `lib/permissions/constants.ts` (the `PERMISSIONS` array end, ~line 90; `PERMISSION_CATEGORIES` line 94)
- Modify: `lib/notifications/events.ts` (append one entry before `] as const;`)
- Modify: `.env.example`

- [ ] **Step 1: Write the migration**

```sql
-- 0073_form_relay.sql — self-hosted form submission service (web3forms replacement).
-- ADDITIVE ONLY. Shared prod DB (ikuvbxjkoojtgekapbul): new tables, one new
-- app_settings column, permission + notification-rule rows. No drops, no
-- type changes. The controller applies this via the Supabase MCP after
-- review, BEFORE the code deploy (the submit route reads these tables).
--
-- RLS is enabled with NO policies on both tables: every read/write goes
-- through the service-role client behind an explicit permission check
-- (same posture as studio_* / builder_*). The public ingest route is
-- authenticated by the endpoint's access_key, not by a user session.

create table if not exists public.form_endpoints (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  name text not null,
  access_key text not null unique,
  to_emails text[] not null default '{}',
  subject_template text not null default '',
  mailbox_id uuid references public.company_mailboxes(id) on delete set null,
  allowed_origins text[] not null default '{}',
  daily_limit int not null default 200,
  success_redirect_url text,
  status text not null default 'active' check (status in ('active','paused')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists form_endpoints_lead_idx on public.form_endpoints (lead_id);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.form_endpoints(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  payload jsonb not null default '[]',
  subject text not null default '',
  submitter_name text,
  submitter_email text,
  ip text,
  user_agent text,
  origin text,
  referer text,
  is_spam boolean not null default false,
  spam_reason text check (spam_reason is null or spam_reason in ('honeypot','origin','rate_ip','rate_daily','manual')),
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','failed','skipped')),
  delivery_attempts int not null default 0,
  last_error text,
  delivered_at timestamptz,
  mailbox_id uuid references public.company_mailboxes(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists form_submissions_endpoint_idx on public.form_submissions (endpoint_id, created_at desc);
create index if not exists form_submissions_lead_idx on public.form_submissions (lead_id, created_at desc);
create index if not exists form_submissions_pending_idx on public.form_submissions (created_at)
  where delivery_status in ('pending','failed');
create index if not exists form_submissions_daily_idx on public.form_submissions (endpoint_id, created_at);

alter table public.form_endpoints enable row level security;
alter table public.form_submissions enable row level security;

alter table public.app_settings
  add column if not exists form_default_mailbox_id uuid references public.company_mailboxes(id) on delete set null;

insert into public.permissions (key, name, description, category, is_sensitive) values
  ('forms.view',   'View Form Submissions',  'See form endpoints and submissions for leads you can see.', 'forms', false),
  ('forms.manage', 'Manage Form Endpoints',  'Create/edit endpoints, resend, mark spam, delete submissions.', 'forms', true)
on conflict (key) do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'forms.view' from public.departments d where d.slug in ('sales','closing','admin')
on conflict do nothing;

insert into public.department_permissions (department_id, permission_key)
  select d.id, 'forms.manage' from public.departments d where d.slug in ('admin')
on conflict do nothing;

insert into public.notification_rules (event_key, enabled, target_departments, target_users, target_roles, delay_minutes) values
  ('form_submission_received', true, '{}', '{}', '{lead_agent}', 0)
on conflict (event_key) do nothing;
```

- [ ] **Step 2: Add the permission keys and category**

In `lib/permissions/constants.ts`, append to the `PERMISSIONS` array (after the `studio.manage` line):

```ts
  { key: "forms.view", name: "View Form Submissions", category: "forms" },
  { key: "forms.manage", name: "Manage Form Endpoints", category: "forms", is_sensitive: true },
```

and change `PERMISSION_CATEGORIES` to:

```ts
export const PERMISSION_CATEGORIES = ["leads", "pre_leads", "analytics", "ai_tools", "admin", "tickets", "feedback", "dashboard", "payments", "templates", "mail", "contracts", "integrations", "forms"] as const;
```

- [ ] **Step 3: Add the notification event**

In `lib/notifications/events.ts`, append before `] as const;`:

```ts
  {
    key: "form_submission_received",
    label: "Website form submission received",
    description: "A visitor submitted a form on a lead's website (Form Relay).",
    defaultLeadTimeMinutes: 0,
    hasTiming: false,
    bell: "website",
    availableRoles: ["lead_agent", "lead_closer"],
    timingMode: "delay",
  },
```

- [ ] **Step 4: Document the env var**

Append to `.env.example`:

```
# Form Relay: the public URL client sites POST to. Shown in the Integration
# card and baked into snippets. Defaults to the production LMS origin.
FORM_RELAY_PUBLIC_URL=https://lms.sedsolutions.online/api/forms/submit
```

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add supabase/migrations/0073_form_relay.sql lib/permissions/constants.ts lib/notifications/events.ts .env.example
git commit -m "feat(forms): migration 0073, permission keys and notification event for Form Relay"
```

---

### Task 2: Types and request parsing

**Files:**
- Create: `lib/forms/types.ts`
- Create: `lib/forms/parse.ts`
- Test: `tests/formsParse.test.ts`

- [ ] **Step 1: Write the types**

```ts
// lib/forms/types.ts
export type FormEndpointStatus = "active" | "paused";
export type FormDeliveryStatus = "pending" | "sent" | "failed" | "skipped";
export type FormSpamReason = "honeypot" | "origin" | "rate_ip" | "rate_daily" | "manual";

/** Row of public.form_endpoints. */
export interface FormEndpointRow {
  id: string;
  lead_id: string | null;
  name: string;
  access_key: string;
  to_emails: string[];
  subject_template: string;
  mailbox_id: string | null;
  allowed_origins: string[];
  daily_limit: number;
  success_redirect_url: string | null;
  status: FormEndpointStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One submitted field, in submission order. */
export type PayloadField = { key: string; value: string };

/** Row of public.form_submissions. */
export interface FormSubmissionRow {
  id: string;
  endpoint_id: string;
  lead_id: string | null;
  payload: PayloadField[];
  subject: string;
  submitter_name: string | null;
  submitter_email: string | null;
  ip: string | null;
  user_agent: string | null;
  origin: string | null;
  referer: string | null;
  is_spam: boolean;
  spam_reason: FormSpamReason | null;
  delivery_status: FormDeliveryStatus;
  delivery_attempts: number;
  last_error: string | null;
  delivered_at: string | null;
  mailbox_id: string | null;
  read_at: string | null;
  created_at: string;
}

export const MAX_DELIVERY_ATTEMPTS = 5;

/** Endpoint row + today's non-spam count (GET /api/forms/endpoints and the Endpoints page). */
export type EndpointListItem = FormEndpointRow & { today_count: number };

/** Submission row + display names (GET /api/forms/submissions, the inbox and the drawer). */
export type SubmissionListItem = FormSubmissionRow & { endpoint_name: string | null; lead_name: string | null };
```

- [ ] **Step 2: Write the failing parse tests**

```ts
// tests/formsParse.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { fieldsToSubmission, parseSubmissionRequest, extractSubmitter, isEmailAddress, LIMITS } from "@/lib/forms/parse";

describe("fieldsToSubmission", () => {
  it("splits reserved fields from payload and keeps order", () => {
    const r = fieldsToSubmission([
      ["access_key", "k1"], ["name", "Ann"], ["subject", "Hi"], ["message", "Hello"], ["botcheck", ""],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.reserved.access_key).toBe("k1");
    expect(r.value.reserved.subject).toBe("Hi");
    expect(r.value.reserved.botcheck).toBe("");
    expect(r.value.payload).toEqual([{ key: "name", value: "Ann" }, { key: "message", value: "Hello" }]);
  });

  it("rejects a missing access_key", () => {
    const r = fieldsToSubmission([["name", "Ann"]]);
    expect(r).toEqual({ ok: false, status: 400, message: "access_key is required" });
  });

  it("rejects too many fields", () => {
    const entries: [string, string][] = [["access_key", "k"]];
    for (let i = 0; i < LIMITS.fields + 1; i++) entries.push([`f${i}`, "x"]);
    const r = fieldsToSubmission(entries);
    expect(r).toEqual({ ok: false, status: 400, message: "Payload too large" });
  });

  it("rejects an oversize value", () => {
    const r = fieldsToSubmission([["access_key", "k"], ["msg", "x".repeat(LIMITS.valueChars + 1)]]);
    expect(r.ok).toBe(false);
  });
});

describe("parseSubmissionRequest", () => {
  it("parses JSON, stringifying non-string values", async () => {
    const req = new Request("http://t/x", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_key: "k", name: "Ann", age: 3, ok: true, tags: ["a", "b"] }),
    });
    const r = await parseSubmissionRequest(req);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.payload).toEqual([
      { key: "name", value: "Ann" }, { key: "age", value: "3" }, { key: "ok", value: "true" }, { key: "tags", value: "a, b" },
    ]);
  });

  it("parses urlencoded bodies", async () => {
    const req = new Request("http://t/x", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "access_key=k&email=a%40b.co&message=hi",
    });
    const r = await parseSubmissionRequest(req);
    expect(r.ok && r.value.payload[0]).toEqual({ key: "email", value: "a@b.co" });
  });

  it("parses multipart FormData and drops files", async () => {
    const fd = new FormData();
    fd.append("access_key", "k");
    fd.append("name", "Ann");
    fd.append("cv", new Blob(["pdf"]), "cv.pdf");
    const req = new Request("http://t/x", { method: "POST", body: fd });
    const r = await parseSubmissionRequest(req);
    expect(r.ok && r.value.payload).toEqual([{ key: "name", value: "Ann" }]);
  });

  it("rejects invalid JSON", async () => {
    const req = new Request("http://t/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{nope" });
    const r = await parseSubmissionRequest(req);
    expect(r).toEqual({ ok: false, status: 400, message: "Invalid request body" });
  });

  it("rejects a body over the byte cap", async () => {
    const req = new Request("http://t/x", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_key: "k", message: "x".repeat(LIMITS.bodyBytes) }),
    });
    const r = await parseSubmissionRequest(req);
    expect(r).toEqual({ ok: false, status: 400, message: "Payload too large" });
  });
});

describe("extractSubmitter", () => {
  it("finds name and email from common field names", () => {
    const s = extractSubmitter([{ key: "full_name", value: "Ann Lee" }, { key: "Email", value: " ann@x.co " }], { replyto: "", from_name: "" });
    expect(s).toEqual({ name: "Ann Lee", email: "ann@x.co" });
  });
  it("joins first + last name and prefers replyto", () => {
    const s = extractSubmitter([{ key: "first_name", value: "Ann" }, { key: "last_name", value: "Lee" }, { key: "email", value: "a@b.co" }], { replyto: "r@b.co", from_name: "" });
    expect(s).toEqual({ name: "Ann Lee", email: "r@b.co" });
  });
  it("ignores an invalid email and returns nulls when nothing matches", () => {
    expect(extractSubmitter([{ key: "email", value: "nope" }], { replyto: "", from_name: "" })).toEqual({ name: null, email: null });
  });
});

describe("isEmailAddress", () => {
  it("accepts simple addresses and rejects junk", () => {
    expect(isEmailAddress("a@b.co")).toBe(true);
    expect(isEmailAddress("a b@b.co")).toBe(false);
    expect(isEmailAddress("")).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/formsParse.test.ts`
Expected: FAIL — cannot resolve `@/lib/forms/parse`.

- [ ] **Step 4: Implement parse.ts**

```ts
// lib/forms/parse.ts
import type { PayloadField } from "@/lib/forms/types";

/** Web3forms-compatible reserved field names. Everything else is payload. */
export const RESERVED_KEYS = ["access_key", "subject", "from_name", "redirect", "botcheck", "replyto", "ccemail"] as const;
export type ReservedKey = (typeof RESERVED_KEYS)[number];
export type Reserved = Record<ReservedKey, string>;

export const LIMITS = { bodyBytes: 64 * 1024, fields: 50, valueChars: 10_000 } as const;

export type ParsedSubmission = { reserved: Reserved; payload: PayloadField[] };
export type ParseResult = { ok: true; value: ParsedSubmission } | { ok: false; status: 400; message: string };

const tooLarge: ParseResult = { ok: false, status: 400, message: "Payload too large" };
const invalid: ParseResult = { ok: false, status: 400, message: "Invalid request body" };

function emptyReserved(): Reserved {
  return { access_key: "", subject: "", from_name: "", redirect: "", botcheck: "", replyto: "", ccemail: "" };
}

/** Pure core: ordered (key, value) pairs → reserved + payload, with caps. */
export function fieldsToSubmission(entries: [string, string][]): ParseResult {
  const reserved = emptyReserved();
  const payload: PayloadField[] = [];
  for (const [rawKey, value] of entries) {
    const key = rawKey.trim().slice(0, 100);
    if (!key) continue;
    if (value.length > LIMITS.valueChars) return tooLarge;
    if ((RESERVED_KEYS as readonly string[]).includes(key)) {
      reserved[key as ReservedKey] = value;
      continue;
    }
    payload.push({ key, value });
    if (payload.length > LIMITS.fields) return tooLarge;
  }
  if (!reserved.access_key.trim()) return { ok: false, status: 400, message: "access_key is required" };
  reserved.access_key = reserved.access_key.trim();
  return { ok: true, value: { reserved, payload } };
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(scalar).join(", ");
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** Read a Request (JSON, multipart or urlencoded) into a ParsedSubmission. */
export async function parseSubmissionRequest(req: Request): Promise<ParseResult> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > LIMITS.bodyBytes) return tooLarge;
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();

  if (ct.includes("multipart/form-data")) {
    let fd: FormData;
    try { fd = await req.formData(); } catch { return invalid; }
    const entries: [string, string][] = [];
    fd.forEach((v, k) => { if (typeof v === "string") entries.push([k, v]); });
    return fieldsToSubmission(entries);
  }

  let text: string;
  try { text = await req.text(); } catch { return invalid; }
  if (text.length > LIMITS.bodyBytes) return tooLarge;

  const wantsJson = ct.includes("application/json") || (!ct.includes("x-www-form-urlencoded") && text.trim().startsWith("{"));
  if (wantsJson) {
    let obj: unknown;
    try { obj = JSON.parse(text); } catch { return invalid; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return invalid;
    return fieldsToSubmission(Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, scalar(v)]));
  }
  const params = new URLSearchParams(text);
  const entries: [string, string][] = [];
  params.forEach((v, k) => entries.push([k, v]));
  return fieldsToSubmission(entries);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmailAddress(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

const NAME_KEYS = ["name", "full_name", "fullname", "your_name", "contact_name"];
const EMAIL_KEYS = ["email", "e-mail", "email_address", "your_email", "reply_to"];

/** Best-effort submitter identity for Reply-To and list display. */
export function extractSubmitter(payload: PayloadField[], reserved: Pick<Reserved, "replyto" | "from_name">): { name: string | null; email: string | null } {
  const byKey = new Map(payload.map((f) => [f.key.toLowerCase(), f.value.trim()]));
  let name: string | null = null;
  for (const k of NAME_KEYS) { const v = byKey.get(k); if (v) { name = v; break; } }
  if (!name) {
    const first = byKey.get("first_name") ?? byKey.get("firstname") ?? "";
    const last = byKey.get("last_name") ?? byKey.get("lastname") ?? "";
    const joined = `${first} ${last}`.trim();
    if (joined) name = joined;
  }
  if (!name && reserved.from_name.trim()) name = reserved.from_name.trim();

  let email: string | null = null;
  if (isEmailAddress(reserved.replyto)) email = reserved.replyto.trim();
  if (!email) for (const k of EMAIL_KEYS) { const v = byKey.get(k); if (v && isEmailAddress(v)) { email = v; break; } }
  return { name: name ? name.slice(0, 200) : null, email };
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/formsParse.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add lib/forms/types.ts lib/forms/parse.ts tests/formsParse.test.ts
git commit -m "feat(forms): submission types and web3forms-compatible request parsing"
```

---

### Task 3: Gate (origin, honeypot, rate limits)

**Files:**
- Create: `lib/forms/gate.ts`
- Test: `tests/formsGate.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/formsGate.test.ts
// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { originHost, originAllowed, clientIp, ipRateAllowed, resetIpRate, gateSubmission, IP_LIMIT_PER_MINUTE } from "@/lib/forms/gate";

beforeEach(() => resetIpRate());

describe("originHost", () => {
  it("prefers Origin, falls back to Referer host, lowercases", () => {
    expect(originHost("https://Foo.com", null)).toBe("foo.com");
    expect(originHost(null, "https://bar.com/contact?x=1")).toBe("bar.com");
    expect(originHost("null", null)).toBeNull();
    expect(originHost(null, null)).toBeNull();
  });
});

describe("originAllowed", () => {
  it("allows anything when the list is empty", () => {
    expect(originAllowed(null, [])).toBe(true);
    expect(originAllowed("x.com", [])).toBe(true);
  });
  it("matches exact and wildcard entries, rejects unknown/missing", () => {
    expect(originAllowed("foo.com", ["foo.com"])).toBe(true);
    expect(originAllowed("www.foo.com", ["*.foo.com"])).toBe(true);
    expect(originAllowed("foo.com", ["*.foo.com"])).toBe(true);
    expect(originAllowed("evil.com", ["foo.com"])).toBe(false);
    expect(originAllowed(null, ["foo.com"])).toBe(false);
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("ipRateAllowed", () => {
  it("allows up to the limit per minute then blocks, and slides", () => {
    let t = 1_000_000;
    const now = () => t;
    for (let i = 0; i < IP_LIMIT_PER_MINUTE; i++) expect(ipRateAllowed("1.1.1.1", now)).toBe(true);
    expect(ipRateAllowed("1.1.1.1", now)).toBe(false);
    expect(ipRateAllowed("2.2.2.2", now)).toBe(true);
    t += 61_000;
    expect(ipRateAllowed("1.1.1.1", now)).toBe(true);
  });
});

describe("gateSubmission", () => {
  const endpoint = { allowed_origins: ["foo.com"], daily_limit: 2 };
  it("passes a clean request", () => {
    expect(gateSubmission({ originHost: "foo.com", endpoint, honeypot: "", ip: "9.9.9.9", todayCount: 0 })).toEqual({ ok: true });
  });
  it("flags origin first", () => {
    expect(gateSubmission({ originHost: "evil.com", endpoint, honeypot: "bot", ip: "9.9.9.9", todayCount: 0 })).toEqual({ ok: false, reason: "origin", status: 403 });
  });
  it("flags honeypot with a fake 200", () => {
    expect(gateSubmission({ originHost: "foo.com", endpoint, honeypot: "x", ip: "9.9.9.9", todayCount: 0 })).toEqual({ ok: false, reason: "honeypot", status: 200 });
  });
  it("flags the daily limit", () => {
    expect(gateSubmission({ originHost: "foo.com", endpoint, honeypot: "", ip: "9.9.9.9", todayCount: 2 })).toEqual({ ok: false, reason: "rate_daily", status: 429 });
  });
  it("flags per-IP bursts", () => {
    for (let i = 0; i < IP_LIMIT_PER_MINUTE; i++) gateSubmission({ originHost: "foo.com", endpoint, honeypot: "", ip: "7.7.7.7", todayCount: 0 });
    expect(gateSubmission({ originHost: "foo.com", endpoint, honeypot: "", ip: "7.7.7.7", todayCount: 0 })).toEqual({ ok: false, reason: "rate_ip", status: 429 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/formsGate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement gate.ts**

```ts
// lib/forms/gate.ts
import type { FormSpamReason } from "@/lib/forms/types";

export const IP_LIMIT_PER_MINUTE = 10;
const WINDOW_MS = 60_000;

/** Hostname of the calling page: Origin header, else Referer. Null when unknown. */
export function originHost(origin: string | null, referer: string | null): string | null {
  for (const candidate of [origin, referer]) {
    if (!candidate || candidate === "null") continue;
    try { return new URL(candidate).hostname.toLowerCase(); } catch { /* not a URL */ }
  }
  return null;
}

/** Empty list = any origin. Entries are hostnames; `*.example.com` also matches the apex. */
export function originAllowed(host: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  if (!host) return false;
  return allowed.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (!e) return false;
    if (e.startsWith("*.")) { const apex = e.slice(2); return host === apex || host.endsWith("." + apex); }
    return host === e;
  });
}

export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) { const first = xff.split(",")[0]?.trim(); if (first) return first; }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

// Per-process sliding window. Prod is one pm2 process, so this is the real
// limit there; the daily limit below is the durable, cross-restart one.
const hits = new Map<string, number[]>();

export function ipRateAllowed(ip: string, now: () => number = Date.now): boolean {
  const t = now();
  const list = (hits.get(ip) ?? []).filter((ts) => t - ts < WINDOW_MS);
  if (list.length >= IP_LIMIT_PER_MINUTE) { hits.set(ip, list); return false; }
  list.push(t);
  hits.set(ip, list);
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((ts) => t - ts >= WINDOW_MS)) hits.delete(k);
  return true;
}

/** Test hook. */
export function resetIpRate(): void { hits.clear(); }

export type GateVerdict = { ok: true } | { ok: false; reason: FormSpamReason; status: 200 | 403 | 429 };

/** Spec gate order: origin → honeypot → per-IP → daily. */
export function gateSubmission(input: {
  originHost: string | null;
  endpoint: { allowed_origins: string[]; daily_limit: number };
  honeypot: string;
  ip: string;
  todayCount: number;
  now?: () => number;
}): GateVerdict {
  if (!originAllowed(input.originHost, input.endpoint.allowed_origins)) return { ok: false, reason: "origin", status: 403 };
  if (input.honeypot.trim()) return { ok: false, reason: "honeypot", status: 200 };
  if (!ipRateAllowed(input.ip, input.now)) return { ok: false, reason: "rate_ip", status: 429 };
  if (input.todayCount >= input.endpoint.daily_limit) return { ok: false, reason: "rate_daily", status: 429 };
  return { ok: true };
}

/** UTC midnight ISO for the daily-limit count. */
export function utcDayStart(now: () => number = Date.now): string {
  const d = new Date(now());
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/formsGate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/forms/gate.ts tests/formsGate.test.ts
git commit -m "feat(forms): origin, honeypot and rate-limit gate"
```

---
### Task 4: Email building

**Files:**
- Create: `lib/forms/email.ts`
- Test: `tests/formsEmail.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/formsEmail.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolveSubject, buildFormEmail, escapeHtml, previewLine } from "@/lib/forms/email";

describe("resolveSubject", () => {
  it("prefers the request subject, then the template, then the default", () => {
    expect(resolveSubject("Quote please", "Form: {site}", { site: "Acme", name: "Ann" })).toBe("Quote please");
    expect(resolveSubject("", "{site} — {name}", { site: "Acme", name: "Ann" })).toBe("Acme — Ann");
    expect(resolveSubject("", "{site} — {name}", { site: "Acme", name: null })).toBe("Acme — a visitor");
    expect(resolveSubject("  ", "", { site: "Acme", name: null })).toBe("New form submission from Acme");
  });
  it("caps length", () => {
    expect(resolveSubject("x".repeat(500), "", { site: "A", name: null }).length).toBe(200);
  });
});

describe("escapeHtml", () => {
  it("escapes the five characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});

describe("buildFormEmail", () => {
  const msg = buildFormEmail({
    endpointName: "Acme Roofing",
    subject: "New lead",
    payload: [{ key: "name", value: "Ann <b>" }, { key: "message", value: "line1\nline2" }],
    origin: "acme.com",
    createdAt: "2026-09-05T10:00:00.000Z",
  });
  it("carries the subject and a text twin", () => {
    expect(msg.subject).toBe("New lead");
    expect(msg.text).toContain("name: Ann <b>");
    expect(msg.text).toContain("message: line1\nline2");
    expect(msg.text).toContain("acme.com");
  });
  it("escapes HTML and preserves line breaks", () => {
    expect(msg.html).toContain("Ann &lt;b&gt;");
    expect(msg.html).toContain("line1<br>line2");
    expect(msg.html).toContain("Acme Roofing");
    expect(msg.html).toContain("SED LMS Form Relay");
  });
});

describe("previewLine", () => {
  it("prefers message-like fields and truncates", () => {
    expect(previewLine([{ key: "name", value: "Ann" }, { key: "message", value: "x".repeat(200) }])).toBe("x".repeat(140) + "…");
    expect(previewLine([{ key: "name", value: "Ann" }])).toBe("Ann");
    expect(previewLine([])).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/formsEmail.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement email.ts**

```ts
// lib/forms/email.ts
import type { PayloadField } from "@/lib/forms/types";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Request `subject` → endpoint template ({site}, {name}) → built-in default. Max 200 chars. */
export function resolveSubject(requestSubject: string, template: string, ctx: { site: string; name: string | null }): string {
  const req = requestSubject.trim();
  let out: string;
  if (req) out = req;
  else if (template.trim()) out = template.replace(/\{site\}/g, ctx.site).replace(/\{name\}/g, ctx.name ?? "a visitor");
  else out = `New form submission from ${ctx.site}`;
  return out.replace(/[\r\n]+/g, " ").slice(0, 200);
}

const MESSAGE_KEYS = ["message", "msg", "comments", "comment", "details", "description", "notes", "enquiry", "inquiry"];

/** Short one-line preview for the inbox row and the bell body. */
export function previewLine(payload: PayloadField[], max = 140): string {
  const byKey = new Map(payload.map((f) => [f.key.toLowerCase(), f.value.trim()]));
  let text = "";
  for (const k of MESSAGE_KEYS) { const v = byKey.get(k); if (v) { text = v; break; } }
  if (!text) text = payload.map((f) => f.value.trim()).find(Boolean) ?? "";
  text = text.replace(/\s+/g, " ");
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function stamp(iso: string): { karachi: string; utc: string } {
  const d = new Date(iso);
  const fmt = (tz: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(d);
  return { karachi: fmt("Asia/Karachi"), utc: fmt("UTC") };
}

export type BuiltEmail = { subject: string; text: string; html: string };

export function buildFormEmail(input: {
  endpointName: string;
  subject: string;
  payload: PayloadField[];
  origin: string | null;
  createdAt: string;
}): BuiltEmail {
  const { karachi, utc } = stamp(input.createdAt);
  const site = input.origin ?? "unknown site";

  const text = [
    `New form submission — ${input.endpointName}`,
    "",
    ...input.payload.map((f) => `${f.key}: ${f.value}`),
    "",
    `Site: ${site}`,
    `Time: ${karachi} (Asia/Karachi) · ${utc} (UTC)`,
    "Sent by SED LMS Form Relay",
  ].join("\n");

  const rows = input.payload
    .map((f) => `<tr><td style="padding:6px 10px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;vertical-align:top;white-space:nowrap">${escapeHtml(f.key)}</td><td style="padding:6px 10px;border:1px solid #e5e7eb;white-space:pre-wrap">${escapeHtml(f.value).replace(/\r?\n/g, "<br>")}</td></tr>`)
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;max-width:640px">
<h2 style="font-size:16px;margin:0 0 12px">New form submission — ${escapeHtml(input.endpointName)}</h2>
<table style="border-collapse:collapse;width:100%">${rows || `<tr><td style="padding:6px 10px">No fields were submitted.</td></tr>`}</table>
<p style="color:#6b7280;font-size:12px;margin-top:16px">Site: ${escapeHtml(site)}<br>Time: ${escapeHtml(karachi)} (Asia/Karachi) · ${escapeHtml(utc)} (UTC)<br>Sent by SED LMS Form Relay</p>
</div>`;
  return { subject: input.subject, text, html };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/formsEmail.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/forms/email.ts tests/formsEmail.test.ts
git commit -m "feat(forms): notification email builder"
```

---

### Task 5: Snippets and public URL

**Files:**
- Create: `lib/forms/snippet.ts`
- Test: `tests/formsSnippet.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/formsSnippet.test.ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { relaySubmitUrl, htmlSnippet, jsSnippet } from "@/lib/forms/snippet";

const saved = process.env.FORM_RELAY_PUBLIC_URL;
afterEach(() => { if (saved === undefined) delete process.env.FORM_RELAY_PUBLIC_URL; else process.env.FORM_RELAY_PUBLIC_URL = saved; });

describe("relaySubmitUrl", () => {
  it("defaults to production and honours the env override", () => {
    delete process.env.FORM_RELAY_PUBLIC_URL;
    expect(relaySubmitUrl()).toBe("https://lms.sedsolutions.online/api/forms/submit");
    process.env.FORM_RELAY_PUBLIC_URL = "http://localhost:3000/api/forms/submit";
    expect(relaySubmitUrl()).toBe("http://localhost:3000/api/forms/submit");
  });
});

describe("snippets", () => {
  it("html snippet carries the url, key and honeypot", () => {
    const s = htmlSnippet({ url: "https://x/api/forms/submit", accessKey: "KEY1" });
    expect(s).toContain('action="https://x/api/forms/submit"');
    expect(s).toContain('name="access_key" value="KEY1"');
    expect(s).toContain('name="botcheck"');
  });
  it("js snippet posts JSON with the key and retries once", () => {
    const s = jsSnippet({ url: "https://x/api/forms/submit", accessKey: "KEY1" });
    expect(s).toContain('access_key: "KEY1"');
    expect(s).toContain("https://x/api/forms/submit");
    expect(s).toContain("retry");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/formsSnippet.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement snippet.ts**

```ts
// lib/forms/snippet.ts
export const DEFAULT_RELAY_URL = "https://lms.sedsolutions.online/api/forms/submit";

/** Public URL client sites POST to. Env override for local/dev. */
export function relaySubmitUrl(): string {
  return process.env.FORM_RELAY_PUBLIC_URL?.trim() || DEFAULT_RELAY_URL;
}

export function htmlSnippet(a: { url: string; accessKey: string }): string {
  return `<form action="${a.url}" method="POST">
  <input type="hidden" name="access_key" value="${a.accessKey}">
  <input type="hidden" name="subject" value="New contact form submission">
  <!-- honeypot: keep hidden, bots fill it -->
  <input type="checkbox" name="botcheck" style="display:none" tabindex="-1" autocomplete="off">

  <input type="text" name="name" placeholder="Your name" required>
  <input type="email" name="email" placeholder="Your email" required>
  <textarea name="message" placeholder="How can we help?" required></textarea>
  <button type="submit">Send</button>
</form>`;
}

export function jsSnippet(a: { url: string; accessKey: string }): string {
  return `const form = document.querySelector("#contact-form");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const body = JSON.stringify({ access_key: "${a.accessKey}", ...data });
  const post = () => fetch("${a.url}", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
  });
  let res;
  try {
    res = await post();
  } catch {
    // one retry after 3s covers a dashboard restart window
    await new Promise((r) => setTimeout(r, 3000));
    res = await post();
  }
  const json = await res.json().catch(() => ({ success: false }));
  if (json.success) {
    form.reset();
    alert("Thanks — we'll be in touch shortly.");
  } else {
    alert(json.message || "Something went wrong. Please try again.");
  }
});`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/formsSnippet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/forms/snippet.ts tests/formsSnippet.test.ts
git commit -m "feat(forms): integration snippets and public relay URL"
```

---

### Task 6: Visibility scope and zod schema

**Files:**
- Create: `lib/forms/access.ts`
- Create: `lib/forms/schema.ts`
- Test: `tests/formsAccess.test.ts`, `tests/formsSchema.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/formsAccess.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { allowedFormScope, endpointInScope, type FormScope } from "@/lib/forms/access";

function fakeAdmin(leadIds: string[]) {
  return {
    from: () => ({ select: () => ({ eq: () => ({ is: async () => ({ data: leadIds.map((id) => ({ id })) }) }) }) }),
  } as unknown as Parameters<typeof allowedFormScope>[0];
}

describe("allowedFormScope", () => {
  it("is global with leads.view_all", async () => {
    const s = await allowedFormScope(fakeAdmin([]), "u1", new Set(["leads.view_all"]));
    expect(s).toEqual({ all: true, manage: false });
  });
  it("otherwise lists the user's own leads and remembers manage", async () => {
    const s = await allowedFormScope(fakeAdmin(["l1"]), "u1", new Set(["forms.manage"]));
    expect(s.all).toBe(false);
    if (s.all) return;
    expect([...s.leadIds]).toEqual(["l1"]);
    expect(s.manage).toBe(true);
  });
});

describe("endpointInScope", () => {
  const own: FormScope = { all: false, leadIds: new Set(["l1"]), manage: false };
  const mgr: FormScope = { all: false, leadIds: new Set(), manage: true };
  it("global scope sees everything", () => {
    expect(endpointInScope({ lead_id: null }, { all: true, manage: false })).toBe(true);
  });
  it("own leads only; lead-less endpoints need manage", () => {
    expect(endpointInScope({ lead_id: "l1" }, own)).toBe(true);
    expect(endpointInScope({ lead_id: "l2" }, own)).toBe(false);
    expect(endpointInScope({ lead_id: null }, own)).toBe(false);
    expect(endpointInScope({ lead_id: null }, mgr)).toBe(true);
  });
});
```

```ts
// tests/formsSchema.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { endpointInputSchema, endpointPatchSchema, generateAccessKey } from "@/lib/forms/schema";

describe("endpointInputSchema", () => {
  it("applies defaults and normalises origins", () => {
    const r = endpointInputSchema.parse({ name: " Acme ", to_emails: ["a@b.co"], allowed_origins: [" Acme.COM ", "*.foo.com"] });
    expect(r.name).toBe("Acme");
    expect(r.allowed_origins).toEqual(["acme.com", "*.foo.com"]);
    expect(r.daily_limit).toBe(200);
    expect(r.status).toBe("active");
    expect(r.lead_id).toBeNull();
  });
  it("requires at least one valid recipient", () => {
    expect(endpointInputSchema.safeParse({ name: "x", to_emails: [] }).success).toBe(false);
    expect(endpointInputSchema.safeParse({ name: "x", to_emails: ["nope"] }).success).toBe(false);
  });
  it("rejects a bad origin and a non-http redirect", () => {
    expect(endpointInputSchema.safeParse({ name: "x", to_emails: ["a@b.co"], allowed_origins: ["http://x.com"] }).success).toBe(false);
    expect(endpointInputSchema.safeParse({ name: "x", to_emails: ["a@b.co"], success_redirect_url: "ftp://x" }).success).toBe(false);
  });
  it("patch is partial", () => {
    expect(endpointPatchSchema.parse({ status: "paused" })).toEqual({ status: "paused" });
  });
});

describe("generateAccessKey", () => {
  it("is 32 url-safe chars and unique", () => {
    const a = generateAccessKey(); const b = generateAccessKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/formsAccess.test.ts tests/formsSchema.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement access.ts**

```ts
// lib/forms/access.ts
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Who may see which endpoints/submissions. Mirrors lib/tickets/scope.ts:
 * `leads.view_all` sees everything; otherwise only rows on leads currently
 * assigned to the user. Endpoints with no lead are visible only to managers.
 */
export type FormScope = { all: true; manage: boolean } | { all: false; leadIds: Set<string>; manage: boolean };

export async function allowedFormScope(admin: Admin, userId: string, perms: Set<string>): Promise<FormScope> {
  const manage = perms.has("forms.manage");
  if (perms.has("leads.view_all")) return { all: true, manage };
  const { data } = await admin.from("leads").select("id").eq("agent_id", userId).is("deleted_at", null);
  return { all: false, leadIds: new Set((data ?? []).map((l) => l.id as string)), manage };
}

export function endpointInScope(e: { lead_id: string | null }, scope: FormScope): boolean {
  if (scope.all) return true;
  if (e.lead_id === null) return scope.manage;
  return scope.leadIds.has(e.lead_id);
}

/** Submissions carry a denormalised lead_id, so the same rule applies. */
export const submissionInScope = endpointInScope;
```

- [ ] **Step 4: Implement schema.ts**

```ts
// lib/forms/schema.ts
import { randomBytes } from "node:crypto";
import { z } from "zod";

const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, "hostname only, e.g. example.com or *.example.com");

const httpUrl = z.string().trim().url().refine((u) => /^https?:\/\//i.test(u), "must start with http:// or https://");

export const endpointInputSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(120),
  lead_id: z.string().uuid().nullable().default(null),
  to_emails: z.array(z.string().trim().email()).min(1, "at least one recipient").max(10),
  subject_template: z.string().trim().max(200).default(""),
  mailbox_id: z.string().uuid().nullable().default(null),
  allowed_origins: z.array(hostname).max(20).default([]),
  daily_limit: z.number().int().min(1).max(10_000).default(200),
  success_redirect_url: httpUrl.nullable().default(null),
  status: z.enum(["active", "paused"]).default("active"),
});
export type EndpointInput = z.infer<typeof endpointInputSchema>;

export const endpointPatchSchema = endpointInputSchema.partial();
export type EndpointPatch = z.infer<typeof endpointPatchSchema>;

/** 24 random bytes → 32 base64url chars. Public in the site's HTML, so not a secret; unique index guards collisions. */
export function generateAccessKey(): string {
  return randomBytes(24).toString("base64url");
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/formsAccess.test.ts tests/formsSchema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/forms/access.ts lib/forms/schema.ts tests/formsAccess.test.ts tests/formsSchema.test.ts
git commit -m "feat(forms): visibility scope and endpoint zod schema"
```

---

### Task 7: Delivery

**Files:**
- Create: `lib/forms/deliver.ts`
- Test: `tests/formsDeliver.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/formsDeliver.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";

const holder = vi.hoisted(() => ({
  submission: null as Partial<FormSubmissionRow> | null,
  endpoint: null as Partial<FormEndpointRow> | null,
  settings: { form_default_mailbox_id: null as string | null },
  mailboxes: {} as Record<string, { id: string; address: string; displayName: string }>,
  updates: [] as Record<string, unknown>[],
  notified: [] as { key: string; opts: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "form_submissions" ? holder.submission : table === "form_endpoints" ? holder.endpoint : table === "leads" ? { id: "l1", agent_id: "agent-1", closed_by: null } : null,
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({ eq: async () => { holder.updates.push({ table, ...patch }); return { error: null }; } }),
    }),
  }),
}));
vi.mock("@/lib/settings/appSettings", () => ({ getAppSettings: async () => holder.settings }));
vi.mock("@/lib/mail/mailbox", () => ({ getMailboxById: async (id: string) => holder.mailboxes[id] ?? null }));
vi.mock("@/lib/notifications/notify", () => ({ notify: async (key: string, _ctx: unknown, opts: Record<string, unknown>) => { holder.notified.push({ key, opts }); } }));

import { deliverSubmission } from "@/lib/forms/deliver";

beforeEach(() => {
  holder.submission = {
    id: "s1", endpoint_id: "e1", lead_id: "l1", is_spam: false, delivery_status: "pending", delivery_attempts: 0,
    payload: [{ key: "message", value: "Need a roof" }], subject: "New lead", submitter_email: "ann@x.co", origin: "acme.com", created_at: "2026-09-05T10:00:00Z",
  };
  holder.endpoint = { id: "e1", name: "Acme", to_emails: ["owner@acme.com"], mailbox_id: null, lead_id: "l1" };
  holder.settings = { form_default_mailbox_id: "mb-default" };
  holder.mailboxes = { "mb-default": { id: "mb-default", address: "forms@sed.co", displayName: "SED Forms" }, "mb-x": { id: "mb-x", address: "x@sed.co", displayName: "X" } };
  holder.updates = [];
  holder.notified = [];
});

describe("deliverSubmission", () => {
  it("sends from the default mailbox, marks sent, notifies the lead agent", async () => {
    const send = vi.fn(async () => {});
    const r = await deliverSubmission("s1", { send });
    expect(r).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    const [msg, mailbox] = send.mock.calls[0] as unknown as [Record<string, unknown>, { id: string }];
    expect(mailbox.id).toBe("mb-default");
    expect(msg.to).toEqual(["owner@acme.com"]);
    expect(msg.replyTo).toBe("ann@x.co");
    expect(msg.subject).toBe("New lead");
    expect(holder.updates.at(-1)).toMatchObject({ table: "form_submissions", delivery_status: "sent", mailbox_id: "mb-default" });
    expect(holder.notified[0]?.key).toBe("form_submission_received");
    expect(holder.notified[0]?.opts.targetUrl).toBe("/forms?submission=s1");
  });

  it("prefers the endpoint's own mailbox", async () => {
    holder.endpoint!.mailbox_id = "mb-x";
    const send = vi.fn(async () => {});
    await deliverSubmission("s1", { send });
    expect((send.mock.calls[0] as unknown as [unknown, { id: string }])[1].id).toBe("mb-x");
  });

  it("fails clearly with no sender anywhere", async () => {
    holder.settings = { form_default_mailbox_id: null };
    const send = vi.fn(async () => {});
    const r = await deliverSubmission("s1", { send });
    expect(r).toEqual({ status: "failed", error: "No sender mailbox configured" });
    expect(send).not.toHaveBeenCalled();
    expect(holder.updates.at(-1)).toMatchObject({ delivery_status: "failed", delivery_attempts: 1, last_error: "No sender mailbox configured" });
  });

  it("records an SMTP failure and bumps attempts", async () => {
    holder.submission!.delivery_attempts = 2;
    const send = vi.fn(async () => { throw new Error("SMTP 535"); });
    const r = await deliverSubmission("s1", { send });
    expect(r).toEqual({ status: "failed", error: "SMTP 535" });
    expect(holder.updates.at(-1)).toMatchObject({ delivery_status: "failed", delivery_attempts: 3, last_error: "SMTP 535" });
  });

  it("skips spam and already-sent rows", async () => {
    holder.submission!.is_spam = true;
    const send = vi.fn(async () => {});
    expect(await deliverSubmission("s1", { send })).toEqual({ status: "skipped" });
    holder.submission!.is_spam = false;
    holder.submission!.delivery_status = "sent";
    expect(await deliverSubmission("s1", { send })).toEqual({ status: "skipped" });
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/formsDeliver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement deliver.ts**

```ts
// lib/forms/deliver.ts
import nodemailer from "nodemailer";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppSettings } from "@/lib/settings/appSettings";
import { getMailboxById } from "@/lib/mail/mailbox";
import { buildSmtpConfig } from "@/lib/mail/config";
import type { ResolvedMailbox } from "@/lib/mail/types";
import { notify } from "@/lib/notifications/notify";
import { buildFormEmail, previewLine } from "@/lib/forms/email";
import { isEmailAddress } from "@/lib/forms/parse";
import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";

/** Seam so tests never touch SMTP. */
export type SendFn = (msg: nodemailer.SendMailOptions, mailbox: ResolvedMailbox) => Promise<void>;

export const smtpSend: SendFn = async (msg, mailbox) => {
  const transport = nodemailer.createTransport(buildSmtpConfig(mailbox));
  await transport.sendMail(msg);
};

/** endpoint.mailbox_id → app_settings.form_default_mailbox_id → null. */
export async function resolveSender(endpoint: Pick<FormEndpointRow, "mailbox_id">): Promise<ResolvedMailbox | null> {
  if (endpoint.mailbox_id) {
    const m = await getMailboxById(endpoint.mailbox_id);
    if (m) return m;
  }
  const settings = await getAppSettings();
  const fallback = (settings as { form_default_mailbox_id?: string | null }).form_default_mailbox_id ?? null;
  return fallback ? getMailboxById(fallback) : null;
}

export type DeliveryResult = { status: "sent" } | { status: "skipped" } | { status: "failed"; error: string };

/**
 * Deliver one stored submission by email. Idempotent: spam and already-sent
 * rows are skipped. Called from the submit route's after() and from the
 * retry sweep. Never throws — every outcome lands on the row.
 */
export async function deliverSubmission(id: string, deps: { send?: SendFn } = {}): Promise<DeliveryResult> {
  const send = deps.send ?? smtpSend;
  const admin = createAdminClient();

  const { data: sub } = await admin.from("form_submissions").select("*").eq("id", id).maybeSingle();
  if (!sub) return { status: "failed", error: "Submission not found" };
  const submission = sub as FormSubmissionRow;
  if (submission.is_spam || submission.delivery_status === "sent") return { status: "skipped" };

  const { data: ep } = await admin.from("form_endpoints").select("*").eq("id", submission.endpoint_id).maybeSingle();
  if (!ep) return fail(admin, submission, "Endpoint no longer exists");
  const endpoint = ep as FormEndpointRow;
  if (!endpoint.to_emails.length) return fail(admin, submission, "Endpoint has no recipients");

  const mailbox = await resolveSender(endpoint);
  if (!mailbox) return fail(admin, submission, "No sender mailbox configured");

  const built = buildFormEmail({
    endpointName: endpoint.name,
    subject: submission.subject || `New form submission from ${endpoint.name}`,
    payload: submission.payload ?? [],
    origin: submission.origin,
    createdAt: submission.created_at,
  });
  const fromName = `${(submission.submitter_name || endpoint.name).replace(/["\r\n]/g, "")} via SED LMS`;
  const msg: nodemailer.SendMailOptions = {
    from: `"${fromName}" <${mailbox.address}>`,
    to: endpoint.to_emails,
    subject: built.subject,
    text: built.text,
    html: built.html,
  };
  if (submission.submitter_email && isEmailAddress(submission.submitter_email)) msg.replyTo = submission.submitter_email;

  try {
    await send(msg, mailbox);
  } catch (e) {
    return fail(admin, submission, (e as Error).message || "Send failed");
  }

  await admin
    .from("form_submissions")
    .update({ delivery_status: "sent", delivered_at: new Date().toISOString(), mailbox_id: mailbox.id, last_error: null, delivery_attempts: submission.delivery_attempts + 1 })
    .eq("id", submission.id);

  try {
    let lead: { agent_id: string | null; closed_by: string | null } | null = null;
    if (submission.lead_id) {
      const { data } = await admin.from("leads").select("id, agent_id, closed_by").eq("id", submission.lead_id).maybeSingle();
      if (data) lead = { agent_id: data.agent_id ?? null, closed_by: data.closed_by ?? null };
    }
    await notify(
      "form_submission_received",
      { leadId: submission.lead_id, lead },
      {
        title: `New form submission — ${endpoint.name}`,
        body: previewLine(submission.payload ?? []) || built.subject,
        dedupKey: `form_submission:${submission.id}`,
        targetUrl: `/forms?submission=${submission.id}`,
      },
    );
  } catch { /* bell is best-effort — the email really was sent */ }

  return { status: "sent" };
}

async function fail(admin: ReturnType<typeof createAdminClient>, s: FormSubmissionRow, error: string): Promise<DeliveryResult> {
  await admin
    .from("form_submissions")
    .update({ delivery_status: "failed", delivery_attempts: s.delivery_attempts + 1, last_error: error.slice(0, 500) })
    .eq("id", s.id);
  return { status: "failed", error };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/formsDeliver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/forms/deliver.ts tests/formsDeliver.test.ts
git commit -m "feat(forms): email delivery with sender fallback and bell notification"
```

---
### Task 8: Public submit route + middleware allowlist

**Files:**
- Create: `app/api/forms/submit/route.ts`
- Modify: `lib/supabase/middleware.ts` (the `isPublic` expression, ~lines 74-95)
- Test: `tests/formsSubmitRoute.test.ts`

- [ ] **Step 1: Write the failing route tests**

```ts
// tests/formsSubmitRoute.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetIpRate } from "@/lib/forms/gate";

const holder = vi.hoisted(() => ({
  endpoint: null as Record<string, unknown> | null,
  endpointError: null as { message: string } | null,
  todayCount: 0,
  inserted: [] as Record<string, unknown>[],
  after: [] as (() => Promise<void> | void)[],
  delivered: [] as string[],
}));

vi.mock("next/server", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => Promise<void> | void) => { holder.after.push(fn); } };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "form_endpoints") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: holder.endpoint, error: holder.endpointError }) }) }) };
      }
      return {
        select: (_c: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) return { eq: () => ({ eq: () => ({ gte: async () => ({ count: holder.todayCount, error: null }) }) }) };
          return {};
        },
        insert: (row: Record<string, unknown>) => {
          holder.inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "sub-1", ...row }, error: null }) }) };
        },
      };
    },
  }),
}));
vi.mock("@/lib/forms/deliver", () => ({ deliverSubmission: async (id: string) => { holder.delivered.push(id); return { status: "sent" }; } }));

import { POST, OPTIONS } from "@/app/api/forms/submit/route";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request("http://t/api/forms/submit", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://acme.com", "x-forwarded-for": "1.2.3.4", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

beforeEach(() => {
  resetIpRate();
  holder.endpoint = { id: "e1", lead_id: "l1", name: "Acme", access_key: "KEY", status: "active", allowed_origins: [], daily_limit: 200, subject_template: "", success_redirect_url: null };
  holder.endpointError = null;
  holder.todayCount = 0;
  holder.inserted = [];
  holder.after = [];
  holder.delivered = [];
});

describe("OPTIONS /api/forms/submit", () => {
  it("answers preflight with CORS headers", async () => {
    const res = await OPTIONS(new Request("http://t/x", { method: "OPTIONS", headers: { origin: "https://acme.com" } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://acme.com");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("POST /api/forms/submit", () => {
  it("stores, replies web3forms-style, and delivers after the response", async () => {
    const res = await post({ access_key: "KEY", name: "Ann", email: "ann@x.co", message: "Hi" });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://acme.com");
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ name: "Ann", email: "ann@x.co", message: "Hi" });
    expect(holder.inserted[0]).toMatchObject({ endpoint_id: "e1", lead_id: "l1", submitter_email: "ann@x.co", ip: "1.2.3.4", origin: "acme.com", is_spam: false, delivery_status: "pending" });
    expect(holder.delivered).toEqual([]);
    for (const fn of holder.after) await fn();
    expect(holder.delivered).toEqual(["sub-1"]);
  });

  it("accepts FormData", async () => {
    const fd = new FormData(); fd.append("access_key", "KEY"); fd.append("name", "Ann");
    const res = await POST(new Request("http://t/x", { method: "POST", body: fd }));
    expect(res.status).toBe(200);
  });

  it("404s an unknown key, 410s a paused endpoint, 400s a missing key", async () => {
    holder.endpoint = null;
    expect((await post({ access_key: "nope" })).status).toBe(404);
    holder.endpoint = { id: "e1", status: "paused", allowed_origins: [], daily_limit: 1 };
    expect((await post({ access_key: "KEY" })).status).toBe(410);
    expect((await post({ name: "x" })).status).toBe(400);
  });

  it("stores honeypot hits as spam and fakes success", async () => {
    const res = await post({ access_key: "KEY", botcheck: "on", name: "bot" });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(holder.inserted[0]).toMatchObject({ is_spam: true, spam_reason: "honeypot", delivery_status: "skipped" });
    expect(holder.after).toEqual([]);
  });

  it("403s and records an origin mismatch", async () => {
    holder.endpoint!.allowed_origins = ["acme.com"];
    const res = await post({ access_key: "KEY" }, { origin: "https://evil.com" });
    expect(res.status).toBe(403);
    expect(holder.inserted[0]).toMatchObject({ is_spam: true, spam_reason: "origin" });
  });

  it("429s over the daily limit", async () => {
    holder.todayCount = 200;
    expect((await post({ access_key: "KEY" })).status).toBe(429);
    expect(holder.inserted[0]).toMatchObject({ spam_reason: "rate_daily" });
  });

  it("303-redirects plain HTML posts", async () => {
    const res = await post("access_key=KEY&name=Ann&redirect=https%3A%2F%2Facme.com%2Fthanks", { "content-type": "application/x-www-form-urlencoded", accept: "text/html,application/xhtml+xml" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://acme.com/thanks");
  });

  it("503s when the tables are missing", async () => {
    holder.endpoint = null;
    holder.endpointError = { message: 'relation "public.form_endpoints" does not exist' };
    const res = await post({ access_key: "KEY" });
    expect(res.status).toBe(503);
    expect((await res.json()).message).toBe("Form relay not ready");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/formsSubmitRoute.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

```ts
// app/api/forms/submit/route.ts
import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseSubmissionRequest, extractSubmitter } from "@/lib/forms/parse";
import { originHost, clientIp, gateSubmission, utcDayStart } from "@/lib/forms/gate";
import { resolveSubject } from "@/lib/forms/email";
import { deliverSubmission } from "@/lib/forms/deliver";
import type { FormEndpointRow, FormSpamReason, PayloadField } from "@/lib/forms/types";

export const runtime = "nodejs";

/**
 * PUBLIC, web3forms-compatible ingest for client websites. Authenticated by
 * the endpoint's access_key, not a user session — this path is allowlisted
 * in lib/supabase/middleware.ts (an unlisted route 307s to /login, which no
 * route test can catch). CORS is handled here; nothing else in the app is
 * cross-origin.
 */

function cors(req: Request, res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", req.headers.get("origin") || "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Vary", "Origin");
  return res;
}

function reply(req: Request, status: number, body: Record<string, unknown>): NextResponse {
  return cors(req, NextResponse.json(body, { status }));
}

const fail = (req: Request, status: number, message: string) => reply(req, status, { success: false, message });

export async function OPTIONS(req: Request) {
  return cors(req, new NextResponse(null, { status: 204 }));
}

function wantsHtml(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("text/html") && !accept.includes("application/json");
}

function safeRedirect(url: string | null | undefined): string | null {
  if (!url) return null;
  try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null; } catch { return null; }
}

const THANKS_HTML = `<!doctype html><meta charset="utf-8"><title>Thank you</title><body style="font-family:system-ui;padding:48px;text-align:center"><h1>Thank you!</h1><p>Your message has been sent. We'll be in touch shortly.</p><p><a href="javascript:history.back()">Go back</a></p></body>`;

export async function POST(req: Request) {
  const parsed = await parseSubmissionRequest(req);
  if (!parsed.ok) return fail(req, parsed.status, parsed.message);
  const { reserved, payload } = parsed.value;

  const admin = createAdminClient();
  const { data: ep, error: epError } = await admin.from("form_endpoints").select("*").eq("access_key", reserved.access_key).maybeSingle();
  if (epError && /form_endpoints/.test(epError.message)) return fail(req, 503, "Form relay not ready");
  if (!ep) return fail(req, 404, "Unknown access key");
  const endpoint = ep as FormEndpointRow;
  if (endpoint.status === "paused") return fail(req, 410, "This form is paused");

  const host = originHost(req.headers.get("origin"), req.headers.get("referer"));
  const ip = clientIp(req.headers);
  let todayCount = 0;
  try {
    const { count } = await admin
      .from("form_submissions")
      .select("*", { count: "exact", head: true })
      .eq("endpoint_id", endpoint.id)
      .eq("is_spam", false)
      .gte("created_at", utcDayStart());
    todayCount = count ?? 0;
  } catch { /* count failure must not block a real submission */ }

  const verdict = gateSubmission({ originHost: host, endpoint, honeypot: reserved.botcheck, ip, todayCount });
  const submitter = extractSubmitter(payload, reserved);
  const subject = resolveSubject(reserved.subject, endpoint.subject_template ?? "", { site: endpoint.name, name: submitter.name });

  const row = {
    endpoint_id: endpoint.id,
    lead_id: endpoint.lead_id,
    payload: payload as PayloadField[],
    subject,
    submitter_name: submitter.name,
    submitter_email: submitter.email,
    ip,
    user_agent: (req.headers.get("user-agent") ?? "").slice(0, 500) || null,
    origin: host,
    referer: (req.headers.get("referer") ?? "").slice(0, 1000) || null,
    is_spam: !verdict.ok,
    spam_reason: verdict.ok ? null : (verdict.reason as FormSpamReason),
    delivery_status: verdict.ok ? "pending" : "skipped",
  };
  const { data: inserted, error: insError } = await admin.from("form_submissions").insert(row).select("id").single();
  if (insError || !inserted) return fail(req, 500, "Could not store submission");

  if (!verdict.ok) {
    if (verdict.status === 200) return successResponse(req, reserved.redirect, endpoint, payload); // honeypot: bots learn nothing
    return fail(req, verdict.status, verdict.reason === "origin" ? "Origin not allowed" : "Too many submissions, try again later");
  }

  after(() => deliverSubmission(inserted.id as string));
  return successResponse(req, reserved.redirect, endpoint, payload);
}

function successResponse(req: Request, redirect: string, endpoint: FormEndpointRow, payload: PayloadField[]): NextResponse {
  if (wantsHtml(req)) {
    const target = safeRedirect(redirect) ?? safeRedirect(endpoint.success_redirect_url);
    if (target) return cors(req, NextResponse.redirect(target, 303));
    return cors(req, new NextResponse(THANKS_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
  }
  const data: Record<string, string> = {};
  for (const f of payload) data[f.key] = f.value;
  return reply(req, 200, { success: true, message: "Form submitted successfully", data });
}
```

- [ ] **Step 4: Allowlist both public routes in the middleware**

In `lib/supabase/middleware.ts`, extend the `isPublic` expression. After the `path === "/api/site-agent/process"` line (the last term), change it to:

```ts
    path === "/api/site-agent/process" ||
    // Form Relay: the PUBLIC ingest for client websites (access_key auth +
    // CORS, see app/api/forms/submit/route.ts) and its secret-header retry
    // sweep called by the instrumentation poller. Neither has a session.
    path === "/api/forms/submit" ||
    path === "/api/forms/deliver";
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/formsSubmitRoute.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add app/api/forms/submit/route.ts lib/supabase/middleware.ts tests/formsSubmitRoute.test.ts
git commit -m "feat(forms): public web3forms-compatible submit route with CORS, gate and after() delivery"
```

---

### Task 9: Retry sweep route + poller

**Files:**
- Create: `app/api/forms/deliver/route.ts`
- Modify: `instrumentation.ts` (append one `setInterval` at the end of `register`)
- Test: `tests/formsDeliverRoute.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/formsDeliverRoute.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const holder = vi.hoisted(() => ({
  rows: [] as { id: string }[],
  delivered: [] as string[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ in: () => ({ lt: () => ({ order: () => ({ limit: async () => ({ data: holder.rows, error: null }) }) }) }) }),
    }),
  }),
}));
vi.mock("@/lib/forms/deliver", () => ({ deliverSubmission: async (id: string) => { holder.delivered.push(id); return { status: "sent" }; } }));

import { POST } from "@/app/api/forms/deliver/route";

const saved = process.env.WGE_PROCESSOR_SECRET;
beforeEach(() => { process.env.WGE_PROCESSOR_SECRET = "s3cret"; holder.rows = [{ id: "a" }, { id: "b" }]; holder.delivered = []; });
afterEach(() => { if (saved === undefined) delete process.env.WGE_PROCESSOR_SECRET; else process.env.WGE_PROCESSOR_SECRET = saved; });

const call = (secret?: string) => POST(new Request("http://t/x", { method: "POST", headers: secret ? { "x-wge-secret": secret } : {} }));

describe("POST /api/forms/deliver", () => {
  it("503s when unconfigured, 401s on a wrong secret", async () => {
    delete process.env.WGE_PROCESSOR_SECRET;
    expect((await call("x")).status).toBe(503);
    process.env.WGE_PROCESSOR_SECRET = "s3cret";
    expect((await call("wrong")).status).toBe(401);
    expect((await call()).status).toBe(401);
  });
  it("delivers every eligible row and reports", async () => {
    const res = await call("s3cret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 2, sent: 2, failed: 0 });
    expect(holder.delivered).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/formsDeliverRoute.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement the sweep route**

```ts
// app/api/forms/deliver/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliverSubmission } from "@/lib/forms/deliver";
import { MAX_DELIVERY_ATTEMPTS } from "@/lib/forms/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Retry sweep for form deliveries that are still pending (process died
 * between insert and after()) or failed (SMTP outage). Secret-header auth,
 * same contract as /api/site-builder/process; called by instrumentation.ts
 * every 2 minutes. One indexed query when idle.
 */
export async function POST(req: Request) {
  const expected = process.env.WGE_PROCESSOR_SECRET;
  if (!expected) return NextResponse.json({ error: "WGE_PROCESSOR_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("x-wge-secret") !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("form_submissions")
    .select("id")
    .in("delivery_status", ["pending", "failed"])
    .lt("delivery_attempts", MAX_DELIVERY_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0, failed = 0;
  for (const row of data ?? []) {
    const r = await deliverSubmission(row.id as string);
    if (r.status === "sent") sent++;
    else if (r.status === "failed") failed++;
  }
  return NextResponse.json({ processed: (data ?? []).length, sent, failed });
}
```

- [ ] **Step 4: Add the poller**

In `instrumentation.ts`, after the site-builder `setInterval` block at the end of `register()`, append:

```ts
  // Form Relay retry sweep: re-attempts pending/failed email deliveries.
  // Primary delivery is the submit route's after(); this only catches
  // SMTP outages and restarts mid-delivery.
  setInterval(() => {
    fetch(`${origin}/api/forms/deliver`, { method: "POST", headers: { "x-wge-secret": secret } }).catch(() => {});
  }, 120_000);
```

- [ ] **Step 5: Run tests, typecheck, commit**

Run: `npx vitest run tests/formsDeliverRoute.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

```bash
git add app/api/forms/deliver/route.ts instrumentation.ts tests/formsDeliverRoute.test.ts
git commit -m "feat(forms): delivery retry sweep route and 2-minute poller"
```

---

### Task 10: Dashboard guard + endpoints API

**Files:**
- Create: `lib/forms/guard.ts`
- Create: `lib/forms/load.ts`
- Create: `app/api/forms/endpoints/route.ts`
- Create: `app/api/forms/endpoints/[id]/route.ts`
- Create: `app/api/forms/endpoints/[id]/test/route.ts`
- Test: `tests/formsEndpointsRoute.test.ts`

- [ ] **Step 1: Write the guard**

```ts
// lib/forms/guard.ts
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { allowedFormScope, type FormScope } from "@/lib/forms/access";

export type FormsAuth = {
  userId: string;
  perms: Set<string>;
  scope: FormScope;
  admin: ReturnType<typeof createAdminClient>;
};

/**
 * Session + permission + scope for every Forms dashboard route/page.
 * `view` needs forms.view (or forms.manage); `manage` needs forms.manage.
 */
export async function requireForms(level: "view" | "manage"): Promise<FormsAuth | { error: 401 | 403 }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  const canManage = perms.has("forms.manage");
  const canView = canManage || perms.has("forms.view");
  if (level === "manage" ? !canManage : !canView) return { error: 403 };
  const admin = createAdminClient();
  const scope = await allowedFormScope(admin, user.id, perms);
  return { userId: user.id, perms, scope, admin };
}

export function formsAuthError(status: 401 | 403) {
  return Response.json({ error: status === 401 ? "Unauthorized" : "Forbidden" }, { status });
}
```

Next.js rejects extra exports from `route.ts` / `page.tsx` files at build time, so shared loaders live in `lib/forms/load.ts`, never in a route file:

```ts
// lib/forms/load.ts
import type { FormsAuth } from "@/lib/forms/guard";
import { endpointInScope, submissionInScope } from "@/lib/forms/access";
import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";

/** One endpoint the caller may see, or null (render as 404 — never leak existence). */
export async function loadVisibleEndpoint(auth: FormsAuth, id: string): Promise<FormEndpointRow | null> {
  const { data } = await auth.admin.from("form_endpoints").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as FormEndpointRow;
  return endpointInScope(row, auth.scope) ? row : null;
}

/** Same rule for a submission (its denormalised lead_id decides). */
export async function loadVisibleSubmission(auth: FormsAuth, id: string): Promise<FormSubmissionRow | null> {
  const { data } = await auth.admin.from("form_submissions").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as FormSubmissionRow;
  return submissionInScope(row, auth.scope) ? row : null;
}
```

- [ ] **Step 2: Write the failing route tests**

```ts
// tests/formsEndpointsRoute.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const holder = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  perms: new Set<string>(),
  endpoints: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  deleted: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: holder.user } }) } }) }));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => holder.perms }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "leads") return { select: () => ({ eq: () => ({ is: async () => ({ data: [{ id: "l1" }] }) }) }) };
      if (table === "form_submissions") return { select: () => ({ eq: () => ({ gte: async () => ({ data: [{ endpoint_id: "e1" }, { endpoint_id: "e1" }] }) }) }) };
      return {
        select: () => ({
          order: async () => ({ data: holder.endpoints, error: null }),
          eq: () => ({ maybeSingle: async () => ({ data: holder.endpoints.find(() => true) ?? null, error: null }) }),
        }),
        insert: (row: Record<string, unknown>) => { holder.inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: "new", ...row }, error: null }) }) }; },
        update: (patch: Record<string, unknown>) => ({ eq: () => ({ select: () => ({ single: async () => { holder.updated.push(patch); return { data: { id: "e1", ...patch }, error: null }; } }) }) }),
        delete: () => ({ eq: async (_c: string, id: string) => { holder.deleted.push(id); return { error: null }; } }),
      };
    },
  }),
}));

import { GET, POST } from "@/app/api/forms/endpoints/route";
import { PATCH, DELETE } from "@/app/api/forms/endpoints/[id]/route";

const json = (body: unknown, method = "POST") => new Request("http://t/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ id: "e1" }) };

beforeEach(() => {
  holder.user = { id: "u1" };
  holder.perms = new Set(["forms.view"]);
  holder.endpoints = [
    { id: "e1", lead_id: "l1", name: "Mine", access_key: "k1", to_emails: ["a@b.co"], allowed_origins: [], daily_limit: 200, status: "active", mailbox_id: null, subject_template: "", success_redirect_url: null },
    { id: "e2", lead_id: "l9", name: "Theirs", access_key: "k2", to_emails: ["c@d.co"], allowed_origins: [], daily_limit: 200, status: "active", mailbox_id: null, subject_template: "", success_redirect_url: null },
    { id: "e3", lead_id: null, name: "Orphan", access_key: "k3", to_emails: ["e@f.co"], allowed_origins: [], daily_limit: 200, status: "active", mailbox_id: null, subject_template: "", success_redirect_url: null },
  ];
  holder.inserted = []; holder.updated = []; holder.deleted = [];
});

describe("GET /api/forms/endpoints", () => {
  it("401/403 without session or permission", async () => {
    holder.user = null; expect((await GET()).status).toBe(401);
    holder.user = { id: "u1" }; holder.perms = new Set(); expect((await GET()).status).toBe(403);
  });
  it("scopes to my leads and adds today's counts", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.endpoints.map((e: { id: string }) => e.id)).toEqual(["e1"]);
    expect(body.endpoints[0].today_count).toBe(2);
  });
  it("managers with view_all see everything including lead-less endpoints", async () => {
    holder.perms = new Set(["forms.manage", "leads.view_all"]);
    const body = await (await GET()).json();
    expect(body.endpoints).toHaveLength(3);
  });
});

describe("POST /api/forms/endpoints", () => {
  it("needs forms.manage and validates", async () => {
    expect((await POST(json({ name: "x", to_emails: ["a@b.co"] }))).status).toBe(403);
    holder.perms = new Set(["forms.manage"]);
    expect((await POST(json({ name: "", to_emails: [] }))).status).toBe(422);
  });
  it("creates with a generated key", async () => {
    holder.perms = new Set(["forms.manage"]);
    const res = await POST(json({ name: "Acme", to_emails: ["a@b.co"], lead_id: null }));
    expect(res.status).toBe(201);
    expect(holder.inserted[0]).toMatchObject({ name: "Acme", created_by: "u1" });
    expect(String(holder.inserted[0].access_key)).toHaveLength(32);
  });
});

describe("PATCH/DELETE /api/forms/endpoints/[id]", () => {
  it("patches and deletes with forms.manage", async () => {
    holder.perms = new Set(["forms.manage", "leads.view_all"]);
    const res = await PATCH(json({ status: "paused" }, "PATCH"), ctx);
    expect(res.status).toBe(200);
    expect(holder.updated[0]).toMatchObject({ status: "paused" });
    expect((await DELETE(new Request("http://t/x", { method: "DELETE" }), ctx)).status).toBe(200);
    expect(holder.deleted).toEqual(["e1"]);
  });
  it("404s an endpoint outside my scope", async () => {
    holder.perms = new Set(["forms.manage"]);
    holder.endpoints = [holder.endpoints[1]];
    expect((await PATCH(json({ status: "paused" }, "PATCH"), ctx)).status).toBe(404);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/formsEndpointsRoute.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 4: Implement the list/create route**

```ts
// app/api/forms/endpoints/route.ts
import { NextResponse } from "next/server";
import { requireForms, formsAuthError } from "@/lib/forms/guard";
import { endpointInScope } from "@/lib/forms/access";
import { endpointInputSchema, generateAccessKey } from "@/lib/forms/schema";
import { utcDayStart } from "@/lib/forms/gate";
import type { EndpointListItem, FormEndpointRow } from "@/lib/forms/types";

export async function GET() {
  const auth = await requireForms("view");
  if ("error" in auth) return formsAuthError(auth.error);
  const { admin, scope } = auth;

  const { data, error } = await admin.from("form_endpoints").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const visible = ((data ?? []) as FormEndpointRow[]).filter((e) => endpointInScope(e, scope));

  const counts = new Map<string, number>();
  const { data: today } = await admin.from("form_submissions").select("endpoint_id").eq("is_spam", false).gte("created_at", utcDayStart());
  for (const r of today ?? []) counts.set(r.endpoint_id as string, (counts.get(r.endpoint_id as string) ?? 0) + 1);

  const endpoints: EndpointListItem[] = visible.map((e) => ({ ...e, today_count: counts.get(e.id) ?? 0 }));
  return NextResponse.json({ endpoints });
}

export async function POST(req: Request) {
  const auth = await requireForms("manage");
  if ("error" in auth) return formsAuthError(auth.error);

  const parsed = endpointInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid endpoint", issues: parsed.error.flatten() }, { status: 422 });

  const { data, error } = await auth.admin
    .from("form_endpoints")
    .insert({ ...parsed.data, access_key: generateAccessKey(), created_by: auth.userId })
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 400 });

  await auth.admin.from("activity_log").insert({ user_id: auth.userId, action: "form_endpoint.created", entity_type: "form_endpoint", entity_id: data.id, new_value: { name: data.name, lead_id: data.lead_id } });
  return NextResponse.json({ endpoint: data }, { status: 201 });
}
```

- [ ] **Step 5: Implement the detail route**

```ts
// app/api/forms/endpoints/[id]/route.ts
import { NextResponse } from "next/server";
import { requireForms, formsAuthError } from "@/lib/forms/guard";
import { loadVisibleEndpoint } from "@/lib/forms/load";
import { endpointPatchSchema } from "@/lib/forms/schema";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const auth = await requireForms("view");
  if ("error" in auth) return formsAuthError(auth.error);
  const endpoint = await loadVisibleEndpoint(auth, id);
  if (!endpoint) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ endpoint });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const auth = await requireForms("manage");
  if ("error" in auth) return formsAuthError(auth.error);
  const endpoint = await loadVisibleEndpoint(auth, id);
  if (!endpoint) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = endpointPatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid endpoint", issues: parsed.error.flatten() }, { status: 422 });

  const { data, error } = await auth.admin
    .from("form_endpoints")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 400 });
  return NextResponse.json({ endpoint: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const auth = await requireForms("manage");
  if ("error" in auth) return formsAuthError(auth.error);
  const endpoint = await loadVisibleEndpoint(auth, id);
  if (!endpoint) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { error } = await auth.admin.from("form_endpoints").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Implement the test-send route**

```ts
// app/api/forms/endpoints/[id]/test/route.ts
import { NextResponse } from "next/server";
import { requireForms, formsAuthError } from "@/lib/forms/guard";
import { loadVisibleEndpoint } from "@/lib/forms/load";
import { deliverSubmission } from "@/lib/forms/deliver";

/** Push a sample submission through the real pipeline (stored + emailed). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireForms("manage");
  if ("error" in auth) return formsAuthError(auth.error);
  const endpoint = await loadVisibleEndpoint(auth, id);
  if (!endpoint) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await auth.admin
    .from("form_submissions")
    .insert({
      endpoint_id: endpoint.id,
      lead_id: endpoint.lead_id,
      payload: [
        { key: "_test", value: "true" },
        { key: "name", value: "Test Visitor" },
        { key: "email", value: "test@example.com" },
        { key: "message", value: "This is a test submission sent from the SED LMS dashboard." },
      ],
      subject: `Test submission — ${endpoint.name}`,
      submitter_name: "Test Visitor",
      submitter_email: "test@example.com",
      origin: "dashboard",
      delivery_status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 400 });

  const result = await deliverSubmission(data.id as string);
  return NextResponse.json({ submission_id: data.id, result });
}
```

- [ ] **Step 7: Run tests, typecheck, commit**

Run: `npx vitest run tests/formsEndpointsRoute.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

```bash
git add lib/forms/guard.ts lib/forms/load.ts app/api/forms/endpoints tests/formsEndpointsRoute.test.ts
git commit -m "feat(forms): endpoints API (list/create/patch/delete/test) behind forms permissions"
```

---
### Task 11: Submissions API

**Files:**
- Create: `app/api/forms/submissions/route.ts`
- Create: `app/api/forms/submissions/[id]/route.ts`
- Create: `app/api/forms/submissions/[id]/resend/route.ts`
- Test: `tests/formsSubmissionsRoute.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/formsSubmissionsRoute.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const holder = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  perms: new Set<string>(),
  rows: [] as Record<string, unknown>[],
  filters: [] as [string, unknown][],
  updates: [] as Record<string, unknown>[],
  deleted: [] as string[],
  delivered: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: holder.user } }) } }) }));
vi.mock("@/lib/permissions/resolver", () => ({ getUserPermissions: async () => holder.perms }));
vi.mock("@/lib/forms/deliver", () => ({ deliverSubmission: async (id: string) => { holder.delivered.push(id); return { status: "sent" }; } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "leads") return { select: () => ({ eq: () => ({ is: async () => ({ data: [{ id: "l1" }] }) }), in: async () => ({ data: [{ id: "l1", business_name: "Acme" }] }) }) };
      if (table === "form_endpoints") return { select: () => ({ in: async () => ({ data: [{ id: "e1", name: "Acme contact" }] }) }) };
      const chain: Record<string, unknown> = {};
      const q = (name: string) => (col: string, val: unknown) => { holder.filters.push([name + ":" + col, val]); return chain; };
      Object.assign(chain, {
        select: () => chain, order: () => chain, limit: () => chain,
        eq: q("eq"), is: q("is"), in: q("in"), lt: q("lt"), or: (s: string) => { holder.filters.push(["or", s]); return chain; },
        then: (resolve: (v: unknown) => void) => resolve({ data: holder.rows, error: null }),
        maybeSingle: async () => ({ data: holder.rows[0] ?? null, error: null }),
        update: (patch: Record<string, unknown>) => ({ eq: async () => { holder.updates.push(patch); return { error: null }; } }),
        delete: () => ({ eq: async (_c: string, id: string) => { holder.deleted.push(id); return { error: null }; } }),
      });
      return chain;
    },
  }),
}));

import { GET } from "@/app/api/forms/submissions/route";
import { PATCH, DELETE } from "@/app/api/forms/submissions/[id]/route";
import { POST as RESEND } from "@/app/api/forms/submissions/[id]/resend/route";

const ctx = { params: Promise.resolve({ id: "s1" }) };
const patch = (body: unknown) => PATCH(new Request("http://t/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  holder.user = { id: "u1" };
  holder.perms = new Set(["forms.view"]);
  holder.rows = [
    { id: "s1", endpoint_id: "e1", lead_id: "l1", payload: [{ key: "name", value: "Ann" }], subject: "Hi", is_spam: false, delivery_status: "sent", read_at: null, created_at: "2026-09-05T10:00:00Z" },
    { id: "s2", endpoint_id: "e1", lead_id: "l9", payload: [], subject: "Other", is_spam: false, delivery_status: "sent", read_at: null, created_at: "2026-09-05T09:00:00Z" },
  ];
  holder.filters = []; holder.updates = []; holder.deleted = []; holder.delivered = [];
});

describe("GET /api/forms/submissions", () => {
  it("returns only my-scope rows, enriched with endpoint and lead names", async () => {
    const res = await GET(new Request("http://t/api/forms/submissions"));
    const body = await res.json();
    expect(body.submissions.map((s: { id: string }) => s.id)).toEqual(["s1"]);
    expect(body.submissions[0]).toMatchObject({ endpoint_name: "Acme contact", lead_name: "Acme" });
  });
  it("applies filters", async () => {
    await GET(new Request("http://t/api/forms/submissions?endpoint=e1&spam=1&status=failed&before=2026-09-05T09:30:00Z&q=ann"));
    expect(holder.filters).toEqual(expect.arrayContaining([["eq:endpoint_id", "e1"], ["eq:is_spam", true], ["eq:delivery_status", "failed"], ["lt:created_at", "2026-09-05T09:30:00Z"]]));
    expect(holder.filters.find(([k]) => k === "or")?.[1]).toContain("ann");
  });
});

describe("PATCH /api/forms/submissions/[id]", () => {
  it("marks read with forms.view", async () => {
    expect((await patch({ read: true })).status).toBe(200);
    expect(holder.updates[0]).toHaveProperty("read_at");
  });
  it("needs forms.manage to change spam, and re-queues on not-spam", async () => {
    expect((await patch({ spam: true })).status).toBe(403);
    holder.perms = new Set(["forms.manage"]);
    expect((await patch({ spam: true })).status).toBe(200);
    expect(holder.updates.at(-1)).toMatchObject({ is_spam: true, spam_reason: "manual", delivery_status: "skipped" });
    expect((await patch({ spam: false })).status).toBe(200);
    expect(holder.updates.at(-1)).toMatchObject({ is_spam: false, spam_reason: null, delivery_status: "pending", delivery_attempts: 0 });
    expect(holder.delivered).toEqual(["s1"]);
  });
  it("404s outside scope", async () => {
    holder.rows = [holder.rows[1]];
    expect((await patch({ read: true })).status).toBe(404);
  });
});

describe("resend + delete", () => {
  it("resend resets and delivers; delete removes", async () => {
    holder.perms = new Set(["forms.manage"]);
    const res = await RESEND(new Request("http://t/x", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    expect(holder.updates[0]).toMatchObject({ delivery_status: "pending", delivery_attempts: 0, last_error: null });
    expect(holder.delivered).toEqual(["s1"]);
    expect((await DELETE(new Request("http://t/x", { method: "DELETE" }), ctx)).status).toBe(200);
    expect(holder.deleted).toEqual(["s1"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/formsSubmissionsRoute.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 3: Implement the list route**

```ts
// app/api/forms/submissions/route.ts
import { NextResponse } from "next/server";
import { requireForms, formsAuthError } from "@/lib/forms/guard";
import { submissionInScope } from "@/lib/forms/access";
import type { FormSubmissionRow, SubmissionListItem } from "@/lib/forms/types";

const PAGE = 50;

/**
 * Inbox listing. Filters: endpoint, lead, spam (1|0), status, q (subject /
 * submitter), before (created_at cursor). Scope is applied in JS after the
 * query (same as tickets) — the table is per-operator sized.
 */
export async function GET(req: Request) {
  const auth = await requireForms("view");
  if ("error" in auth) return formsAuthError(auth.error);
  const { admin, scope } = auth;
  const p = new URL(req.url).searchParams;

  let query = admin.from("form_submissions").select("*").order("created_at", { ascending: false }).limit(PAGE * 2);
  const endpoint = p.get("endpoint"); if (endpoint) query = query.eq("endpoint_id", endpoint);
  const lead = p.get("lead"); if (lead) query = query.eq("lead_id", lead);
  const spam = p.get("spam"); if (spam === "1" || spam === "0") query = query.eq("is_spam", spam === "1");
  const status = p.get("status"); if (status) query = query.eq("delivery_status", status);
  const before = p.get("before"); if (before) query = query.lt("created_at", before);
  const q = p.get("q")?.trim(); if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`subject.ilike.%${safe}%,submitter_email.ilike.%${safe}%,submitter_name.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = ((data ?? []) as FormSubmissionRow[]).filter((s) => submissionInScope(s, scope)).slice(0, PAGE);

  const endpointIds = [...new Set(rows.map((r) => r.endpoint_id))];
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter((v): v is string => Boolean(v)))];
  const endpointNames = new Map<string, string>();
  const leadNames = new Map<string, string>();
  if (endpointIds.length) {
    const { data: eps } = await admin.from("form_endpoints").select("id, name").in("id", endpointIds);
    for (const e of eps ?? []) endpointNames.set(e.id as string, e.name as string);
  }
  if (leadIds.length) {
    const { data: leads } = await admin.from("leads").select("id, business_name").in("id", leadIds);
    for (const l of leads ?? []) leadNames.set(l.id as string, l.business_name as string);
  }

  const submissions: SubmissionListItem[] = rows.map((r) => ({
    ...r,
    endpoint_name: endpointNames.get(r.endpoint_id) ?? null,
    lead_name: r.lead_id ? leadNames.get(r.lead_id) ?? null : null,
  }));
  const next_before = rows.length === PAGE ? rows[rows.length - 1].created_at : null;
  return NextResponse.json({ submissions, next_before });
}
```

- [ ] **Step 4: Implement the detail route**

```ts
// app/api/forms/submissions/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireForms, formsAuthError } from "@/lib/forms/guard";
import { loadVisibleSubmission } from "@/lib/forms/load";
import { deliverSubmission } from "@/lib/forms/deliver";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({ read: z.boolean().optional(), spam: z.boolean().optional() });

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const auth = await requireForms("view");
  if ("error" in auth) return formsAuthError(auth.error);
  const sub = await loadVisibleSubmission(auth, id);
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid patch" }, { status: 422 });
  const { read, spam } = parsed.data;

  if (spam !== undefined && !auth.perms.has("forms.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (read !== undefined) {
    const { error } = await auth.admin.from("form_submissions").update({ read_at: read ? new Date().toISOString() : null }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (spam === true) {
    const { error } = await auth.admin.from("form_submissions").update({ is_spam: true, spam_reason: "manual", delivery_status: "skipped" }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (spam === false) {
    // Not spam after all → re-queue and deliver now.
    const { error } = await auth.admin.from("form_submissions").update({ is_spam: false, spam_reason: null, delivery_status: "pending", delivery_attempts: 0, last_error: null }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    await deliverSubmission(id);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const auth = await requireForms("manage");
  if ("error" in auth) return formsAuthError(auth.error);
  const sub = await loadVisibleSubmission(auth, id);
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { error } = await auth.admin.from("form_submissions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Implement the resend route**

```ts
// app/api/forms/submissions/[id]/resend/route.ts
import { NextResponse } from "next/server";
import { requireForms, formsAuthError } from "@/lib/forms/guard";
import { loadVisibleSubmission } from "@/lib/forms/load";
import { deliverSubmission } from "@/lib/forms/deliver";

/** Reset the delivery state and send again, right now. Works on sent rows too (a true re-send). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireForms("manage");
  if ("error" in auth) return formsAuthError(auth.error);
  const sub = await loadVisibleSubmission(auth, id);
  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (sub.is_spam) return NextResponse.json({ error: "Mark as not spam first" }, { status: 409 });

  const { error } = await auth.admin.from("form_submissions").update({ delivery_status: "pending", delivery_attempts: 0, last_error: null }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const result = await deliverSubmission(id);
  return NextResponse.json({ result });
}
```

- [ ] **Step 6: Run tests, typecheck, commit**

Run: `npx vitest run tests/formsSubmissionsRoute.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no type errors.

```bash
git add app/api/forms/submissions tests/formsSubmissionsRoute.test.ts
git commit -m "feat(forms): submissions API (inbox list, read/spam patch, resend, delete)"
```

---

### Task 12: Default sender mailbox in Settings

**Files:**
- Modify: `lib/settings/appSettings.ts` (type, defaults, select list)
- Modify: `app/api/admin/settings/route.ts` (schema + upsert)
- Modify: `app/(app)/admin/settings/page.tsx` (load verified mailboxes)
- Modify: `components/admin/AppSettingsCard.tsx` (select + PUT body)

- [ ] **Step 1: Extend the settings type**

In `lib/settings/appSettings.ts`:
- Add to `AppSettings`: `form_default_mailbox_id: string | null;` with the doc comment `/** Form Relay fallback sender when an endpoint has no mailbox of its own. */`.
- Add to `DEFAULT_APP_SETTINGS`: `form_default_mailbox_id: null,`.
- In the `.select(...)` string inside `getAppSettings`, append `, form_default_mailbox_id`.

- [ ] **Step 2: Accept it in the settings route**

In `app/api/admin/settings/route.ts`:
- Add to `settingsSchema`: `form_default_mailbox_id: z.string().uuid().nullable().optional(),`
- Destructure it alongside the others: `form_default_mailbox_id,`
- Add to the upsert object: `form_default_mailbox_id: form_default_mailbox_id ?? null,`
- Add to the returned JSON object at the end: `form_default_mailbox_id: form_default_mailbox_id ?? null,`

- [ ] **Step 3: Load mailboxes on the settings page**

In `app/(app)/admin/settings/page.tsx`, add the import `import { createAdminClient } from "@/lib/supabase/admin";` and, after `const settings = await getAppSettings();`:

```ts
  const { data: mailboxes } = await createAdminClient()
    .from("company_mailboxes")
    .select("id, email_address, display_name")
    .eq("status", "verified")
    .order("email_address");
```

and pass `mailboxes={mailboxes ?? []}` to `<AppSettingsCard>`. Update the description line to `Branding, work hours, ticket SLAs, retention and the Form Relay sender.`

- [ ] **Step 4: Add the select to the card**

In `components/admin/AppSettingsCard.tsx`:
- Add the prop: `mailboxes: { id: string; email_address: string; display_name: string }[];` (both in the destructuring and the type).
- Add state: `const [formMailboxId, setFormMailboxId] = useState<string>(initial.form_default_mailbox_id ?? "");`
- In the `save()` body object add: `form_default_mailbox_id: formMailboxId || null,`
- Import the select: `import { Select } from "@/components/common/Select";`
- Render, directly before the Save button's container (search for `Save settings`), a new block:

```tsx
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">Form Relay default sender</label>
          <Select value={formMailboxId} onChange={(e) => setFormMailboxId(e.target.value)} className={inputCls}>
            <option value="">— none (deliveries will fail until set) —</option>
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name ? `${m.display_name} <${m.email_address}>` : m.email_address}</option>
            ))}
          </Select>
          <p className="text-[11px] text-text-faint mt-1">
            Used for website form notifications when an endpoint has no sender of its own. Link and verify a mailbox under Company Mail first.
          </p>
        </div>
```

- [ ] **Step 5: Typecheck, run the whole suite, commit**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: no type errors; all tests pass (existing settings tests, if any, still pass because the new field is optional).

```bash
git add lib/settings/appSettings.ts app/api/admin/settings/route.ts "app/(app)/admin/settings/page.tsx" components/admin/AppSettingsCard.tsx
git commit -m "feat(forms): default sender mailbox setting for Form Relay"
```

---

### Task 13: Sidebar entry and unread badge

**Files:**
- Modify: `lib/nav/counts.ts`
- Modify: `app/api/nav-counts/route.ts`
- Modify: `components/layout/Sidebar.tsx` (the `MAIN` array)
- Test: `tests/formsNavCounts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/formsNavCounts.test.ts
import { describe, it, expect } from "vitest";
import { navCountKey, navCountTone } from "@/lib/nav/counts";

describe("Forms nav badge", () => {
  it("maps /forms to the forms count in the alert palette", () => {
    expect(navCountKey("/forms")).toBe("forms");
    expect(navCountTone("forms")).toBe("alert");
  });
});
```

Run: `npx vitest run tests/formsNavCounts.test.ts` — Expected: FAIL (`undefined`).

- [ ] **Step 2: Map the href and tone**

In `lib/nav/counts.ts`, add `"/forms": "forms",` to `NAV_COUNT_BY_HREF` (after `"/payments": "payments",`) and change `ALERT_KEYS` to `new Set(["followups", "tickets", "feedback", "forms"])`.

- [ ] **Step 3: Compute the count**

In `app/api/nav-counts/route.ts`, add the imports `import { allowedFormScope } from "@/lib/forms/access";` and, inside `computeCounts` after the `payments` block, add:

```ts
  if (perms.has("forms.view") || perms.has("forms.manage")) {
    // Unread, non-spam website form submissions in the user's scope.
    tasks.push(
      run("forms", async () => {
        const scope = await allowedFormScope(admin, userId, perms);
        let q = admin.from("form_submissions").select("*", { count: "exact", head: true }).is("read_at", null).eq("is_spam", false);
        if (!scope.all) {
          const ids = [...scope.leadIds];
          if (!ids.length) return 0;
          q = q.in("lead_id", ids);
        }
        const { count, error } = await q;
        if (error) throw error;
        return count ?? 0;
      })
    );
  }
```

- [ ] **Step 4: Add the nav entry**

In `components/layout/Sidebar.tsx`, in the `MAIN` array, insert after the `/contracts` line:

```ts
  { href: "/forms", label: "Forms", icon: Inbox, perm: "forms.view" },
```

(`Inbox` is already imported.) Users with only `forms.manage` also get `forms.view` via the seed; the page itself accepts either.

- [ ] **Step 5: Run tests, typecheck, commit**

Run: `npx vitest run tests/formsNavCounts.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, no errors.

```bash
git add lib/nav/counts.ts app/api/nav-counts/route.ts components/layout/Sidebar.tsx tests/formsNavCounts.test.ts
git commit -m "feat(forms): Forms sidebar entry with unread badge"
```

---
### Task 14: Forms inbox page

UI tasks are verified in the browser, not by unit tests: run `npm run dev`, open the page, and check the described behaviour. The component contracts are small and the data comes from the routes already tested above.

**Files:**
- Create: `components/form-relay/FormsTabs.tsx`
- Create: `components/form-relay/DeliveryPill.tsx`
- Create: `components/form-relay/SubmissionDrawer.tsx`
- Create: `components/form-relay/SubmissionsInbox.tsx`
- Create: `app/(app)/forms/page.tsx`

- [ ] **Step 1: Tabs and pills**

```tsx
// components/form-relay/FormsTabs.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/forms", label: "Submissions" },
  { href: "/forms/endpoints", label: "Endpoints" },
];

export function FormsTabs() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 border-b border-border">
      {TABS.map((t) => {
        const active = t.href === "/forms" ? path === "/forms" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              active ? "border-accent text-accent-ink" : "border-transparent text-text-muted hover:text-text"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

```tsx
// components/form-relay/DeliveryPill.tsx
import { Pill, type PillTone } from "@/components/common/Panel";
import type { FormDeliveryStatus } from "@/lib/forms/types";

const TONE: Record<FormDeliveryStatus, PillTone> = { sent: "ready", pending: "accent", failed: "dropped", skipped: "neutral" };
const LABEL: Record<FormDeliveryStatus, string> = { sent: "Sent", pending: "Pending", failed: "Failed", skipped: "Skipped" };

export function DeliveryPill({ status, spam }: { status: FormDeliveryStatus; spam: boolean }) {
  if (spam) return <Pill tone="notready">Spam</Pill>;
  return <Pill tone={TONE[status]}>{LABEL[status]}</Pill>;
}
```

- [ ] **Step 2: The drawer**

```tsx
// components/form-relay/SubmissionDrawer.tsx
"use client";

import { useState } from "react";
import { X, RotateCw, ShieldOff, ShieldCheck, Trash2 } from "lucide-react";
import { btnSecondarySm, btnGhostSm, iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { formatDateTime } from "@/lib/leads/format";
import { DeliveryPill } from "@/components/form-relay/DeliveryPill";
import type { SubmissionListItem } from "@/lib/forms/types";

export function SubmissionDrawer({
  submission,
  canManage,
  onClose,
  onChanged,
}: {
  submission: SubmissionListItem;
  canManage: boolean;
  onClose: () => void;
  /** Called after any mutation so the list refetches. */
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const s = submission;

  async function act(label: string, fn: () => Promise<Response>) {
    setBusy(label);
    const res = await fn();
    setBusy(null);
    if (!res.ok) { toast({ kind: "error", title: `${label} failed`, body: (await res.json().catch(() => ({}))).error }); return; }
    toast({ kind: "success", title: `${label} done` });
    onChanged();
  }
  const patch = (body: Record<string, unknown>) =>
    fetch(`/api/forms/submissions/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-base font-semibold text-text">{s.subject || "(no subject)"}</h2>
            <p className="mt-0.5 text-xs text-text-muted">{s.endpoint_name ?? "Unknown endpoint"}{s.lead_name ? ` · ${s.lead_name}` : ""} · {formatDateTime(s.created_at)}</p>
          </div>
          <button type="button" className={iconBtn} onClick={onClose} title="Close" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <DeliveryPill status={s.delivery_status} spam={s.is_spam} />
          {s.is_spam && s.spam_reason ? <span className="text-xs text-text-muted">reason: {s.spam_reason}</span> : null}
        </div>

        <table className="mt-4 w-full text-sm">
          <tbody>
            {s.payload.map((f, i) => (
              <tr key={i} className="border-t border-border-subtle align-top">
                <td className="w-1/3 py-2 pr-3 font-medium text-text-muted">{f.key}</td>
                <td className="whitespace-pre-wrap break-words py-2 text-text">
                  {f.key.toLowerCase().includes("email") && f.value.includes("@") ? <a className="text-accent-ink underline" href={`mailto:${f.value}`}>{f.value}</a> : f.value}
                </td>
              </tr>
            ))}
            {s.payload.length === 0 ? <tr><td className="py-2 text-text-muted">No fields.</td></tr> : null}
          </tbody>
        </table>

        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-text-muted">
          <dt>From</dt><dd className="text-text">{s.submitter_name ?? "—"} {s.submitter_email ? <a className="underline" href={`mailto:${s.submitter_email}`}>{s.submitter_email}</a> : null}</dd>
          <dt>Site</dt><dd className="text-text">{s.origin ?? "—"}</dd>
          <dt>Referer</dt><dd className="break-all text-text">{s.referer ?? "—"}</dd>
          <dt>IP</dt><dd className="text-text">{s.ip ?? "—"}</dd>
          <dt>Browser</dt><dd className="break-all text-text">{s.user_agent ?? "—"}</dd>
          <dt>Delivery</dt>
          <dd className="text-text">
            {s.delivery_attempts} attempt{s.delivery_attempts === 1 ? "" : "s"}
            {s.delivered_at ? ` · sent ${formatDateTime(s.delivered_at)}` : ""}
            {s.last_error ? <span className="block text-dropped-fg">{s.last_error}</span> : null}
          </dd>
        </dl>

        {canManage ? (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
            {!s.is_spam ? (
              <button type="button" className={btnSecondarySm} disabled={busy !== null} onClick={() => act("Resend", () => fetch(`/api/forms/submissions/${s.id}/resend`, { method: "POST" }))}>
                <RotateCw className="h-3.5 w-3.5" /> Resend
              </button>
            ) : null}
            {s.is_spam ? (
              <button type="button" className={btnSecondarySm} disabled={busy !== null} onClick={() => act("Not spam", () => patch({ spam: false }))}>
                <ShieldCheck className="h-3.5 w-3.5" /> Not spam (deliver)
              </button>
            ) : (
              <button type="button" className={btnSecondarySm} disabled={busy !== null} onClick={() => act("Mark spam", () => patch({ spam: true }))}>
                <ShieldOff className="h-3.5 w-3.5" /> Mark spam
              </button>
            )}
            <button
              type="button"
              className={btnGhostSm}
              disabled={busy !== null}
              onClick={() => { if (confirm("Delete this submission permanently?")) act("Delete", () => fetch(`/api/forms/submissions/${s.id}`, { method: "DELETE" })).then(onClose); }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: The inbox**

```tsx
// components/form-relay/SubmissionsInbox.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Inbox as InboxIcon, Search } from "lucide-react";
import { Panel, EmptyPanel } from "@/components/common/Panel";
import { Select } from "@/components/common/Select";
import { btnSecondarySm } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { formatRelative } from "@/lib/leads/format";
import { previewLine } from "@/lib/forms/email";
import { DeliveryPill } from "@/components/form-relay/DeliveryPill";
import { SubmissionDrawer } from "@/components/form-relay/SubmissionDrawer";
import type { SubmissionListItem } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

type EndpointOption = { id: string; name: string };

export function SubmissionsInbox({ endpoints, canManage }: { endpoints: EndpointOption[]; canManage: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [rows, setRows] = useState<SubmissionListItem[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [endpoint, setEndpoint] = useState("");
  const [spam, setSpam] = useState("0");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(params.get("submission"));

  const load = useCallback(async (before?: string) => {
    setLoading(true);
    const p = new URLSearchParams();
    if (endpoint) p.set("endpoint", endpoint);
    if (spam) p.set("spam", spam);
    if (status) p.set("status", status);
    if (q.trim()) p.set("q", q.trim());
    if (before) p.set("before", before);
    const res = await fetch(`/api/forms/submissions?${p}`);
    const body = res.ok ? await res.json() : { submissions: [], next_before: null };
    setRows((prev) => (before ? [...prev, ...body.submissions] : body.submissions));
    setNextBefore(body.next_before);
    setLoading(false);
  }, [endpoint, spam, status, q]);

  useEffect(() => { void load(); }, [load]);

  // The bell links to /forms?submission=<id>; that row may be outside the
  // current filters, so it is fetched on its own when not in the list.
  const open = rows.find((r) => r.id === openId) ?? null;
  useEffect(() => {
    if (!openId || open) return;
    void (async () => {
      const res = await fetch(`/api/forms/submissions?spam=&q=&status=`);
      if (!res.ok) return;
      const body = await res.json();
      const hit = (body.submissions as SubmissionListItem[]).find((r) => r.id === openId);
      if (hit) setRows((prev) => (prev.some((r) => r.id === hit.id) ? prev : [hit, ...prev]));
    })();
  }, [openId, open]);

  async function openRow(r: SubmissionListItem) {
    setOpenId(r.id);
    if (!r.read_at) {
      await fetch(`/api/forms/submissions/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ read: true }) });
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, read_at: new Date().toISOString() } : x)));
      router.refresh(); // nav badge
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className={cn(inputCls, "w-auto")}>
          <option value="">All endpoints</option>
          {endpoints.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
        <Select value={spam} onChange={(e) => setSpam(e.target.value)} className={cn(inputCls, "w-auto")}>
          <option value="0">Not spam</option>
          <option value="1">Spam</option>
          <option value="">All</option>
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className={cn(inputCls, "w-auto")}>
          <option value="">Any delivery</option>
          <option value="sent">Sent</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </Select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject or sender" className={cn(inputCls, "w-64 pl-8")} />
        </div>
      </div>

      <Panel flush>
        {rows.length === 0 && !loading ? (
          <EmptyPanel icon={InboxIcon} title="No submissions" hint="Submissions from your client sites will appear here." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Endpoint / lead</th>
                <th className="px-4 py-2 font-medium">From</th>
                <th className="px-4 py-2 font-medium">Subject</th>
                <th className="px-4 py-2 font-medium">Delivery</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => openRow(r)} className={cn("cursor-pointer border-t border-border-subtle hover:bg-surface-2", !r.read_at && "font-semibold")}>
                  <td className="whitespace-nowrap px-4 py-2 text-text-muted">{formatRelative(r.created_at)}</td>
                  <td className="px-4 py-2"><div className="text-text">{r.endpoint_name ?? "—"}</div><div className="text-xs font-normal text-text-muted">{r.lead_name ?? ""}</div></td>
                  <td className="px-4 py-2"><div className="text-text">{r.submitter_name ?? "—"}</div><div className="text-xs font-normal text-text-muted">{r.submitter_email ?? ""}</div></td>
                  <td className="max-w-md px-4 py-2"><div className="truncate text-text">{r.subject || "(no subject)"}</div><div className="truncate text-xs font-normal text-text-muted">{previewLine(r.payload, 90)}</div></td>
                  <td className="px-4 py-2"><DeliveryPill status={r.delivery_status} spam={r.is_spam} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {nextBefore ? (
          <div className="border-t border-border p-3 text-center">
            <button type="button" className={btnSecondarySm} disabled={loading} onClick={() => load(nextBefore)}>Load more</button>
          </div>
        ) : null}
      </Panel>

      {open ? (
        <SubmissionDrawer
          submission={open}
          canManage={canManage}
          onClose={() => { setOpenId(null); if (params.get("submission")) router.replace("/forms"); }}
          onChanged={() => void load()}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: The page**

```tsx
// app/(app)/forms/page.tsx
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/Panel";
import { FormsTabs } from "@/components/form-relay/FormsTabs";
import { SubmissionsInbox } from "@/components/form-relay/SubmissionsInbox";
import { requireForms } from "@/lib/forms/guard";
import { endpointInScope } from "@/lib/forms/access";
import type { FormEndpointRow } from "@/lib/forms/types";

export default async function FormsPage() {
  const auth = await requireForms("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");

  const { data } = await auth.admin.from("form_endpoints").select("id, name, lead_id").order("name");
  const endpoints = ((data ?? []) as Pick<FormEndpointRow, "id" | "name" | "lead_id">[])
    .filter((e) => endpointInScope(e, auth.scope))
    .map((e) => ({ id: e.id, name: e.name }));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="Forms" description="Submissions from your client websites, relayed to the client by email and kept here." />
      <FormsTabs />
      <Suspense>
        <SubmissionsInbox endpoints={endpoints} canManage={auth.perms.has("forms.manage")} />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 5: Verify in the browser and commit**

Run: `npx tsc --noEmit -p tsconfig.json`, then `npm run dev`, sign in as an admin (forms.manage granted by the migration), open `/forms`. Expected: the Forms nav entry shows, the page renders the tabs and an empty inbox with the filters. (Submissions appear after Task 15/16 create an endpoint and a test send.)

```bash
git add components/form-relay/FormsTabs.tsx components/form-relay/DeliveryPill.tsx components/form-relay/SubmissionDrawer.tsx components/form-relay/SubmissionsInbox.tsx "app/(app)/forms/page.tsx"
git commit -m "feat(forms): submissions inbox page with drawer, filters and read tracking"
```

---

### Task 15: Endpoints list + editor + integration card

**Files:**
- Create: `lib/forms/editorOptions.ts`
- Create: `components/form-relay/IntegrationCard.tsx`
- Create: `components/form-relay/EndpointEditor.tsx`
- Create: `components/form-relay/EndpointsTable.tsx`
- Create: `app/(app)/forms/endpoints/page.tsx`
- Create: `app/(app)/forms/endpoints/new/page.tsx`
- Create: `app/(app)/forms/endpoints/[id]/page.tsx`

- [ ] **Step 1: Integration card**

```tsx
// components/form-relay/IntegrationCard.tsx
"use client";

import { useState } from "react";
import { Code2, Copy, Check, Send } from "lucide-react";
import { Panel } from "@/components/common/Panel";
import { btnSecondarySm, btnGhostSm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { htmlSnippet, jsSnippet } from "@/lib/forms/snippet";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={btnGhostSm}
      onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copied" : label}
    </button>
  );
}

export function IntegrationCard({ endpointId, url, accessKey, canManage }: { endpointId: string; url: string; accessKey: string; canManage: boolean }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"js" | "html">("js");
  const [sending, setSending] = useState(false);
  const code = tab === "js" ? jsSnippet({ url, accessKey }) : htmlSnippet({ url, accessKey });

  async function sendTest() {
    setSending(true);
    const res = await fetch(`/api/forms/endpoints/${endpointId}/test`, { method: "POST" });
    setSending(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ kind: "error", title: "Test failed", body: body.error }); return; }
    if (body.result?.status === "sent") toast({ kind: "success", title: "Test email sent", body: "Check the recipient inbox and the Submissions tab." });
    else toast({ kind: "error", title: "Stored but not delivered", body: body.result?.error ?? "See the submission for details." });
  }

  return (
    <Panel
      icon={Code2}
      title="Integration"
      description="Paste one of these into the client site. Only the URL and key differ from web3forms."
      action={canManage ? (
        <button type="button" className={btnSecondarySm} disabled={sending} onClick={sendTest}>
          <Send className="h-3.5 w-3.5" /> {sending ? "Sending…" : "Send test"}
        </button>
      ) : null}
    >
      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
        <dt className="text-text-muted">Submit URL</dt><dd className="truncate font-mono text-xs text-text">{url}</dd><dd><CopyButton text={url} label="Copy" /></dd>
        <dt className="text-text-muted">Access key</dt><dd className="truncate font-mono text-xs text-text">{accessKey}</dd><dd><CopyButton text={accessKey} label="Copy" /></dd>
      </dl>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex gap-1">
          <button type="button" className={btnGhostSm + (tab === "js" ? " bg-surface-2 text-text" : "")} onClick={() => setTab("js")}>JavaScript (fetch)</button>
          <button type="button" className={btnGhostSm + (tab === "html" ? " bg-surface-2 text-text" : "")} onClick={() => setTab("html")}>Plain HTML form</button>
        </div>
        <CopyButton text={code} label="Copy snippet" />
      </div>
      <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-text">{code}</pre>
    </Panel>
  );
}
```

- [ ] **Step 2: Endpoint editor**

```tsx
// components/form-relay/EndpointEditor.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/common/Panel";
import { Select } from "@/components/common/Select";
import { Field, inputCls } from "@/components/forms/Field";
import { btnPrimary, btnSecondary } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import type { FormEndpointRow } from "@/lib/forms/types";

export type LeadOption = { id: string; business_name: string; business_email: string | null };
export type MailboxOption = { id: string; email_address: string; display_name: string };

const splitList = (s: string) => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

export function EndpointEditor({
  initial,
  leads,
  mailboxes,
  presetLeadId = null,
}: {
  initial: FormEndpointRow | null;
  leads: LeadOption[];
  mailboxes: MailboxOption[];
  /** From /forms/endpoints/new?lead=<id> (the lead page shortcut). */
  presetLeadId?: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const presetLead = leads.find((l) => l.id === presetLeadId) ?? null;

  const [name, setName] = useState(initial?.name ?? (presetLead ? `${presetLead.business_name} – contact` : ""));
  const [leadId, setLeadId] = useState(initial?.lead_id ?? presetLeadId ?? "");
  const [toEmails, setToEmails] = useState((initial?.to_emails ?? (presetLead?.business_email ? [presetLead.business_email] : [])).join(", "));
  const [subjectTemplate, setSubjectTemplate] = useState(initial?.subject_template ?? "");
  const [mailboxId, setMailboxId] = useState(initial?.mailbox_id ?? "");
  const [origins, setOrigins] = useState((initial?.allowed_origins ?? []).join(", "));
  const [dailyLimit, setDailyLimit] = useState(initial?.daily_limit ?? 200);
  const [redirect, setRedirect] = useState(initial?.success_redirect_url ?? "");
  const [paused, setPaused] = useState(initial?.status === "paused");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onLeadChange(id: string) {
    setLeadId(id);
    const l = leads.find((x) => x.id === id);
    if (l && !initial) {
      if (!name) setName(`${l.business_name} – contact`);
      if (!toEmails && l.business_email) setToEmails(l.business_email);
    }
  }

  async function save() {
    setSaving(true); setError(null);
    const body = {
      name: name.trim(),
      lead_id: leadId || null,
      to_emails: splitList(toEmails),
      subject_template: subjectTemplate.trim(),
      mailbox_id: mailboxId || null,
      allowed_origins: splitList(origins),
      daily_limit: Math.max(1, Math.round(Number(dailyLimit)) || 200),
      success_redirect_url: redirect.trim() || null,
      status: paused ? "paused" : "active",
    };
    const res = await fetch(initial ? `/api/forms/endpoints/${initial.id}` : "/api/forms/endpoints", {
      method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setSaving(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const first = json.issues?.fieldErrors ? Object.entries(json.issues.fieldErrors as Record<string, string[]>).map(([k, v]) => `${k}: ${v[0]}`)[0] : null;
      setError(first ?? json.error ?? "Save failed");
      return;
    }
    toast({ kind: "success", title: initial ? "Endpoint saved" : "Endpoint created" });
    if (initial) router.refresh(); else router.push(`/forms/endpoints/${json.endpoint.id}`);
  }

  return (
    <Panel title={initial ? "Settings" : "New endpoint"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Roofing – contact form" /></Field>
        <Field label="Lead" hint="Submissions show on this lead's page and ping its agent.">
          <Select className={inputCls} value={leadId} onChange={(e) => onLeadChange(e.target.value)}>
            <option value="">— none —</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.business_name}</option>)}
          </Select>
        </Field>
        <Field label="Send to" required hint="Comma-separated email addresses of the client.">
          <input className={inputCls} value={toEmails} onChange={(e) => setToEmails(e.target.value)} placeholder="owner@client.com" />
        </Field>
        <Field label="Subject template" hint="{site} = endpoint name, {name} = visitor. Blank = default.">
          <input className={inputCls} value={subjectTemplate} onChange={(e) => setSubjectTemplate(e.target.value)} placeholder="New enquiry from {name} — {site}" />
        </Field>
        <Field label="Sender mailbox" hint="Blank = the default set in Admin › Settings.">
          <Select className={inputCls} value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
            <option value="">— default —</option>
            {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.display_name ? `${m.display_name} <${m.email_address}>` : m.email_address}</option>)}
          </Select>
        </Field>
        <Field label="Allowed origins" hint="Hostnames, comma-separated. Blank = any site may post. *.example.com matches subdomains.">
          <input className={inputCls} value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="acmeroofing.com, *.acmeroofing.com" />
        </Field>
        <Field label="Daily limit"><input type="number" min={1} className={inputCls} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} /></Field>
        <Field label="Redirect after plain HTML post" hint="Only used by non-JavaScript forms."><input className={inputCls} value={redirect} onChange={(e) => setRedirect(e.target.value)} placeholder="https://acmeroofing.com/thank-you" /></Field>
        <label className="flex items-center gap-2 text-sm text-text sm:col-span-2">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Paused (submissions are rejected with 410)
        </label>
      </div>
      {error ? <p className="mt-3 text-sm text-dropped-fg">{error}</p> : null}
      <div className="mt-5 flex gap-2">
        <button type="button" className={btnPrimary} disabled={saving} onClick={save}>{saving ? "Saving…" : initial ? "Save changes" : "Create endpoint"}</button>
        <button type="button" className={btnSecondary} onClick={() => router.push("/forms/endpoints")}>Back</button>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 3: Endpoints table**

```tsx
// components/form-relay/EndpointsTable.tsx
import Link from "next/link";
import { Plus, Inbox } from "lucide-react";
import { Panel, EmptyPanel, Pill } from "@/components/common/Panel";
import { btnSecondarySm } from "@/components/common/buttons";
import type { EndpointListItem } from "@/lib/forms/types";

export function EndpointsTable({ endpoints, leadNames, canManage }: { endpoints: EndpointListItem[]; leadNames: Record<string, string>; canManage: boolean }) {
  return (
    <Panel
      flush
      title="Endpoints"
      count={endpoints.length}
      action={canManage ? <Link href="/forms/endpoints/new" className={btnSecondarySm}><Plus className="h-3.5 w-3.5" /> New endpoint</Link> : null}
    >
      {endpoints.length === 0 ? (
        <EmptyPanel icon={Inbox} title="No endpoints yet" hint="Create one per client website; each gets its own access key." />
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs text-text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Lead</th>
              <th className="px-4 py-2 font-medium">Send to</th>
              <th className="px-4 py-2 font-medium">Today</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={e.id} className="border-t border-border-subtle hover:bg-surface-2">
                <td className="px-4 py-2"><Link href={`/forms/endpoints/${e.id}`} className="font-medium text-text hover:underline">{e.name}</Link></td>
                <td className="px-4 py-2 text-text-muted">{e.lead_id ? leadNames[e.lead_id] ?? "—" : "—"}</td>
                <td className="px-4 py-2 text-text-muted">{e.to_emails.join(", ") || <span className="text-dropped-fg">no recipients</span>}</td>
                <td className="px-4 py-2 tabular text-text-muted">{e.today_count} / {e.daily_limit}</td>
                <td className="px-4 py-2">{e.status === "paused" ? <Pill tone="notready">Paused</Pill> : <Pill tone="ready">Active</Pill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
```

- [ ] **Step 4: Editor options loader (lib, not a page export)**

```ts
// lib/forms/editorOptions.ts
import type { FormsAuth } from "@/lib/forms/guard";
import type { LeadOption, MailboxOption } from "@/components/form-relay/EndpointEditor";

/** Leads the caller may attach (their own, or all with leads.view_all) + verified mailboxes. */
export async function loadEditorOptions(auth: FormsAuth): Promise<{ leads: LeadOption[]; mailboxes: MailboxOption[] }> {
  let q = auth.admin.from("leads").select("id, business_name, business_email").is("deleted_at", null).order("business_name");
  if (!auth.scope.all) q = q.eq("agent_id", auth.userId);
  const { data: leads } = await q;
  const { data: mailboxes } = await auth.admin.from("company_mailboxes").select("id, email_address, display_name").eq("status", "verified").order("email_address");
  return { leads: (leads ?? []) as LeadOption[], mailboxes: (mailboxes ?? []) as MailboxOption[] };
}
```

- [ ] **Step 5: Endpoint pages**

```tsx
// app/(app)/forms/endpoints/page.tsx
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/Panel";
import { FormsTabs } from "@/components/form-relay/FormsTabs";
import { EndpointsTable } from "@/components/form-relay/EndpointsTable";
import { requireForms } from "@/lib/forms/guard";
import { endpointInScope } from "@/lib/forms/access";
import { utcDayStart } from "@/lib/forms/gate";
import type { EndpointListItem, FormEndpointRow } from "@/lib/forms/types";

export default async function EndpointsPage() {
  const auth = await requireForms("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");
  const { admin, scope } = auth;

  const { data } = await admin.from("form_endpoints").select("*").order("created_at", { ascending: false });
  const visible = ((data ?? []) as FormEndpointRow[]).filter((e) => endpointInScope(e, scope));

  const counts = new Map<string, number>();
  const { data: today } = await admin.from("form_submissions").select("endpoint_id").eq("is_spam", false).gte("created_at", utcDayStart());
  for (const r of today ?? []) counts.set(r.endpoint_id as string, (counts.get(r.endpoint_id as string) ?? 0) + 1);
  const endpoints: EndpointListItem[] = visible.map((e) => ({ ...e, today_count: counts.get(e.id) ?? 0 }));

  const leadIds = [...new Set(visible.map((e) => e.lead_id).filter((v): v is string => Boolean(v)))];
  const leadNames: Record<string, string> = {};
  if (leadIds.length) {
    const { data: leads } = await admin.from("leads").select("id, business_name").in("id", leadIds);
    for (const l of leads ?? []) leadNames[l.id as string] = l.business_name as string;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="Forms" description="One endpoint per client website. Each has its own access key and recipients." />
      <FormsTabs />
      <EndpointsTable endpoints={endpoints} leadNames={leadNames} canManage={auth.perms.has("forms.manage")} />
    </div>
  );
}
```

```tsx
// app/(app)/forms/endpoints/new/page.tsx
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/common/Panel";
import { EndpointEditor } from "@/components/form-relay/EndpointEditor";
import { requireForms } from "@/lib/forms/guard";
import { loadEditorOptions } from "@/lib/forms/editorOptions";

export default async function NewEndpointPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const { lead } = await searchParams;
  const auth = await requireForms("manage");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/forms");
  const { leads, mailboxes } = await loadEditorOptions(auth);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="New form endpoint" description="Creates an access key the client site posts to." />
      <EndpointEditor initial={null} leads={leads} mailboxes={mailboxes} presetLeadId={lead ?? null} />
    </div>
  );
}
```

```tsx
// app/(app)/forms/endpoints/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/common/Panel";
import { EndpointEditor } from "@/components/form-relay/EndpointEditor";
import { IntegrationCard } from "@/components/form-relay/IntegrationCard";
import { requireForms } from "@/lib/forms/guard";
import { endpointInScope } from "@/lib/forms/access";
import { relaySubmitUrl } from "@/lib/forms/snippet";
import { loadEditorOptions } from "@/lib/forms/editorOptions";
import type { FormEndpointRow } from "@/lib/forms/types";

export default async function EndpointPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireForms("view");
  if ("error" in auth) redirect(auth.error === 401 ? "/login" : "/dashboard");

  const { data } = await auth.admin.from("form_endpoints").select("*").eq("id", id).maybeSingle();
  if (!data || !endpointInScope(data as FormEndpointRow, auth.scope)) notFound();
  const endpoint = data as FormEndpointRow;
  const canManage = auth.perms.has("forms.manage");
  const { leads, mailboxes } = await loadEditorOptions(auth);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={endpoint.name} description={endpoint.status === "paused" ? "Paused — submissions are rejected." : "Active."} />
      <IntegrationCard endpointId={endpoint.id} url={relaySubmitUrl()} accessKey={endpoint.access_key} canManage={canManage} />
      {canManage ? <EndpointEditor initial={endpoint} leads={leads} mailboxes={mailboxes} /> : null}
    </div>
  );
}
```

- [ ] **Step 6: Verify in the browser and commit**

Run: `npx tsc --noEmit -p tsconfig.json`, then in the dev server: `/forms/endpoints` → New endpoint → fill name + recipient (your own address) → Create. Expected: redirected to the endpoint page; the Integration card shows the URL, a 32-char key and both snippets; Copy works. Set the default sender in Admin › Settings, click Send test. Expected: success toast, the email arrives, and `/forms` lists the test submission with a Sent pill; clicking it opens the drawer and clears the bold/unread state.

```bash
git add lib/forms/editorOptions.ts components/form-relay/IntegrationCard.tsx components/form-relay/EndpointEditor.tsx components/form-relay/EndpointsTable.tsx "app/(app)/forms/endpoints"
git commit -m "feat(forms): endpoints list, editor and integration card with test send"
```

---

### Task 16: Forms panel on the lead page

**Files:**
- Create: `components/form-relay/LeadFormsCard.tsx`
- Modify: `app/(app)/leads/[id]/page.tsx`
- Modify: `components/leads/LeadDetail.tsx`

- [ ] **Step 1: The card**

```tsx
// components/form-relay/LeadFormsCard.tsx
import Link from "next/link";
import { Inbox, Plus, KeyRound } from "lucide-react";
import { Panel, EmptyPanel } from "@/components/common/Panel";
import { btnSecondarySm } from "@/components/common/buttons";
import { formatRelative } from "@/lib/leads/format";
import { previewLine } from "@/lib/forms/email";
import { DeliveryPill } from "@/components/form-relay/DeliveryPill";
import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";

export function LeadFormsCard({ leadId, endpoints, submissions, canManage }: {
  leadId: string;
  endpoints: FormEndpointRow[];
  submissions: FormSubmissionRow[];
  canManage: boolean;
}) {
  return (
    <Panel
      icon={Inbox}
      title="Website forms"
      count={submissions.length}
      action={canManage ? <Link href={`/forms/endpoints/new?lead=${leadId}`} className={btnSecondarySm}><Plus className="h-3.5 w-3.5" /> Endpoint</Link> : null}
      flush
    >
      {endpoints.length === 0 ? (
        <EmptyPanel icon={KeyRound} title="No form endpoint" hint={canManage ? "Create one to receive this site's form submissions." : "Ask an admin to create one."} />
      ) : (
        <>
          <ul className="divide-y divide-border-subtle">
            {endpoints.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <Link href={`/forms/endpoints/${e.id}`} className="truncate font-medium text-text hover:underline">{e.name}</Link>
                <span className="shrink-0 text-xs text-text-muted">{e.status === "paused" ? "paused" : e.to_emails.join(", ")}</span>
              </li>
            ))}
          </ul>
          {submissions.length > 0 ? (
            <ul className="divide-y divide-border-subtle border-t border-border">
              {submissions.map((s) => (
                <li key={s.id} className="px-4 py-2 text-sm">
                  <Link href={`/forms?submission=${s.id}`} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-text">{s.submitter_name ?? s.subject ?? "Submission"}</span>
                      <span className="block truncate text-xs text-text-muted">{previewLine(s.payload, 80)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
                      {formatRelative(s.created_at)} <DeliveryPill status={s.delivery_status} spam={s.is_spam} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-border px-4 py-3 text-xs text-text-muted">No submissions yet.</p>
          )}
        </>
      )}
    </Panel>
  );
}
```

- [ ] **Step 2: Load the data on the lead page**

In `app/(app)/leads/[id]/page.tsx`, add the import `import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";` and, after the `verifiedMailboxes` query:

```ts
  // Form Relay: this lead's endpoints + last 10 submissions (admin client;
  // the lead itself was already RLS-visible to this user).
  const canManageForms = perms.has("forms.manage");
  const canViewForms = canManageForms || perms.has("forms.view");
  let formEndpoints: FormEndpointRow[] = [];
  let formSubmissions: FormSubmissionRow[] = [];
  if (canViewForms) {
    const [{ data: eps }, { data: subs }] = await Promise.all([
      admin.from("form_endpoints").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
      admin.from("form_submissions").select("*").eq("lead_id", id).eq("is_spam", false).order("created_at", { ascending: false }).limit(10),
    ]);
    formEndpoints = (eps ?? []) as FormEndpointRow[];
    formSubmissions = (subs ?? []) as FormSubmissionRow[];
  }
```

and pass to `<LeadDetail>`:

```tsx
      canViewForms={canViewForms}
      canManageForms={canManageForms}
      formEndpoints={formEndpoints}
      formSubmissions={formSubmissions}
```

- [ ] **Step 3: Render the card in LeadDetail**

In `components/leads/LeadDetail.tsx`:
- Add imports: `import { LeadFormsCard } from "@/components/form-relay/LeadFormsCard";` and `import type { FormEndpointRow, FormSubmissionRow } from "@/lib/forms/types";`
- Add to the destructured props and the type: `canViewForms: boolean; canManageForms: boolean; formEndpoints: FormEndpointRow[]; formSubmissions: FormSubmissionRow[];`
- In the `<aside>` `sticky` block, insert directly before `<RecentFollowUps`:

```tsx
            {canViewForms && (
              <LeadFormsCard leadId={lead.id} endpoints={formEndpoints} submissions={formSubmissions} canManage={canManageForms} />
            )}
```

- [ ] **Step 4: Typecheck, run the suite, verify, commit**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run`
Expected: no type errors; all tests pass (search `tests/` for any test rendering `LeadDetail` with explicit props and add the four new props there if the typecheck flags it).

Browser: open a lead → the "Website forms" card shows in the right column; "+ Endpoint" opens the new-endpoint form with the name and business email prefilled.

```bash
git add components/form-relay/LeadFormsCard.tsx "app/(app)/leads/[id]/page.tsx" components/leads/LeadDetail.tsx
git commit -m "feat(forms): website forms card on the lead page"
```

---
### Task 17: Release note

**Files:**
- Modify: `lib/version/changelog.ts` (top of the `CHANGELOG` array)

- [ ] **Step 1: Add the entry**

Insert as the FIRST element of `CHANGELOG` (above the `2.15.0` entry). Use today's date at the time of the commit.

```ts
  {
    version: "2.16.0",
    date: "2026-09-05",
    title: "Form Relay — our own form submission service",
    changes: [
      {
        kind: "feature",
        text: "Client websites now post their contact and booking forms to the LMS instead of web3forms. No more accounts or verification codes per client — create an endpoint, paste the key, done.",
      },
      {
        kind: "feature",
        text: "Every submission is stored and shown in the new Forms section and on the lead's page, emailed to the client from a linked company mailbox, and pinged to the lead's agent.",
      },
      {
        kind: "improvement",
        text: "Spam protection built in: honeypot field, per-IP and per-day limits, and an optional allowed-domains list per endpoint. Failed emails retry automatically and can be resent by hand.",
      },
    ],
  },
```

- [ ] **Step 2: Typecheck, full suite, lint, commit**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run lint`
Expected: clean.

```bash
git add lib/version/changelog.ts
git commit -m "docs(forms): changelog v2.16.0 — Form Relay"
```

---

### Task 18: Rollout and live verification (operator + engineer)

No code. These steps are checked off in order after Task 17 is merged to `main`.

- [ ] **Step 1: Apply migration 0073 to prod** — the operator applies `supabase/migrations/0073_form_relay.sql` via the Supabase MCP `apply_migration`. Confirm with `list_tables` that `form_endpoints` and `form_submissions` exist and that `app_settings.form_default_mailbox_id` is present.

- [ ] **Step 2: Deploy** — push `main`; Hostinger auto-builds. If the restart step hangs after "build complete", restart the app from hPanel (documented in the Site Builder prod-deploy memory). Confirm the build id changed by loading the dashboard.

- [ ] **Step 3: Middleware smoke test (the one thing no unit test covers)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS -H "Origin: https://example.com" https://lms.sedsolutions.online/api/forms/submit
```

Expected: `204`. A `307` means the allowlist edit did not ship.

```bash
curl -s -X POST -H "Content-Type: application/json" -d '{"access_key":"nope"}' https://lms.sedsolutions.online/api/forms/submit
```

Expected: `{"success":false,"message":"Unknown access key"}` with HTTP 404 (not a login redirect, not 503).

- [ ] **Step 4: Sender mailbox** — the operator creates a mailbox on Hostinger (for example `forms@sedsolutions.online`), links it in Admin › Company Mail, verifies it, then selects it in Admin › Settings under "Form Relay default sender".

- [ ] **Step 5: First real endpoint** — create an endpoint for a test lead with the operator's own email as recipient. Click Send test. Expected: the email arrives with the table layout, the Submissions tab shows it as Sent, the bell shows "New form submission".

- [ ] **Step 6: External POST** — from any machine:

```bash
curl -s -X POST -H "Content-Type: application/json" -H "Origin: https://example.com" -d '{"access_key":"<KEY>","name":"Curl Test","email":"you@example.com","message":"hello"}' https://lms.sedsolutions.online/api/forms/submit
```

Expected: `{"success":true,...}`, an email within a few seconds, and a row in the inbox with origin `example.com`.

- [ ] **Step 7: Switch one client site** — replace `https://api.web3forms.com/submit` with the relay URL and the web3forms key with the endpoint key in that site's form JS. Submit from the live site. Confirm delivery. Then roll the rest of the sites, one endpoint each, and delete the web3forms accounts.

- [ ] **Step 8: Set the sweep poller live** — nothing to do on prod (pollers are on); on the Windows dev box `WGE_POLLERS_DISABLED=1` already suppresses it.

---

## Self-review notes (checked while writing)

- **Spec coverage:** data model (T1), contract + CORS + gate order + HTML redirect + 503 (T8), delivery + sender fallback + notification (T7), sweep (T9), permissions/visibility (T6, T10, T11), pages + drawer + integration card + test send (T14, T15), lead panel (T16), settings (T12), nav badge (T13), rollout (T18). Phase 2 (Site Builder) deliberately excluded — separate plan.
- **Deviation from spec:** the spec mentioned recording sends in `email_send_outcomes`. That table is the bounce-detection ground truth for the email-verify scorecard (`recordSendOutcome` takes a `SendOutcome`, not a "sent" event), so writing form deliveries there would pollute the scorecard. Dropped. Also dropped the best-effort `appendToSent` to the sender's IMAP Sent folder: it would cost an IMAP round-trip per submission for no operator value. Both are one-line additions in `deliver.ts` if wanted later.
- **Type consistency:** `FormScope` shape `{all, manage}` / `{all:false, leadIds, manage}` is used identically in `access.ts`, `guard.ts`, the nav-counts route and the pages. `EndpointListItem` and `SubmissionListItem` live in `lib/forms/types.ts` and are imported by both the routes and the components. `loadVisibleEndpoint` / `loadVisibleSubmission` (`lib/forms/load.ts`) are shared by the `[id]`, `test` and `resend` routes; `loadEditorOptions` (`lib/forms/editorOptions.ts`) by both editor pages.
- **Next.js constraint honoured:** `route.ts` and `page.tsx` files export only HTTP handlers / the page component (plus `runtime`/`maxDuration`). Extra value exports from those files fail the Next build, so every shared helper sits under `lib/forms/`.

## After this plan

Phase 2 plan (to be written once this is live): auto-create an endpoint when a Site Builder run starts for a lead, add the submit URL + key to `lib/site-builder/prompt.ts`, and deterministically rewrite `api.web3forms.com/submit` and `access_key` values in the generated files before deploy.
