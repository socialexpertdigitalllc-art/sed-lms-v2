# Ticket Agent v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Contract-style tasks (v1's Tasks 8–12 calibre): behaviors pinned, code left to the
> implementer against the named house patterns. TDD throughout. One task in flight at a time.

**Goal:** the six operator-requested improvements — run scope (whole ticket / selected items), live model choice, ticket status automation, prompt editing, ticketless direct edits, real content streaming.

**Spec:** docs/superpowers/specs/2026-09-02-ticket-agent-v2-design.md (spike results included).
**Baseline:** v1 shipped at 88793ce; all v1 house rules stand (narrow selects, claim guards, staging-precedence, targeted eslint only, stop→build→start on the box).

### Task 1 — Migration 0072 + types
`supabase/migrations/0072_site_agent_v2.sql`: `site_agent_runs` += `item_ids jsonb`,
`task_text text`, `model text`; `app_settings` += `agent_worker_models jsonb`;
partial unique index `site_agent_runs_one_active_per_lead` on (lead_id) where status in
active-set AND ticket_id is null. `lib/site-agent/types.ts`: `AgentRunRow` gains the three
fields; `TAIL_MAX_CHARS` → 6000; add `MODELS_REFRESH_MS = 10 * 60_000`. Tests: types test
updated (tail cap), migration lint-by-eye. Controller applies 0072 via MCP after review.

### Task 2 — agy driver: rich events, models, --model
`lib/site-agent/agy.ts`: step events parse `tool_name`, `tool_info.parameters` (string
values only, truncated ~80ch), `text_delta`, keep 1.1.22 tolerance. `summarizeEventForTail`:
agent text verbatim; tools `▸ name (params)` on ACTIVE, DONE emits only when no ACTIVE seen
for that step_index (track in a small closure/registry passed in — keep the function pure by
letting the WORKER dedupe on step_index+state instead if cleaner; pin behavior in tests).
`runAgy` passes `--model <id>` when `opts.model` set. New export `listAgyModels(agyBin?)`:
spawns `agy models`, 60s timeout, parses TSV → `{id, label}[]`, [] on any failure.
Fixture: capture a REAL 1.1.23 stream into `tests/fixtures/agy/success-run-1123.ndjson`
(controller provides the capture — implementer asks if missing). All old fixtures keep passing.

### Task 3 — worker: scope/prompt/model + models publish
`lib/site-agent/worker.ts`: ticket items filtered to `run.item_ids` when set; `task_text`
replaces the composed title+items as the fenced block (`buildTaskPrompt` gains an optional
`taskText` that wins over title/items — still neutralized); driver gets `model: run.model`.
Models publish: inside `processNextAgentRun`'s heartbeat step, when
`app_settings.agent_worker_models.fetched_at` is older than `MODELS_REFRESH_MS` (or absent),
call the injected `listModels` dep and write `{fetched_at, models}` (best-effort,
column-tolerant, never blocks a run; skip when a run is about to be claimed? — no: do it
AFTER run processing or when no run picked, so a queued run never waits on a 4s model fetch).
`WorkerDeps` gains `listModels`. Tests: prompt-from-task_text, item filtering, model arg
pass-through, models publish cadence (fresh timestamp → no call; stale → call+write),
publish failure harmless.

### Task 4 — routes: scope/model/status automation + ticketless
- Ticket create route: body `{item_ids?: string[], task_text?: string, model?: string}` —
  item_ids validated as a subset of the ticket's UNDONE item ids (422 otherwise), model
  validated against published list when a list exists (422 unknown), task_text trimmed/capped
  (4000). After insert: ticket `Assigned` → `In Progress` (mirror the PATCH start action's
  exact writes + activity `ticket.started` with `new_value.auto: true`).
- NEW `app/api/leads/[id]/agent-runs/route.ts` (POST/GET): mirrors ticket create minus
  ticket bits; task_text REQUIRED; ticket_id null; unique-per-lead 409 via the new index;
  perms `tickets.resolve|studio.manage`; same staging-precedence protected check; GET lists
  the lead's ticketless runs (20).
- `lib/site-agent/access.ts`: runs with `ticket_id null` AND `lead_id` set are first-class —
  admitted for ALLOWED_PERMS holders (orphaned-ticket runs — ticket_id null AND lead_id
  null…, wait: purged tickets null only ticket_id — distinguish GENUINE ticketless by
  `task_text is not null` OR simply: null-ticket runs admit ALLOWED_PERMS holders, period;
  the operator accepted this loosening — document it).
- Approve route: after deploy — ticket runs: mark items done (item_ids ?? all undone),
  all-done/zero-items && `In Progress` → auto-resolve (fields + activity + notifyTicket per
  spec). Lead runs: skip ticket bits; deploy activity row `entity_type 'lead'`,
  `entity_id lead_id`; skip the files_overridden ticket-proof row (keep it for ticket runs).
- Items-toggle route (`app/api/tickets/[id]/items/[itemId]/route.ts`): after a toggle that
  makes ALL items done && status `In Progress` → same auto-resolve (resolved_by toggler).
- Poll route payload += `models` (from app_settings, [] when absent).
Tests for every behavior incl. auto-start, auto-resolve (deploy path, manual path,
zero-items path, NOT-all-done negative), ticketless create/list/scope, model validation.

### Task 5 — UI: pre-send dialog + lead mode + rich tail
`AgentRunPanel`: "Send to AI" opens a dialog — undone-item checkboxes (all on), task
textarea (prefilled from selection; edits stick), model select ("Antigravity default" +
published list from the poll/list payload — thread models via a new GET on mount or the
existing poll), Send/Cancel. POST body carries item_ids (omit when all), task_text (only
when edited), model (omit for default). Lead mode: props `{leadId?, ticketId?}` (exactly
one), list/create endpoints switch accordingly, items section hidden for lead mode &
task textarea required. `LeadDetail` mounts the panel ("AI edit site") near the site-file
buttons for perms holders with a website_link. Tail: no renderer change needed; component
tests for dialog behaviors (selection→prefill, edited flag, model option render, lead-mode
required task), plus ticketResolveNudge suite stays green.

### Task 6 — sweep + docs
Full vitest (only the 2 known pre-existing WIP failures allowed), tsc, targeted eslint on
all touched files. Changelog 2.15.0 "The AI developer, refined" (user-facing entries for
the six). SOP: models cadence note + ticketless entry point + auto-resolve behavior.

### Task 7 — ship (controller)
0072 via MCP (before push), push main, box stop→build→start, verify models published +
panel dialog live, quick ticketless smoke on a staging lead.
