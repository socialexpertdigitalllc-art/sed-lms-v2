# WGE-2 — Automation (Queue + Auto-Generate on Lead Submit) — Design

**Date:** 2026-06-22
**Status:** Approved (brainstorm) — ready for implementation plan
**Builds on:** WGE-1 (control layer). WGE-1 already stores the relevant settings (`auto_generate`, `auto_engine`, `ready_required`) on the `wge_config` singleton; they are currently inert. WGE-2 makes them live.

---

## 1. Goal

When a lead is submitted (and auto-generation is enabled), automatically generate its website headlessly — with **only one generation running at a time** and new submissions queued behind the current one. Plus a manual "Queue for generation" action, a queue-management UI, and a notification when a generation finishes.

## 2. Decisions (from brainstorm)

- **Execution model:** an **in-app processor** drains the queue serially, reusing the existing TS prompt/parse/provider/storage logic. Runs while the Next app is running (already required for the app to function). Chosen over Supabase pg_cron + Edge Function (which would duplicate the generation logic in Deno).
- **Trigger:** auto-enqueue on lead **create** when the lead meets the ready threshold, **plus** a manual "Queue for generation" button on the lead detail page. One auto-generation per lead (no duplicates).
- **Failure handling:** mark `failed` with the error message; an admin manually retries. No auto-retry (avoids burning API credits on persistent failures like the suspended Moonshot account).
- **Notifications:** the existing (derived, stateless) notification bell additionally surfaces the user's own recent finished generations — no new `notifications` table.

## 3. Architecture

```
POST /api/leads (create) ──► enqueueLeadIfReady() ──► insert wge_queue(pending) ──► kick /process (fire-and-forget)
Lead detail "Queue for generation" ──► POST /api/ai-tools/wge/queue ──► insert wge_queue(pending) ──► kick /process
instrumentation.ts interval (~2 min) ──────────────────────────────────────────► POST /process (safety net)

POST /api/ai-tools/wge/process ──► processQueue():
    pg_try_advisory_lock(K)  (not acquired → exit; guarantees serial)
    reclaim stale 'processing' (>10 min) → 'pending'
    loop: claim oldest pending (FOR UPDATE SKIP LOCKED) → 'processing'
          runGenerationForLead(lead_id) → persistGeneration() → 'done'(+generation_id)
          on throw → 'failed'(+error)
    until no pending; release lock
```

## 4. Data Model — `wge_queue` (migration 0008)

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `lead_id` | uuid → leads | the lead to generate for |
| `tool` | text | engine provider (`webcraft`/`deepseek`), from `auto_engine` |
| `model` | text | from `auto_engine` |
| `status` | text | `pending` \| `processing` \| `done` \| `failed` (default `pending`) |
| `attempts` | int | default 0; incremented on each processing claim |
| `generation_id` | uuid → ai_generations | set when `done` (nullable) |
| `error` | text | failure message (nullable) |
| `enqueued_by` | uuid → profiles | who triggered it (lead creator / button clicker); nullable |
| `created_at` | timestamptz | default now() |
| `started_at` | timestamptz | set when claimed |
| `finished_at` | timestamptz | set when done/failed |

- **Partial unique index:** `unique(lead_id) where status in ('pending','processing')` — prevents double-queueing an active lead. (Re-queue allowed after done/failed.)
- Indexes: `(status, created_at)`.
- **RLS:** `select` allowed when `enqueued_by = auth.uid()` **OR** `public.has_permission('wge.manage')` (so the bell can show a user their own items; admins see all). Writes via the service role only (processor/enqueue use admin client).
- FK on-delete: `lead_id` → `on delete cascade` (queue rows die with the lead); `generation_id` → `on delete set null`.

## 5. Shared Generation Lib (refactor + new) — `lib/ai-tools/run.ts`

- **Extract** the save route's persist logic into `persistGeneration(opts): Promise<{ id: string }>` — parses already-provided files, uploads each to the private `ai-generations` bucket, inserts the `ai_generations` row (cost/complexity/word/image computed as today), writes `file_path`. The existing `POST /api/ai-tools/[tool]/save` route is refactored to call this (no behavior change).
- `callProvider(toolId, model, systemPrompt, userPrompt, { maxTokens, temperature }): Promise<string>` — server-side, **non-streamed** (`stream: false`) OpenAI-compatible call; reads the key from `process.env[cfg.envKey]`; throws on non-OK with the provider's message.
- `runGenerationForLead(leadId, { tool, model }): Promise<{ generationId: string }>` — loads the lead + `getWgeConfig()`, maps via `mapLeadToInput(lead, config.variables)` → `buildPrompt(values, config.prompt_template)`, calls `callProvider` with `config.system_prompt`, `parseFiles`, then `persistGeneration({ tool, agentId: lead.agent_id ?? enqueuedBy, leadId, businessName, model, files, tokens, status })`. Throws if the model returns no usable HTML.

## 6. Readiness + Enqueue — `lib/ai-tools/queue.ts`

- `isLeadReady(values: Record<string,string>, readyRequired: string[]): boolean` — true when every key in `ready_required` has a non-empty mapped value. Pure, unit-tested.
- `enqueueLeadIfReady(lead, userId)` (server): load `getWgeConfig()`; proceed only if `settings.auto_generate` && `settings.auto_engine` && `isLeadReady(mapLeadToInput(lead, variables), settings.ready_required)` && no active queue row for the lead && the lead has no existing `ai_generations` row. Insert a `pending` row (tool/model from `auto_engine`, `enqueued_by=userId`) and fire-and-forget kick to `/process`. Swallows its own errors (never blocks lead creation).
- `enqueueManual(leadId, userId)` (server): used by the manual button; requires `auto_engine` set (else throws a clear error); inserts a `pending` row if none active; kicks `/process`. Allowed even if the lead was generated before (re-generate), as long as no active row.
- `kickProcessor()`: `fetch(<origin>/api/ai-tools/wge/process, { method: POST, headers: { 'x-wge-secret': env } })` without awaiting (fire-and-forget; errors ignored).

## 7. Processor — `POST /api/ai-tools/wge/process` + `processQueue()`

- Auth: requires header `x-wge-secret` === `process.env.WGE_PROCESSOR_SECRET` (403 otherwise). Internal-only; never user-facing.
- `processQueue()` (uses the admin/service-role client):
  1. `select pg_try_advisory_lock(<constant key>)`. If `false`, another run is active → return `{ skipped: true }`.
  2. Reclaim: `update wge_queue set status='pending' where status='processing' and started_at < now() - interval '10 minutes'`.
  3. Loop: claim oldest pending —
     `update wge_queue set status='processing', started_at=now(), attempts=attempts+1 where id = (select id from wge_queue where status='pending' order by created_at limit 1 for update skip locked) returning *`.
     If no row → break.
     `try { const { generationId } = await runGenerationForLead(row.lead_id, { tool: row.tool, model: row.model }); update → status='done', generation_id, finished_at=now() }`
     `catch (e) { update → status='failed', error=e.message (truncated), finished_at=now() }`.
  4. `select pg_advisory_unlock(<key>)` in a `finally`.
  - `export const runtime = "nodejs"; export const maxDuration = 800;` (a queue of N generations runs N×~40s serially; self-hosted Node has no hard cap, the value is a ceiling).
- The advisory-lock key is a fixed bigint constant defined in code.

## 8. Trigger Wiring

- `POST /api/leads`: after the successful insert + activity log, call `await enqueueLeadIfReady({ ...parsed.data, id: data.id }, user.id)` (wrapped so a failure never fails the lead create).
- Manual button: `POST /api/ai-tools/wge/queue { leadId }` — auth + `ai_tools.webcraft|deepseek` perm; calls `enqueueManual`; returns `{ queued: true }` or a 400 with the reason (e.g., "Set an auto engine in WGE settings first", "Already queued").

## 9. Poller — `instrumentation.ts`

`register()` (nodejs runtime only) starts a `setInterval` (~120 s) that calls `kickProcessor()`. Drains items missed by kicks (e.g., enqueue kick lost to a restart). The advisory lock makes concurrent runs a no-op. Guard against double-registration in dev HMR with a module-level flag.

## 10. Queue UI — new "Queue" tab in WGE Control

- New tab in `components/ai-tools/wge/WgeControl.tsx` (gated by `wge.manage`, like the rest of the panel). Fetches `GET /api/ai-tools/wge/queue` (admin: all rows; returns recent ~50 with lead business_name + generation link). Columns: business, engine (tool+model), status pill, attempts, error (on hover/expand), generation link (→ `/ai-tools/generations/[id]`), enqueued/finished times. Actions: **Retry** (failed → re-queue: set `pending`, clear error, kick) via `POST /api/ai-tools/wge/queue/[id]/retry`; **Cancel** (pending → delete row) via `DELETE /api/ai-tools/wge/queue/[id]`. A "Refresh" button (no realtime needed).
- Lead detail page: a **"Queue for generation"** button (visible with `ai_tools.*`) + a small inline status if the lead has a queue row ("Queued" / "Generating…" / "Generated ✓ → view" / "Failed").

## 11. Notification Bell Integration

- Extend the queue read API so a user can fetch **their own** recent finished rows: `GET /api/ai-tools/wge/queue?mine=1&since=24h` returns the caller's `done`/`failed` rows from the last 24h (RLS already scopes to `enqueued_by = auth.uid()`), each with `business_name`, `status`, `generation_id`, `finished_at`.
- `NotificationBell.tsx` fetches this alongside the existing pre-lead follow-ups and merges them into the dropdown: "Website ready — {business}" (links to the generation) and "Generation failed — {business}" (links to the WGE queue). The badge count includes them. Consistent with the bell's existing derived/stateless model (no read-state persistence; naturally ages out after 24h).

## 12. Config / Env

- Add `WGE_PROCESSOR_SECRET` to `.env.local` (gitignored) and `.env.example` (key only). Generate a random value.

## 13. Error Handling

- `auto_engine` unset → auto-enqueue silently skipped; manual button returns a clear 400.
- Provider failure (e.g., suspended Moonshot) → row `failed` + stored message; visible in queue UI; manual Retry.
- DeepSeek 8192 truncation → if ≥1 file parsed, `done` (partial site); if 0 files, `failed` ("model returned no usable HTML").
- Server crash mid-run → stale `processing` rows (>10 min) reclaimed to `pending` on the next processor run.
- Enqueue must never break lead creation — wrapped in try/catch, errors logged only.

## 14. Testing

- **Unit:** `isLeadReady` (all present / one missing / extra keys); enqueue dedup + skip rules (auto_generate off, auto_engine null, already-active, already-generated); stale-reclaim cutoff boundary; the queue-claim SQL shape (review, not unit). Build green + existing 69 tests stay green.
- **Live (Chrome + DeepSeek, which works):** in WGE settings set `auto_engine = DeepSeek/deepseek-chat`, `auto_generate` ON, `ready_required = [name, services, pages]`. Create a lead meeting those → confirm a `wge_queue` row appears, processes, and a generation lands in history + the queue tab shows `done`; the bell shows "Website ready". Then: a not-ready lead is NOT queued; the manual "Queue for generation" button works; a forced failure (temporarily point engine at suspended WebCraft) shows `failed` + Retry.

## 15. Out of Scope (YAGNI)

- A generic persisted `notifications` table (bell stays derived).
- Enqueue when an existing lead is edited into "ready" (create + manual only).
- Per-lead engine override (uses the global `auto_engine`).
- Parallel/concurrent generation (explicitly serial by requirement).
- Pre-lead → lead conversion triggering generation.
