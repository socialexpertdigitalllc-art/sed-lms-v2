# SED LMS v2 — Payment Links Management System (v1)

**Date:** 2026-07-10
**Branch:** `payment-links` (off `main` @ `3b7e307`)
**Status:** Design approved — ready for planning

A managed catalog of the accounts department's Stripe payment links ($200, $250, …) so finding/copying the right link is instant. **v1 is deliberately a pure link library** (user-confirmed): no send tracking, no notifications, no dashboard KPIs — but the schema is provider-ready so Stripe API sync, webhook auto-confirmation, and a future `payment_requests` tracking table bolt on without rework. Builds on the RBAC system and the role-aware-page pattern ([[ticketing-v2-feedback]]'s /feedback).

## Decisions (locked in brainstorming)
- Managed catalog with **Stripe-ready schema**; accounts paste existing Stripe URLs (no API keys this phase).
- **Pure library** — no per-lead coupling, no send log, no mark-paid, no notifications, no KPI tiles (all explicitly deferred by user).
- Link fields: label + amount + **category (Website / Yearly / Add-on / Other)** + notes; currency stored (`USD`) for future multi-currency.
- **Create an Accounts department** via migration; admin manages membership + can grant the permissions to anyone.
- Manual everything; reads gated by permission (money data is not all-authenticated).

## Migration `0022_payment_links.sql`
- **`payment_links`**: `id uuid pk`, `label text not null`, `amount numeric(10,2) not null check (amount > 0)`, `currency text not null default 'USD'`, `category text not null default 'Website' check (category in ('Website','Yearly','Add-on','Other'))`, `url text not null`, `notes text`, `provider text not null default 'stripe'`, `external_id text` *(future API sync — unused v1)*, `is_active boolean not null default true`, `sort int not null default 0`, `created_by uuid → profiles on delete set null`, `created_at`, `updated_at`.
  - Index `(category, sort, created_at)`. RLS enabled: **select policy `public.has_permission('payments.view')`** (to authenticated); no write policies — service-role via guarded routes only.
- **Accounts department**: `insert into departments (name, slug, description, color, icon) values ('Accounts','accounts','Payments & billing','#CA8A04','wallet') on conflict (slug) do nothing;`
- **Permissions** (new category `payments`): `payments.view` ('View Payment Links', not sensitive), `payments.manage` ('Manage Payment Links', **sensitive**). Granted to dept slugs `accounts` + `admin` (both perms each).
- Mirror in `seed.sql` (dept row + 2 permission rows + grant tuples) and `lib/permissions/constants.ts` (+ `"payments"` in `PERMISSION_CATEGORIES`).

## Library code
- `lib/payments/types.ts`: `PAYMENT_CATEGORIES = ["Website","Yearly","Add-on","Other"] as const`, `PaymentCategory`, `PaymentLink` interface (all columns).
- `lib/payments/schema.ts` (Zod, TDD): `paymentLinkSchema` = `{ label: trim 1..120, amount: number positive ≤ 999999.99, category: enum, url: https URL (z.string().url() + must start with https://), notes: trim ≤1000 nullable optional }`; `paymentLinkPatchSchema` = all fields optional + `is_active: boolean optional` + `sort: int optional`.
- `lib/payments/board.ts` (pure, TDD): `groupLinks(links, { query, category, includeArchived })` → filters (label substring case-insensitive OR amount string match, category, active-only unless included) then groups into ordered category buckets (fixed category order, `sort` then `created_at` within).

## API (all activity-logged; guard pattern = auth 401 → `getUserPermissions` → 403)
- `GET /api/payments/links` — gate `payments.view`. Returns all links **ordered category/sort/created_at**; viewers get `is_active=true` only, callers with `payments.manage` get everything (server decides — no query-param trust).
- `POST /api/payments/links` — gate `payments.manage`; `paymentLinkSchema`; insert with `created_by`; `activity_log payment_link.created`.
- `PATCH /api/payments/links/[id]` — gate `payments.manage`; `paymentLinkPatchSchema`; updates incl. `is_active` (archive/restore) + `updated_at`; `activity_log payment_link.updated`.
- `DELETE /api/payments/links/[id]` — gate `payments.manage`; hard delete; `activity_log payment_link.deleted`.

## UI — role-aware `/payments`
- `app/(app)/payments/page.tsx` (server): auth → `payments.view` else redirect `/dashboard`; load links via admin client (viewer filtering by `canManage`); pass `{ links, canManage }`.
- `components/payments/PaymentLinksBoard.tsx` (client): header ("Payment Links", count), **search input** (label/amount), **category filter pills** (All + 4), sections per category. Each link row/card: label, prominent `$amount` (formatted), notes as muted subtext, **Copy button** (`navigator.clipboard.writeText(url)` + 1.5s "Copied ✓" state — the primary action), open-in-new-tab icon link. Managers additionally: **"Add link"** button → modal (label, amount, category RadioPillGroup, URL, notes; client-validated), per-row **Edit** (same modal prefilled), **Archive/Restore** toggle, **Delete** (confirm). Managers get an "Show archived" toggle revealing archived rows (muted + Restore). Empty states per section/overall. `router.refresh()` after mutations; design tokens as everywhere (`bg-surface`, `border-border`, `inputCls`, pill styles).
- Sidebar `MAIN`: `{ href: "/payments", label: "Payments", perm: "payments.view" }`.

## Testing
- **Unit (Vitest):** `paymentLinkSchema` (valid, non-https URL rejected, zero/negative amount rejected, long label rejected), `groupLinks` (search by label + by amount digits, category filter, archived exclusion/inclusion, bucket order).
- **Live (Chrome MCP):** as admin — create a $250 Website link (modal), Copy button puts URL on clipboard + shows feedback, edit label, archive → disappears from default view → visible under Show-archived → restore, delete; sidebar entry visible; `/payments` blocked (redirect) for a user without `payments.view` (verified via a temporary deny override, then removed).

## Out of scope / deferred (schema-ready)
Send/payment tracking (`payment_requests` + mark-paid), Stripe API create/sync (`provider`/`external_id` reserved), webhooks, `payment_received` notification event, dashboard KPI tiles, multi-currency (column exists), lead attachment, copy-usage analytics.
