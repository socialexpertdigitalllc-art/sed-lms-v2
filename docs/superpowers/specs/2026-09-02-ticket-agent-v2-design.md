# Ticket Agent v2 — operator feedback round one

**Date:** 2026-09-02 (operator feedback from the first real ticket, 2026-09-01)
**Status:** Approved scope — six improvements requested verbatim by the operator after live testing; design calls below made autonomously on existing patterns.
**Baseline:** the shipped v1 (spec 2026-09-01, plan 2026-09-01, live on prod + the Windows worker).

## The six asks (operator's words, condensed)

1. Send the whole ticket to the AI **or** send changes one at a time.
2. Choose between the models available to Antigravity — **realtime fetched, not hardcoded**.
3. Send to AI ⇒ ticket auto-moves to **In Progress**; when all change items are done (manually
   or by the AI) ⇒ ticket **auto-resolves**.
4. **Edit the prompt** before sending it to the agent.
5. **Custom changes without a ticket** — direct AI edits on a site.
6. The live stream should show the agent's **actual responses**, not just step labels.

## Spike results (2026-09-02, agy 1.1.23 on the worker box)

- `agy models` **live-fetches** the model list ("Fetching available models…") and prints
  TSV `id\tlabel` — 11 models today (gemini-3.7/3.6-flash ×3 efforts, gemini-3.1-pro ×2,
  claude-sonnet-4-6, claude-opus-4-6-thinking, gpt-oss-120b-medium). `--model <id>` selects
  per session. (`--effort low|medium|high` also exists — NOT exposed in v2, noted for later.)
- stream-json `step_update` events in 1.1.23 carry `tool_name`, `tool_info.parameters`, and
  — on `agent_response` steps — **`text_delta`** with the agent's actual text, plus per-step
  `usage`. v1's parser discarded all of these.

## Design

### F1+F4 — the pre-send dialog (scope + prompt editing + model)

"Send to AI" now opens a dialog instead of firing immediately:

- **Changes to include**: the ticket's UNDONE items as checkboxes, all checked by default
  (all = "whole ticket"). Unchecking down to one = "one at a time". Already-done items are
  not offered.
- **Task for the AI**: an editable textarea prefilled with the default task text (title +
  the selected items, exactly as the worker would compose it; re-prefills when selection
  changes until the operator edits it). If the operator edited it, the run stores it as
  `task_text` and the worker uses it VERBATIM as the fenced ticket block (contract and
  fence-neutralization still apply — editing the task never unlocks the contract).
- **Model**: a select fed from the live-published list (below); default "Antigravity default"
  (no `--model` flag sent).

New `site_agent_runs` columns (migration 0072, additive):
`item_ids jsonb` (null = whole ticket), `task_text text`, `model text`.

### F2 — live model list

The worker (the only machine with agy) runs `agy models` on boot and then at most every
10 minutes inside its poll cycle, and publishes the parsed list to
`app_settings.agent_worker_models` (jsonb `{fetched_at, models: [{id, label}]}`, new column).
The panel's poll payload gains `models`; the dialog renders them. The list is therefore
always agy's own live catalogue — never hardcoded in our code — at worst 10 minutes stale.
A worker that cannot run `agy models` publishes nothing and the dialog shows only
"Antigravity default".

### F3 — ticket status automation

- **Create run** (ticket runs only): if the ticket is `Assigned`, the route transitions it
  to `In Progress` exactly as the manual Start action does (same activity_log
  `ticket.started` row, `new_value.auto: true`).
- **Approve/deploy**: after a successful deploy, the run's items (`item_ids`, or all undone
  items when null) are marked done (`is_done`, `done_at`, `done_by` = approver). Then, if
  EVERY item on the ticket is done — or the ticket has zero items — and the ticket is
  `In Progress`, it auto-resolves: `Resolved`, `resolved_by` = approver,
  `resolution_note` = "All change items completed (AI developer).", the standard
  `ticket.resolved` activity row and resolved notification (via lib/tickets/notify).
- **Manual completion**: the item-toggle route gains the same check — when a manual toggle
  makes the last item done and the ticket is `In Progress`, it auto-resolves
  (`resolved_by` = the toggler, note "All change items completed."). This changes existing
  behavior deliberately, per the operator's explicit ask.

### F5 — ticketless direct edits

- Entry point: the LEAD screen, next to the site-file buttons — "AI edit site" opens the
  same dialog minus the items section (task textarea required, model select).
- `POST /api/leads/[id]/agent-runs` mirrors the ticket create route: perms
  `tickets.resolve|studio.manage`, lead must have a `website_link`, staging-precedence
  protected check, live zip fetched up front, run inserted with `ticket_id null` +
  `lead_id` + `task_text`. `GET` lists the lead's runs. Migration 0072 adds a second
  partial unique index: one active run per LEAD where `ticket_id is null` (the per-ticket
  index ignores null tickets).
- The run panel mounts on the lead screen in "lead mode" (new props); the access gate
  changes for null-ticket runs: any `ALLOWED_PERMS` holder may act (previously
  studio.manage-only — that rule was for orphaned ticket runs; genuine ticketless runs are
  first-class). **Correction (shipped behavior):** the access gate keys off `ticket_id is
  null` alone, so it admits ALL null-ticket runs — genuine ticketless runs and purge-orphans
  alike — to any `tickets.resolve|studio.manage` holder. This is a deliberate but accepted
  loosening from the original design (which meant to keep purge-orphans operator-only); the
  two cases aren't distinguished in the data today. Backlog follow-up: the maintenance purge
  job should discard non-terminal runs belonging to a ticket it purges, so orphaned runs stop
  existing rather than needing a separate access rule.
- No ticket automation applies; deploy writes `site_agent.run.deployed` with
  `entity_type 'lead'` (no ticket proof card); the worker's prompt builder receives the
  task_text with a "direct change request" title.

### F6 — real content streaming

- `parseAgyEventLine` upgraded: step events carry `toolName`, `toolParams` (first few
  string params, truncated), `textDelta`, `state`.
- `summarizeEventForTail` becomes narration: agent text deltas verbatim; tools as
  `▸ tool_name (key params)` on ACTIVE (DONE suppressed when an ACTIVE was seen — the
  1.1.22 fixture's DONE-only shape still renders); init/system lines minimal.
- `TAIL_MAX_CHARS` 2048 → 6000 (real text needs room; still tiny for a 2s poll).
- New REAL 1.1.23 fixture added alongside the 1.1.22 ones; the parser stays
  backward-tolerant (all existing fixtures keep passing).
- The panel's tail box renders multi-line text as today (mono, autoscroll) — no UI change
  needed beyond the richer content.

## Out of scope (noted, not built)

`--effort` exposure; per-run model cost display; notification targeting for ticketless
runs (creator watches the panel); prompt-template management.

## Compatibility

All migration changes additive (0072). v1 runs (null new columns) behave exactly as before.
Prod deploy order unchanged: 0072 via MCP first, then code. The worker publishes models
only after the box rebuild.
