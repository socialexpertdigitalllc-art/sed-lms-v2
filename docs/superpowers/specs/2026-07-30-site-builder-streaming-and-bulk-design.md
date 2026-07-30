# Site Builder live streaming + bulk generation — design

**Date:** 2026-07-30
**Status:** approved (operator: "go, build the streaming and bulk generator")
**Scope:** phases 2 and 3 of subsystem C. Phase 1 (autonomous runs) is live.

## Phase 2 — live output streaming

**Problem.** Pages take minutes; the operator cannot tell "the model is writing
a long page" from "it is stuck". Their words: "the user should have the option
to see it".

### Provider layer

- `ProviderCallOptions` gains `onChunk?: (delta: string) => void`. When
  present, `attemptCall` sends `stream: true` and
  `stream_options: { include_usage: true }`, parses the OpenAI-style SSE lines
  (`data: {json}` / `data: [DONE]`), accumulates `choices[0].delta.content`,
  emits each delta to `onChunk`, and captures the final `usage` chunk when the
  vendor sends one. A missing usage block degrades to `usage: null` — the rate
  gate's estimate then stands, which it already reconciles. Non-streaming
  callers are byte-for-byte unaffected.
- The blunt 300s whole-call timeout becomes, on the streaming path only, an
  IDLE timeout (default 90s): "no data for 90s" is the real stall signal, and
  a big page still streaming must not be killed mid-write. The overall abort
  ceiling stays as a backstop (15 min).
- `onChunk` threads through `TaskCallOptions` → `callForTask` → the
  site-builder `AiCall` seam (gains an optional third argument) → the three
  generators, which report per-page identity.

### Progress registry and route

- `lib/site-builder/liveProgress.ts`: module-level Map, `runId → file →
  { chars, lastChunkAt, tail }` (tail capped ~2KB). In-memory is correct for
  the same reason the rate gate's registry is (single `next start` process);
  same docblock discipline. `clear(runId)` on run completion.
- `GET /api/site-builder/runs/[id]/live` (operator-guarded): the snapshot,
  plus `now` so the client computes idle seconds without clock skew.
- Run screen: while generating, poll every ~2s; per generating page show
  chars received, seconds since last chunk (red when > 60s), and an
  expandable live tail of the raw output.

## Phase 3 — bulk generation

**Problem.** One lead at a time, one screen per run. The operator wants to
queue many leads and walk away; phase 1's processor already drains queued runs
single-flight with quota-aware pacing.

- `POST /api/site-builder/runs/bulk` `{ lead_ids: string[], template_id,
  options? }`: creates one `queued` run per lead (images `[]` — bulk runs use
  whatever the prompts derive from the lead; the operator can regenerate pages
  with picked images afterwards). Refuses leads that already have an active
  (queued/generating) run — a bulk click must not double-queue. Returns
  per-lead `{created | skipped, reason}`.
- UI: a "Bulk generate" affordance on the runs board — template picker +
  lead multi-select (search, checkboxes) → POST → the runs list, which
  already shows live per-run status, is the bulk board. No new board.
- The processor stays single-flight per tick (one generation at a time), by
  design: one shared provider budget. If throughput matters later, raise the
  per-tick count behind a setting — out of scope now.

## Testing

- SSE parser: multi-chunk accumulation, `[DONE]`, usage captured / absent,
  malformed chunk skipped, idle-timeout abort fires only on silence, onChunk
  deltas match the accumulated text, non-streaming path untouched (existing
  tests unmodified).
- Registry: record/snapshot/clear, tail capping, per-run isolation.
- Bulk route: N runs created, active-lead skip, bad template 404, per-lead
  report shape.
- UI: generating page shows chars/idle; bulk flow POSTs the selected ids.
- Live acceptance: a real run watched streaming; a real bulk batch of ≥3
  leads drained by the processor unattended.

## Out of scope

- Multi-run parallel generation (single-flight stays).
- Streaming for Site Studio / template engine callers (they pass no onChunk;
  nothing changes for them).
- Persisting live tails (in-memory only; a restart loses the tail, never the
  run).
