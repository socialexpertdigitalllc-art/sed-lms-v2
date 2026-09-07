# Form Relay — self-hosted form submission service

**Date:** 2026-09-05
**Status:** Approved design (brainstormed with the operator; every open choice below was decided by them).
**Replaces:** web3forms on every client website built by the operator.

## Problem

Every client website ships with contact/booking forms. Today each form posts to web3forms,
which means a new web3forms account per client, created with the client's email, a
verification code the client has to forward, and the free-plan limits on top. The
operator wants a form submission service they own, with no per-client verification step,
hosted on the same Hostinger Node.js plan as this dashboard, and surfaced inside the
dashboard.

## Decisions made with the operator

| Question | Decision |
|---|---|
| Where does it live | A module inside this dashboard (one codebase, one deploy). Not a separate Node service, not a Supabase Edge Function (Deno cannot hold SMTP; would force a third-party email API back in). |
| Request contract | Web3forms-compatible drop-in. Existing template JS only changes the URL and the key. |
| Sender mailbox | Per-endpoint choice with a system-wide fallback mailbox picked in Admin > Settings. |
| Storage | Every submission is stored and shown per lead and in a Forms inbox, with spam flag and delivery status. |
| Spam protection at launch | Honeypot + per-IP and per-endpoint rate limits + optional allowed-origins list. No captcha. |

## Architecture

```
client site form ──POST──▶ /api/forms/submit (public, CORS, allowlisted in middleware)
                                 │  parse → gate (active/origin/honeypot/rate) → insert row → respond
                                 └─ after(): deliverSubmission(id)
                                              │ resolve sender (endpoint.mailbox_id → app_settings.form_default_mailbox_id)
                                              │ nodemailer over the linked Hostinger SMTP (lib/mail)
                                              │ mark sent/failed; notify("form_submission_received")
instrumentation poller (2 min) ──▶ /api/forms/deliver (x-wge-secret) retries pending/failed rows
dashboard: /forms (inbox + endpoints), /forms/endpoints/[id], Forms panel on the lead page
```

Units and their single purpose:

- `lib/forms/schema.ts` — zod for endpoint create/update and the dashboard list filters.
- `lib/forms/types.ts` — row types for `form_endpoints`, `form_submissions`.
- `lib/forms/parse.ts` — pure: turn a Request body (JSON or FormData) into `{reserved, payload}`; enforce size/field caps.
- `lib/forms/gate.ts` — pure decisions: origin match, honeypot, per-IP gate (uses `lib/cache/ttl.ts`), daily-limit verdict from a count.
- `lib/forms/email.ts` — pure: build `{subject, text, html, replyTo}` from a submission + endpoint.
- `lib/forms/deliver.ts` — resolve sender, send via `buildSmtpConfig` + nodemailer, update the row, raise the notification. Used by the submit route's `after()` and by the sweep route.
- `lib/forms/access.ts` — which endpoints/submissions a user may see (mirrors the leads visibility rule).
- `lib/forms/snippet.ts` — pure: HTML-form and fetch-JS integration snippets for an endpoint.

## Data model — `supabase/migrations/0075_form_relay.sql`

Additive only. RLS enabled, **no policies**: all access is via `createAdminClient()` behind
an explicit permission check (same posture as `studio_*` / `builder_*`).

### `form_endpoints`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| lead_id | uuid null → leads(id) on delete set null | null = endpoint not tied to a lead |
| name | text not null | e.g. "Northpoint Roofing – contact" |
| access_key | text not null unique | 32 chars, `crypto.randomBytes(24).toString('base64url')`; shown in the UI (it is public in the HTML anyway) |
| to_emails | text[] not null | at least one; validated addresses |
| subject_template | text not null default '' | `{site}` / `{name}` placeholders; empty = built-in default |
| mailbox_id | uuid null → company_mailboxes(id) on delete set null | sender override |
| allowed_origins | text[] not null default '{}' | hostnames, no scheme, `*.` prefix allowed; empty = any origin |
| daily_limit | int not null default 200 | |
| success_redirect_url | text null | used when the POST has no `redirect` field and is a plain HTML form post |
| status | text not null check in ('active','paused') default 'active' | |
| created_by | uuid null → profiles(id) on delete set null | |
| created_at / updated_at | timestamptz | |

Indexes: `form_endpoints_lead_idx (lead_id)`, unique on `access_key`.

### `form_submissions`

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| endpoint_id | uuid not null → form_endpoints(id) on delete cascade | |
| lead_id | uuid null → leads(id) on delete set null | copied from the endpoint at insert |
| payload | jsonb not null | ordered `[{key, value}]` array so field order survives |
| subject | text not null default '' | resolved subject actually used |
| submitter_name | text null | from `name`, `full_name`, `first_name`+`last_name`, `from_name` |
| submitter_email | text null | from `email`, `replyto`, `reply_to`, `e-mail`; must parse as an address |
| ip | text null | first hop of `x-forwarded-for`, else `x-real-ip` |
| user_agent | text null | |
| origin | text null | `Origin` header, else `Referer` host |
| referer | text null | |
| is_spam | boolean not null default false | |
| spam_reason | text null | 'honeypot', 'origin', 'rate_ip', 'rate_daily', 'manual' |
| delivery_status | text not null check in ('pending','sent','failed','skipped') default 'pending' | spam rows are `skipped` |
| delivery_attempts | int not null default 0 | |
| last_error | text null | |
| delivered_at | timestamptz null | |
| mailbox_id | uuid null → company_mailboxes(id) on delete set null | sender actually used |
| read_at | timestamptz null | inbox unread state |
| created_at | timestamptz not null default now() | |

Indexes: `form_submissions_endpoint_idx (endpoint_id, created_at desc)`,
`form_submissions_lead_idx (lead_id, created_at desc)`,
`form_submissions_pending_idx (created_at) where delivery_status in ('pending','failed')`,
`form_submissions_unread_idx (lead_id) where read_at is null and is_spam = false` (nav badge;
the daily-limit count reuses `form_submissions_endpoint_idx`).

### Other

- `app_settings` gains `form_default_mailbox_id uuid null references company_mailboxes(id) on delete set null`.
- `permissions` seeded with `forms.view` ("View Form Submissions", category `forms`) and
  `forms.manage` ("Manage Form Endpoints", category `forms`). `PERMISSION_CATEGORIES` gains `forms`.
- `notification_rules` seeded with `form_submission_received` (target: the lead's agent; falls
  back to nobody when the endpoint has no lead).

Controller applies 0075 via the Supabase MCP after review, **before** the code deploy
(the submit route reads the new tables on its first request).

## Public ingest — `POST /api/forms/submit`

### Contract (web3forms-compatible)

- Accepts `application/json`, `multipart/form-data`, `application/x-www-form-urlencoded`.
- Reserved fields: `access_key` (required), `subject`, `from_name`, `redirect`, `botcheck`,
  `replyto`, `ccemail`. Every other field is payload, kept in submission order.
- File uploads are ignored (web3forms free plan has none either); the field is dropped.
- Caps: body 64 KB, 50 fields, each value 10 000 chars. Over cap → `400 {"success":false,"message":"Payload too large"}`.
- Success reply: `200 {"success":true,"message":"Form submitted successfully","data":{...payload}}` — the shape existing templates already branch on.
- Failure replies use the same `{success:false, message}` envelope: 400 bad key/body, 403 origin not allowed, 404 unknown key, 410 paused, 429 rate limited.
- Plain HTML (non-fetch) posts, detected by an `Accept` header that prefers `text/html`: on success respond 303 to `redirect` → `endpoint.success_redirect_url` → a minimal built-in thank-you page. `redirect` must be an absolute http(s) URL, else it is ignored.

### CORS

- `OPTIONS` handler returns 204 with `Access-Control-Allow-Origin` (echo of the request Origin, or `*`), `Allow-Methods: POST, OPTIONS`, `Allow-Headers: Content-Type, Accept`, `Max-Age: 86400`.
- Every `POST` response carries the same allow-origin header. Origin *enforcement* happens in the gate, not in CORS (CORS only governs whether the browser lets the page read the reply).
- `lib/supabase/middleware.ts` allowlists `path === "/api/forms/submit"` (all methods) — the same lesson as the site-builder processor: an unlisted route 307s to `/login` and no route test can catch it.

### Gate order

1. Endpoint by `access_key`. Missing → 404. `paused` → 410.
2. Origin: when `allowed_origins` is non-empty, the request's origin hostname must match one entry exactly or via a `*.` wildcard. Mismatch → stored as spam (`origin`), reply 403.
3. Honeypot: a non-empty `botcheck` → stored as spam (`honeypot`), reply **200 success** (bots learn nothing).
4. Per-IP: `ttlGateOpen`-style bucket, 10 per minute per IP per process. Over → stored as spam (`rate_ip`), reply 429. Per-process is acceptable: prod is one pm2 process.
5. Daily: `count(*)` of non-spam rows for the endpoint since UTC midnight ≥ `daily_limit` → stored as spam (`rate_daily`), reply 429. This one is durable across restarts.

Spam rows are inserted with `delivery_status = 'skipped'` and never emailed; they are
visible in the inbox under the Spam filter so a false positive can be flipped to Not spam
(which re-queues delivery).

### Response then delivery

Insert the row, send the response, then `after(() => deliverSubmission(id))` from
`next/server`. Visitors never wait on SMTP. A crash between insert and `after` leaves a
`pending` row for the sweep.

## Delivery — `lib/forms/deliver.ts`

1. Load submission + endpoint. Skip if `is_spam` or already `sent`.
2. Sender: `endpoint.mailbox_id` → `app_settings.form_default_mailbox_id` → none. With none,
   mark `failed`, `last_error = 'No sender mailbox configured'`, and stop (the UI shows this
   as a red state with a link to Settings).
3. Build the message via `lib/forms/email.ts`:
   - Subject: request `subject` → endpoint `subject_template` (with `{site}` = endpoint name,
     `{name}` = submitter name) → `New form submission from {site}`.
   - HTML: heading with the endpoint name, a two-column table of the payload, a footer with
     site origin, time (Asia/Karachi and UTC), and "Sent by SED LMS Form Relay". Plain-text
     twin with `key: value` lines.
   - `From: "{from_name or endpoint name} via SED LMS" <mailbox address>`, `To: to_emails`,
     `Cc: ccemail` when present and valid, `Reply-To: submitter_email` when found.
4. `nodemailer.createTransport(buildSmtpConfig(mailbox)).sendMail(...)`; best-effort
   `appendToSent` as the mail routes do.
5. On success: `sent`, `delivered_at`, `mailbox_id`. On error: `failed`, `attempts += 1`,
   `last_error`. Also `recordSendOutcome` so the existing email-outcomes log sees it.
6. `notify("form_submission_received", {leadId}, {title: "New form submission — {site}",
   body: first 140 chars of the message/most descriptive field, targetUrl: "/forms?submission={id}",
   dedupKey: submission id})`.

### Sweep — `POST /api/forms/deliver`

`x-wge-secret` auth (fail closed exactly like `/api/site-builder/process`), allowlisted in
middleware, added to `instrumentation.ts` at a 2-minute cadence (respects
`WGE_POLLERS_DISABLED`). Picks up to 20 rows where `delivery_status in ('pending','failed')`
and `delivery_attempts < 5`, oldest first, and runs `deliverSubmission` on each. One indexed
query per tick when idle — negligible IO.

## Dashboard

### Permissions & visibility (`lib/forms/access.ts`)

- `forms.view`: see the Forms nav, the inbox, endpoints, and the lead-page panel — but only
  for leads the user can already see (`leads.view` scope; `leads.view_all` widens to every lead).
  Endpoints with no lead are visible only with `forms.manage`.
- `forms.manage`: create/edit/pause/delete endpoints, resend, mark spam/not spam, delete submissions, send test.
- `admin.settings.manage`: choose the default sender mailbox in Admin > Settings.

### Routes

- `GET/POST /api/forms/endpoints`, `GET/PATCH/DELETE /api/forms/endpoints/[id]`,
  `POST /api/forms/endpoints/[id]/test` (posts a sample submission through the real pipeline, tagged `payload._test = true` and shown with a Test badge).
- `GET /api/forms/submissions?endpoint=&lead=&spam=&status=&q=&cursor=`,
  `PATCH /api/forms/submissions/[id]` (`{read: true}` | `{spam: bool}`), `POST /api/forms/submissions/[id]/resend`, `DELETE`.
- `PATCH /api/admin/settings` (existing route) accepts `form_default_mailbox_id`.
- `lib/nav/counts.ts` adds the unread (`read_at is null`, non-spam, visible) count for the nav badge.

### Pages

- `/forms` — two tabs. **Submissions**: table (time, site/endpoint, lead, submitter, subject/preview, delivery pill, spam pill), filters for endpoint, lead, spam, delivery status, free-text search over subject/submitter; row click opens the detail drawer. **Endpoints**: table (name, lead, recipients, sender, today's count, status) + New Endpoint.
- `/forms/endpoints/new` and `/forms/endpoints/[id]` — settings form (name, lead picker, recipients chips, subject template, sender mailbox select with "(default)" option, allowed origins chips, daily limit, redirect URL, paused toggle) and an **Integration** card: the endpoint URL, the access key with copy, and two copyable snippets from `lib/forms/snippet.ts` (plain HTML form; fetch-JS in the shape the templates already use, with the `botcheck` hidden field). A **Send test** button.
- Submission drawer — key/value table in submitted order, submitter email as `mailto:`, meta (IP, origin, referer, user agent, time), delivery timeline (status, attempts, sender used, last error), buttons Resend / Mark spam / Not spam / Delete. Opening marks it read.
- Lead page — a **Forms** panel under the existing sections: this lead's endpoints (with quick copy of the key) and last 10 submissions, plus **Create endpoint** prefilled with `business_name` and `business_email`.
- Admin > Settings — "Form relay default sender" select over verified mailboxes.
- Sidebar: `{ href: "/forms", label: "Forms", icon: Inbox, perm: "forms.view" }` in `MAIN`, badge from the unread count.

All inputs follow the operator rules already in force: `components/common/DateTimeField`
for any date filter (no native date inputs), hand-rolled `components/common` widgets, no shadcn.

## Site Builder integration (phase 2, separate plan)

- When a Site Builder run starts for a lead that has no active endpoint, create one:
  name = business name, `to_emails = [business_email]`, `lead_id` = the lead. Runs for
  leads without a business email still create the endpoint, with `to_emails = '{}'` and
  `status = 'paused'` (the DB column allows an empty array; only the dashboard form requires
  at least one recipient), and the run's summary flags it so the agent fills the address in.
- `lib/site-builder/prompt.ts`: the components-file prompt and the page rule about forms gain
  one line giving the exact submit URL and `access_key` to use, replacing whatever the
  template had.
- Safety net in the deploy path: deterministic replacement of `https://api.web3forms.com/submit`
  with the relay URL and of any `access_key` value (JSON `"access_key": "..."`, hidden
  input `name="access_key" value="..."`, `formData.append("access_key", "...")`) with the
  endpoint's key, across every text file in the site. The AI cannot leave a stale key behind.

## Error handling summary

| Situation | Behaviour |
|---|---|
| Unknown / paused key | 404 / 410 JSON; nothing stored |
| Origin mismatch, honeypot, rate limits | Stored as spam (`skipped`), reply per gate order |
| SMTP failure | Row `failed`, retried by the sweep up to 5 attempts, then stays visible as failed with Resend |
| No sender mailbox anywhere | Row `failed` with a clear error; Settings link in the UI |
| Migration not yet applied | Submit route returns 503 `{success:false, message:"Form relay not ready"}` — never a 307 |
| Dashboard down / restarting | Client sites get a network error; the recommended snippet retries once after 3 s |

## Testing

- Unit (vitest, `tests/forms*.test.ts`): `parse.ts` (JSON, FormData, urlencoded, caps, reserved-field extraction, submitter name/email detection), `gate.ts` (origin exact + wildcard, honeypot, per-IP bucket, daily verdict), `email.ts` (subject resolution, HTML escaping, Reply-To), `snippet.ts`, `access.ts`.
- Route tests importing the handlers: submit happy path (JSON + FormData), OPTIONS preflight headers, honeypot fake-success, paused → 410, origin → 403 + spam row, rate → 429, HTML post → 303; deliver sweep picks only eligible rows; endpoints CRUD permission checks; settings accepts the mailbox id.
- Delivery uses a `sendMail` seam so tests never touch SMTP.
- Live verification after deploy (curl against production) is a checklist item in the plan, because the middleware allowlist cannot be unit-tested.

## Rollout

1. Apply `0075_form_relay.sql` via MCP.
2. Deploy code (push to `main`; Hostinger auto-build; restart from hPanel if the restart hangs, as documented).
3. Operator creates the forms mailbox on Hostinger (e.g. `forms@sedsolutions.online`), links it in Admin > Mail, verifies it, and selects it in Admin > Settings.
4. Create one endpoint for a test lead; `curl -X POST` from outside; confirm the row, the email, and the bell.
5. Switch one client site (URL + key), watch a real submission, then roll the rest and the Site Builder phase 2.

## Out of scope (YAGNI)

Captcha providers, file attachments, autoresponders to the submitter, webhooks to third
parties, per-endpoint HTML email templates, and a public status page. Each can be added
later without changing the tables above.
