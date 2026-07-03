# WGE-2 (Automation: Queue + Auto-Generate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate a lead's website headlessly when it's submitted (if enabled), with a strictly serial queue (one generation at a time), a manual "Queue for generation" button, a queue-management UI, and notification-bell alerts when a generation finishes.

**Architecture:** A `wge_queue` table is the source of truth. Leads enqueue on create (when "ready") or via a manual button; each enqueue fires a non-awaited kick to an internal processor route. The processor drains the queue serially using a Postgres `wge_claim_next()` function (transaction-scoped advisory lock + "claim only if nothing is processing" — pooled-connection safe), reusing extracted `persistGeneration`/`runGenerationForLead` lib helpers (non-streamed provider call). An `instrumentation.ts` interval poller is the safety net. The notification bell additionally surfaces the user's own recent finished generations (no new table).

**Tech Stack:** Next.js 16 (App Router, nodejs runtime), TypeScript, Supabase (Postgres + RLS + SQL functions via `rpc`), Vitest. Migrations applied via the Supabase MCP `apply_migration` tool (project id `ikuvbxjkoojtgekapbul`).

---

## File Structure

**Create:**
- `supabase/migrations/0008_wge_queue.sql` — `wge_queue` table, RLS, indexes, `wge_claim_next()` + `wge_reclaim_stale()` functions.
- `lib/ai-tools/run.ts` — `persistGeneration()`, `callProvider()`, `runGenerationForLead()` (server, service-role).
- `lib/ai-tools/queue.ts` — `isLeadReady()`, `shouldAutoEnqueue()` (pure), `kickProcessor()`, `enqueueLeadIfReady()`, `enqueueManual()`, `processQueue()`, constants.
- `app/api/ai-tools/wge/process/route.ts` — `POST` (secret-gated) → `processQueue()`.
- `app/api/ai-tools/wge/queue/route.ts` — `GET` (list: admin all / `?mine=1` own) + `POST` (manual enqueue).
- `app/api/ai-tools/wge/queue/[id]/route.ts` — `DELETE` (cancel pending).
- `app/api/ai-tools/wge/queue/[id]/retry/route.ts` — `POST` (requeue failed).
- `instrumentation.ts` — interval poller.
- `tests/wgeQueue.test.ts` — unit tests for the pure helpers.

**Modify:**
- `app/api/ai-tools/[tool]/save/route.ts` — call `persistGeneration` (behavior-preserving).
- `app/api/leads/route.ts` — call `enqueueLeadIfReady` after insert.
- `components/ai-tools/wge/WgeControl.tsx` — add a "Queue" tab.
- `components/leads/LeadDetail.tsx` — "Queue for generation" button + status line.
- `components/layout/NotificationBell.tsx` — merge WGE finished items.
- `.env.local` (gitignored) + `.env.example` — `WGE_PROCESSOR_SECRET`, `WGE_SELF_ORIGIN`.

---

## Task 1: Migration — `wge_queue` table, RLS, claim/reclaim functions

**Files:** Create `supabase/migrations/0008_wge_queue.sql`.

- [ ] **Step 1: Write the migration file** with exactly this SQL:

```sql
-- WGE-2: website-generation queue (serial, in-app processor)

create table if not exists public.wge_queue (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tool text not null,
  model text not null,
  status text not null default 'pending',  -- pending | processing | done | failed
  attempts integer not null default 0,
  generation_id uuid references public.ai_generations(id) on delete set null,
  error text,
  enqueued_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- at most one active (pending/processing) row per lead
create unique index if not exists uniq_wge_queue_active_lead
  on public.wge_queue (lead_id) where status in ('pending','processing');
create index if not exists idx_wge_queue_status_created on public.wge_queue (status, created_at);
create index if not exists idx_wge_queue_enqueued_by on public.wge_queue (enqueued_by);

alter table public.wge_queue enable row level security;

-- a user sees their own queued items; wge.manage sees all. Writes go via service role.
create policy "read wge_queue own or manage" on public.wge_queue for select to authenticated
  using (enqueued_by = auth.uid() or public.has_permission('wge.manage'));

-- Reclaim rows stuck in 'processing' longer than 10 minutes (crash recovery).
create or replace function public.wge_reclaim_stale() returns void
language sql security definer set search_path = public as $$
  update public.wge_queue
     set status = 'pending', error = 'reclaimed after timeout'
   where status = 'processing' and started_at < now() - interval '10 minutes';
$$;

-- Claim the next pending row, but ONLY if nothing is currently processing
-- (serial guarantee). A transaction-scoped advisory lock closes the race window
-- and is safe across pooled connections (released at transaction end).
create or replace function public.wge_claim_next() returns setof public.wge_queue
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(8273);
  return query
  update public.wge_queue q
     set status = 'processing', started_at = now(), attempts = attempts + 1
   where q.id = (
     select c.id from public.wge_queue c
      where c.status = 'pending'
        and not exists (select 1 from public.wge_queue p where p.status = 'processing')
      order by c.created_at
      limit 1
      for update skip locked
   )
  returning q.*;
end;
$$;
```

- [ ] **Step 2: Apply the migration.** Load the Supabase MCP tools first: ToolSearch `select:mcp__75464549-5514-48c4-964e-2efef1a0ab39__apply_migration,mcp__75464549-5514-48c4-964e-2efef1a0ab39__execute_sql`. Then call `apply_migration` with `project_id: "ikuvbxjkoojtgekapbul"`, `name: "0008_wge_queue"`, `query:` the SQL above. Expect `{"success":true}`.

- [ ] **Step 3: Verify.** Via MCP `execute_sql`, `project_id: "ikuvbxjkoojtgekapbul"`: run `select count(*) from public.wge_queue;` (expect 0) and `select proname from pg_proc where proname in ('wge_claim_next','wge_reclaim_stale');` (expect 2 rows).

- [ ] **Step 4: Commit.**
```bash
git add supabase/migrations/0008_wge_queue.sql
git commit -m "feat(wge2): wge_queue table, RLS, claim/reclaim functions"
```

---

## Task 2: Extract `persistGeneration` and refactor the save route

**Files:** Create `lib/ai-tools/run.ts`; Modify `app/api/ai-tools/[tool]/save/route.ts`.

- [ ] **Step 1: Create `lib/ai-tools/run.ts`** with the persist helper (extracted verbatim from the save route logic):

```typescript
import { createAdminClient } from "@/lib/supabase/admin";
import { TOOLS, type ToolId } from "./config";
import { countImages, countWords, type GeneratedFile } from "./parse";

const BUCKET = "ai-generations";

export interface PersistInput {
  tool: ToolId;
  agentId: string | null;
  leadId?: string | null;
  businessName?: string | null;
  model: string;
  files: GeneratedFile[];
  tokensUsed?: number | null;
  totalTimeMs?: number | null;
  inputTimeMs?: number | null;
  aiTimeMs?: number | null;
  pageTypes?: string[];
  numPages?: number | null;
  status?: "success" | "failed";
  errors?: string | null;
}

// Insert the ai_generations row, upload each file to private Storage, finalise.
export async function persistGeneration(input: PersistInput): Promise<{ id: string; uploaded: string[] }> {
  const cfg = TOOLS[input.tool];
  const admin = createAdminClient();

  const tokens = input.tokensUsed ?? 0;
  const numPages = input.numPages ?? input.files.length;
  const wordCount = countWords(input.files);
  const imageCount = countImages(input.files);
  const cost = Number(((tokens / 1000) * cfg.costPer1kUsd).toFixed(6));
  const complexity = Number((numPages * 10 + imageCount * 2 + tokens / 100).toFixed(2));

  const { data: row, error: insErr } = await admin
    .from("ai_generations")
    .insert({
      tool: input.tool,
      agent_id: input.agentId,
      lead_id: input.leadId ?? null,
      business_name: input.businessName ?? null,
      model: input.model,
      total_time_ms: input.totalTimeMs ?? null,
      input_time_ms: input.inputTimeMs ?? null,
      ai_time_ms: input.aiTimeMs ?? null,
      num_pages: numPages,
      num_files: input.files.length,
      page_types: input.pageTypes ?? input.files.map((f) => f.name),
      tokens_used: tokens,
      cost_usd: cost,
      status: input.status ?? "success",
      word_count: wordCount,
      image_count: imageCount,
      complexity_score: complexity,
      errors: input.errors ?? null,
    })
    .select("id")
    .single();
  if (insErr || !row) throw new Error(insErr?.message ?? "Save failed");

  const uploaded: string[] = [];
  for (const f of input.files) {
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(`${row.id}/${f.name}`, new Blob([f.code], { type: "text/html" }), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
      });
    if (!upErr) uploaded.push(f.name);
  }

  await admin.from("ai_generations").update({ file_path: `${row.id}/` }).eq("id", row.id);
  return { id: row.id, uploaded };
}
```

- [ ] **Step 2: Refactor `app/api/ai-tools/[tool]/save/route.ts`** to call `persistGeneration`. Replace the body after `const b = parsed.data;` (the manual admin insert + upload + file_path update) with:

```typescript
  let result;
  try {
    result = await persistGeneration({
      tool,
      agentId: user.id,
      leadId: b.leadId,
      businessName: b.businessName,
      model: b.model,
      files: b.files,
      tokensUsed: b.tokensUsed,
      totalTimeMs: b.totalTimeMs,
      inputTimeMs: b.inputTimeMs,
      aiTimeMs: b.aiTimeMs,
      pageTypes: b.pageTypes,
      numPages: b.numPages,
      status: b.status,
      errors: b.errors,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const admin = createAdminClient();
  await admin.from("activity_log").insert({
    user_id: user.id,
    action: `ai.${tool}.generated`,
    entity_type: "ai_generation",
    entity_id: result.id,
    new_value: { business_name: b.businessName, files: result.uploaded.length, model: b.model },
  });

  return NextResponse.json({ id: result.id, files: result.uploaded }, { status: 201 });
```
Update imports: add `import { persistGeneration } from "@/lib/ai-tools/run";`. Remove the now-unused `countImages, countWords` import and the `BUCKET` const if no longer referenced in the route. Keep `createAdminClient` (used for activity_log).

- [ ] **Step 3: Verify** the existing tests + build: `npm run test` (69 pass) and `npm run build` (compiles). npm is slow (minutes) — be patient.

- [ ] **Step 4: Commit.**
```bash
git add lib/ai-tools/run.ts "app/api/ai-tools/[tool]/save/route.ts"
git commit -m "refactor(wge2): extract persistGeneration; save route reuses it"
```

---

## Task 3: `callProvider` + `runGenerationForLead`

**Files:** Modify `lib/ai-tools/run.ts`.

- [ ] **Step 1: Append the provider call + lead-generation orchestrator** to `lib/ai-tools/run.ts`:

```typescript
import { getWgeConfig } from "./wge";
import { mapLeadToInput } from "./leadPrefill";
import { buildPrompt, EMPTY_INPUT, type GenInput } from "./prompt";
import { parseFiles } from "./parse";
import { isToolId } from "./config";
import { createClient } from "@/lib/supabase/server";

// Non-streamed OpenAI-compatible chat completion. Returns { text, tokens }.
export async function callProvider(
  tool: ToolId,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens: number; temperature: number }
): Promise<{ text: string; tokens: number }> {
  const cfg = TOOLS[tool];
  const apiKey = process.env[cfg.envKey];
  if (!apiKey) throw new Error(`${cfg.label} is not configured (missing ${cfg.envKey}).`);

  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(opts.maxTokens, cfg.maxOutputTokens),
      temperature: opts.temperature,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const j = await res.json();
  const text: string = j?.choices?.[0]?.message?.content ?? "";
  const tokens: number = j?.usage?.total_tokens ?? Math.ceil(text.length / 4);
  return { text, tokens };
}

// Headlessly generate a lead's website end-to-end. Throws on failure.
export async function runGenerationForLead(
  leadId: string,
  engine: { tool: ToolId; model: string },
  enqueuedBy: string | null
): Promise<{ generationId: string }> {
  if (!isToolId(engine.tool)) throw new Error(`Unknown engine tool: ${engine.tool}`);
  const supabase = await createClient();
  const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).is("deleted_at", null).single();
  if (!lead) throw new Error("Lead not found");

  const config = await getWgeConfig();
  const values: GenInput = { ...EMPTY_INPUT, ...mapLeadToInput(lead, config.variables) };
  const userPrompt = buildPrompt(values, config.prompt_template);

  const start = Date.now();
  const { text, tokens } = await callProvider(engine.tool, engine.model, config.system_prompt, userPrompt, {
    maxTokens: config.settings.max_tokens,
    temperature: config.settings.temperature,
  });
  const aiMs = Date.now() - start;

  const files = parseFiles(text);
  if (!files.length) throw new Error("The model returned no usable HTML.");

  const { id } = await persistGeneration({
    tool: engine.tool,
    agentId: (lead.agent_id as string | null) ?? enqueuedBy,
    leadId,
    businessName: lead.business_name as string,
    model: engine.model,
    files,
    tokensUsed: tokens,
    totalTimeMs: aiMs,
    aiTimeMs: aiMs,
    status: "success",
  });
  return { generationId: id };
}
```

- [ ] **Step 2: Verify** types/build: `npx tsc --noEmit` (no new errors).

- [ ] **Step 3: Commit.**
```bash
git add lib/ai-tools/run.ts
git commit -m "feat(wge2): callProvider (non-streamed) + runGenerationForLead"
```

---

## Task 4: Queue pure logic + tests (`isLeadReady`, `shouldAutoEnqueue`)

**Files:** Create `lib/ai-tools/queue.ts` (pure parts) and `tests/wgeQueue.test.ts`.

- [ ] **Step 1: Write the failing test** `tests/wgeQueue.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isLeadReady, shouldAutoEnqueue } from "@/lib/ai-tools/queue";
import { DEFAULT_SETTINGS } from "@/lib/ai-tools/wge-defaults";

describe("isLeadReady", () => {
  it("true when all required keys have non-empty values", () => {
    expect(isLeadReady({ name: "Acme", services: "Roofing", pages: "5" }, ["name", "services", "pages"])).toBe(true);
  });
  it("false when a required key is missing or empty", () => {
    expect(isLeadReady({ name: "Acme", services: "", pages: "5" }, ["name", "services", "pages"])).toBe(false);
    expect(isLeadReady({ name: "Acme" }, ["name", "services"])).toBe(false);
  });
  it("true when ready_required is empty", () => {
    expect(isLeadReady({}, [])).toBe(true);
  });
});

describe("shouldAutoEnqueue", () => {
  const engine = { provider: "deepseek" as const, model: "deepseek-chat" };
  const ready = { name: "Acme", services: "Roofing", pages: "5" };
  it("true when enabled, engine set, ready, not yet queued/generated", () => {
    const s = { ...DEFAULT_SETTINGS, auto_generate: true, auto_engine: engine };
    expect(shouldAutoEnqueue(s, ready, { hasActive: false, hasGeneration: false })).toBe(true);
  });
  it("false when auto_generate is off", () => {
    const s = { ...DEFAULT_SETTINGS, auto_generate: false, auto_engine: engine };
    expect(shouldAutoEnqueue(s, ready, { hasActive: false, hasGeneration: false })).toBe(false);
  });
  it("false when auto_engine is null", () => {
    const s = { ...DEFAULT_SETTINGS, auto_generate: true, auto_engine: null };
    expect(shouldAutoEnqueue(s, ready, { hasActive: false, hasGeneration: false })).toBe(false);
  });
  it("false when not ready", () => {
    const s = { ...DEFAULT_SETTINGS, auto_generate: true, auto_engine: engine };
    expect(shouldAutoEnqueue(s, { name: "Acme" }, { hasActive: false, hasGeneration: false })).toBe(false);
  });
  it("false when already active or already generated", () => {
    const s = { ...DEFAULT_SETTINGS, auto_generate: true, auto_engine: engine };
    expect(shouldAutoEnqueue(s, ready, { hasActive: true, hasGeneration: false })).toBe(false);
    expect(shouldAutoEnqueue(s, ready, { hasActive: false, hasGeneration: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails:** `npm run test -- wgeQueue` → FAIL (module not found).

- [ ] **Step 3: Create `lib/ai-tools/queue.ts`** with the pure helpers (the side-effecting functions are added in Tasks 5–6):

```typescript
import type { WgeSettings } from "./wge-types";

export const ADVISORY_LOCK_KEY = 8273; // matches wge_claim_next()

// Every required variable key must have a non-empty mapped value.
export function isLeadReady(values: Record<string, string>, readyRequired: string[]): boolean {
  return readyRequired.every((k) => (values[k] ?? "").trim() !== "");
}

// Pure decision: should a freshly-created lead be auto-queued?
export function shouldAutoEnqueue(
  settings: WgeSettings,
  values: Record<string, string>,
  state: { hasActive: boolean; hasGeneration: boolean }
): boolean {
  if (!settings.auto_generate) return false;
  if (!settings.auto_engine) return false;
  if (state.hasActive || state.hasGeneration) return false;
  return isLeadReady(values, settings.ready_required);
}
```

- [ ] **Step 4: Run to verify it passes:** `npm run test -- wgeQueue` → PASS (8 assertions).

- [ ] **Step 5: Commit.**
```bash
git add lib/ai-tools/queue.ts tests/wgeQueue.test.ts
git commit -m "feat(wge2): queue readiness + auto-enqueue decision (pure, tested)"
```

---

## Task 5: Enqueue side-effects (`kickProcessor`, `enqueueLeadIfReady`, `enqueueManual`)

**Files:** Modify `lib/ai-tools/queue.ts`.

- [ ] **Step 1: Append the side-effecting helpers** to `lib/ai-tools/queue.ts`:

```typescript
import { createAdminClient } from "@/lib/supabase/admin";
import { getWgeConfig } from "./wge";
import { mapLeadToInput } from "./leadPrefill";

type LeadRow = Record<string, unknown>;

// Fire-and-forget kick of the processor (does not await; ignores errors).
export function kickProcessor(): void {
  const origin = process.env.WGE_SELF_ORIGIN || "http://localhost:3000";
  const secret = process.env.WGE_PROCESSOR_SECRET || "";
  void fetch(`${origin}/api/ai-tools/wge/process`, {
    method: "POST",
    headers: { "x-wge-secret": secret },
  }).catch(() => {});
}

async function leadHasActiveOrGeneration(admin: ReturnType<typeof createAdminClient>, leadId: string) {
  const { count: activeCount } = await admin
    .from("wge_queue")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId)
    .in("status", ["pending", "processing"]);
  const { count: genCount } = await admin
    .from("ai_generations")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId);
  return { hasActive: (activeCount ?? 0) > 0, hasGeneration: (genCount ?? 0) > 0 };
}

// Called after a lead is created. Never throws (must not block lead creation).
export async function enqueueLeadIfReady(lead: LeadRow, userId: string): Promise<void> {
  try {
    const config = await getWgeConfig();
    if (!config.settings.auto_generate || !config.settings.auto_engine) return;
    const admin = createAdminClient();
    const state = await leadHasActiveOrGeneration(admin, lead.id as string);
    const values = mapLeadToInput(lead, config.variables) as Record<string, string>;
    if (!shouldAutoEnqueue(config.settings, values, state)) return;
    await admin.from("wge_queue").insert({
      lead_id: lead.id as string,
      tool: config.settings.auto_engine.provider,
      model: config.settings.auto_engine.model,
      enqueued_by: userId,
    });
    kickProcessor();
  } catch {
    /* never block lead creation */
  }
}

// Manual "Queue for generation". Returns a reason string on refusal, null on success.
export async function enqueueManual(leadId: string, userId: string): Promise<string | null> {
  const config = await getWgeConfig();
  if (!config.settings.auto_engine) return "Set an auto engine in WGE → Engine Settings first.";
  const admin = createAdminClient();
  const state = await leadHasActiveOrGeneration(admin, leadId);
  if (state.hasActive) return "This lead is already queued.";
  const { error } = await admin.from("wge_queue").insert({
    lead_id: leadId,
    tool: config.settings.auto_engine.provider,
    model: config.settings.auto_engine.model,
    enqueued_by: userId,
  });
  if (error) return error.message;
  kickProcessor();
  return null;
}
```
Note: `enqueueManual` allows re-queue even if the lead was generated before (only blocks an active row), per spec.

- [ ] **Step 2: Verify** `npx tsc --noEmit` (no new errors).

- [ ] **Step 3: Commit.**
```bash
git add lib/ai-tools/queue.ts
git commit -m "feat(wge2): enqueue helpers (auto + manual) and processor kick"
```

---

## Task 6: Processor (`processQueue`) + `/process` route + env

**Files:** Modify `lib/ai-tools/queue.ts`; Create `app/api/ai-tools/wge/process/route.ts`; Modify `.env.local`, `.env.example`.

- [ ] **Step 1: Append `processQueue` to `lib/ai-tools/queue.ts`:**

```typescript
import { runGenerationForLead } from "./run";
import type { ToolId } from "./config";

// Drain the queue serially. Safe to call concurrently — wge_claim_next() only
// hands out a row when nothing is processing, so at most one generation runs.
export async function processQueue(): Promise<{ processed: number }> {
  const admin = createAdminClient();
  await admin.rpc("wge_reclaim_stale");

  let processed = 0;
  // Bounded loop guard against pathological runaway.
  for (let i = 0; i < 100; i++) {
    const { data: claimed, error } = await admin.rpc("wge_claim_next");
    if (error) break;
    const row = Array.isArray(claimed) ? claimed[0] : claimed;
    if (!row) break; // queue empty OR another generation is in flight

    try {
      const { generationId } = await runGenerationForLead(
        row.lead_id,
        { tool: row.tool as ToolId, model: row.model },
        row.enqueued_by
      );
      await admin
        .from("wge_queue")
        .update({ status: "done", generation_id: generationId, finished_at: new Date().toISOString() })
        .eq("id", row.id);
    } catch (e) {
      await admin
        .from("wge_queue")
        .update({ status: "failed", error: String((e as Error).message).slice(0, 500), finished_at: new Date().toISOString() })
        .eq("id", row.id);
    }
    processed++;
  }
  return { processed };
}
```

- [ ] **Step 2: Create `app/api/ai-tools/wge/process/route.ts`:**

```typescript
import { NextResponse } from "next/server";
import { processQueue } from "@/lib/ai-tools/queue";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(req: Request) {
  const secret = req.headers.get("x-wge-secret");
  if (!secret || secret !== process.env.WGE_PROCESSOR_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await processQueue();
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Add env vars.** Append to `.env.local` (gitignored) — generate a random secret value:
```
WGE_PROCESSOR_SECRET=<random-32+char-string>
WGE_SELF_ORIGIN=http://localhost:3000
```
And add the key names (no values) to `.env.example`:
```
# WGE-2 automation
WGE_PROCESSOR_SECRET=
WGE_SELF_ORIGIN=http://localhost:3000
```
Generate the secret with: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` and paste it into `.env.local`.

- [ ] **Step 4: Verify** `npx tsc --noEmit` + `npm run build` (the `/api/ai-tools/wge/process` route appears).

- [ ] **Step 5: Commit.**
```bash
git add lib/ai-tools/queue.ts app/api/ai-tools/wge/process/route.ts .env.example
git commit -m "feat(wge2): serial queue processor + secret-gated /process route"
```

---

## Task 7: Queue API — list / manual enqueue / retry / cancel

**Files:** Create `app/api/ai-tools/wge/queue/route.ts`, `app/api/ai-tools/wge/queue/[id]/route.ts`, `app/api/ai-tools/wge/queue/[id]/retry/route.ts`.

- [ ] **Step 1: Create `app/api/ai-tools/wge/queue/route.ts`** (GET list + POST manual):

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { enqueueManual, AI_TOOLS_PERMS_OK } from "@/lib/ai-tools/queue";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mine = searchParams.get("mine") === "1";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS already scopes to own-or-manage. `mine` further filters to the caller's
  // recent finished rows (for the notification bell).
  let q = supabase
    .from("wge_queue")
    .select("id, lead_id, tool, model, status, attempts, generation_id, error, enqueued_by, created_at, started_at, finished_at, leads(business_name)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (mine) {
    q = q.eq("enqueued_by", user.id).in("status", ["done", "failed"]).gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await getUserPermissions(user.id);
  if (!AI_TOOLS_PERMS_OK(perms)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const leadId = typeof body?.leadId === "string" ? body.leadId : null;
  if (!leadId) return NextResponse.json({ error: "Missing leadId" }, { status: 400 });

  const reason = await enqueueManual(leadId, user.id);
  if (reason) return NextResponse.json({ error: reason }, { status: 400 });
  return NextResponse.json({ queued: true }, { status: 201 });
}
```

- [ ] **Step 2: Add the `AI_TOOLS_PERMS_OK` helper** to `lib/ai-tools/queue.ts` (near the top, after imports):

```typescript
export function AI_TOOLS_PERMS_OK(perms: Set<string>): boolean {
  return perms.has("ai_tools.webcraft") || perms.has("ai_tools.deepseek");
}
```

- [ ] **Step 3: Create `app/api/ai-tools/wge/queue/[id]/retry/route.ts`** (requeue a failed row — requires `wge.manage`):

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWgeManage } from "@/lib/ai-tools/wge";
import { kickProcessor } from "@/lib/ai-tools/queue";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await assertWgeManage();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });

  const admin = createAdminClient();
  // Only failed rows can be retried; clearing the active-lead uniqueness is fine
  // because a failed row is not 'pending'/'processing'.
  const { data, error } = await admin
    .from("wge_queue")
    .update({ status: "pending", error: null, started_at: null, finished_at: null })
    .eq("id", id)
    .eq("status", "failed")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data?.length) return NextResponse.json({ error: "Not a retryable (failed) row" }, { status: 409 });
  kickProcessor();
  return NextResponse.json({ ok: true });
}
```
> Note: a failed row sharing a `lead_id` with a new active row is prevented by the partial unique index — if a newer pending/processing row exists for that lead, the `update ... set status='pending'` would violate the index and error (returned as 400). That's acceptable (the lead is already queued again).

- [ ] **Step 4: Create `app/api/ai-tools/wge/queue/[id]/route.ts`** (cancel a pending row — requires `wge.manage`):

```typescript
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertWgeManage } from "@/lib/ai-tools/wge";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await assertWgeManage();
  if ("error" in auth) return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });

  const admin = createAdminClient();
  const { data, error } = await admin.from("wge_queue").delete().eq("id", id).eq("status", "pending").select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data?.length) return NextResponse.json({ error: "Only pending rows can be cancelled" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Verify** `npx tsc --noEmit` + `npm run build` (4 new queue routes appear).

- [ ] **Step 6: Commit.**
```bash
git add app/api/ai-tools/wge/queue lib/ai-tools/queue.ts
git commit -m "feat(wge2): queue API (list/mine, manual enqueue, retry, cancel)"
```

---

## Task 8: Wire lead creation → enqueue

**Files:** Modify `app/api/leads/route.ts`.

- [ ] **Step 1: Call `enqueueLeadIfReady` after the lead insert + activity log.** Add the import `import { enqueueLeadIfReady } from "@/lib/ai-tools/queue";`, then immediately before the final `return NextResponse.json({ id: data.id }, { status: 201 });` add:

```typescript
  // Fire-and-forget auto-generation (never blocks lead creation).
  await enqueueLeadIfReady({ ...parsed.data, id: data.id }, user.id);
```
(`enqueueLeadIfReady` is internally wrapped in try/catch and returns void, so a failure here cannot break the response. It maps `parsed.data` via the config variables — `parsed.data` uses the same `leads` column names, so the mapping works on it directly.)

- [ ] **Step 2: Verify** `npx tsc --noEmit` + `npm run build`.

- [ ] **Step 3: Commit.**
```bash
git add app/api/leads/route.ts
git commit -m "feat(wge2): auto-enqueue website generation on lead create"
```

---

## Task 9: Safety-net poller (`instrumentation.ts`)

**Files:** Create `instrumentation.ts` (repo root).

- [ ] **Step 1: Create `instrumentation.ts`:**

```typescript
// Next.js instrumentation: runs once on server startup (nodejs runtime).
// A lightweight poller kicks the WGE processor so queued generations drain
// even if an enqueue kick was lost (e.g., across a restart).
let started = false;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (started) return; // guard against dev HMR double-registration
  started = true;

  const origin = process.env.WGE_SELF_ORIGIN || "http://localhost:3000";
  const secret = process.env.WGE_PROCESSOR_SECRET || "";
  if (!secret) return; // not configured → no poller

  setInterval(() => {
    fetch(`${origin}/api/ai-tools/wge/process`, { method: "POST", headers: { "x-wge-secret": secret } }).catch(() => {});
  }, 120_000);
}
```

- [ ] **Step 2: Verify** `npm run build` compiles (Next picks up `instrumentation.ts` automatically; the build log shows no instrumentation error).

- [ ] **Step 3: Commit.**
```bash
git add instrumentation.ts
git commit -m "feat(wge2): instrumentation poller as processor safety net"
```

---

## Task 10: Queue UI (WGE tab) + lead-detail button & status

**Files:** Modify `components/ai-tools/wge/WgeControl.tsx`, `components/leads/LeadDetail.tsx`.

- [ ] **Step 1: Add a "Queue" tab to `WgeControl.tsx`.** Change the `Tab` type to include `"queue"`, add it to the tab button list (label "Queue"), add queue state + a fetch, and render a table. Concretely:

(a) Update the type and tab list:
```typescript
type Tab = "prompt" | "variables" | "settings" | "queue";
// ...in the tab button map, change the array to:
{(["prompt", "variables", "settings", "queue"] as Tab[]).map((t) => (
  <button key={t} onClick={() => setTab(t)} className={"text-sm px-3 py-1.5 rounded-md font-medium " + (tab === t ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")}>
    {t === "prompt" ? "Prompt Studio" : t === "variables" ? "Variables & Mapping" : t === "settings" ? "Engine Settings" : "Queue"}
  </button>
))}
```

(b) Add state + loader near the other hooks:
```typescript
type QueueRow = {
  id: string; lead_id: string; tool: string; model: string; status: string; attempts: number;
  generation_id: string | null; error: string | null; created_at: string; finished_at: string | null;
  leads: { business_name: string } | null;
};
const [queue, setQueue] = useState<QueueRow[]>([]);
const [queueBusy, setQueueBusy] = useState(false);

async function loadQueue() {
  setQueueBusy(true);
  const res = await fetch("/api/ai-tools/wge/queue");
  setQueueBusy(false);
  if (res.ok) setQueue((await res.json()).items ?? []);
}
useEffect(() => { if (tab === "queue") loadQueue(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);

async function retryRow(id: string) { await fetch(`/api/ai-tools/wge/queue/${id}/retry`, { method: "POST" }); loadQueue(); }
async function cancelRow(id: string) { await fetch(`/api/ai-tools/wge/queue/${id}`, { method: "DELETE" }); loadQueue(); }
```
(Ensure `useEffect` is imported — it already is.)

(c) Render the queue tab (add after the settings tab block):
```tsx
      {tab === "queue" && (
        <Card title="Generation queue">
          <div className="flex justify-end mb-3">
            <button onClick={loadQueue} disabled={queueBusy} className="text-sm px-3 py-1.5 rounded-md border border-border text-text-muted hover:bg-surface-2">{queueBusy ? "Loading…" : "Refresh"}</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-text-faint">
                <th className="py-2 pr-3">Business</th><th className="pr-3">Engine</th><th className="pr-3">Status</th><th className="pr-3">Attempts</th><th className="pr-3">When</th><th className="pr-3"></th>
              </tr></thead>
              <tbody>
                {queue.length === 0 ? (
                  <tr><td colSpan={6} className="py-8 text-center text-text-faint">Queue is empty.</td></tr>
                ) : queue.map((r) => (
                  <tr key={r.id} className="border-t border-border-subtle align-top">
                    <td className="py-2 pr-3 font-medium text-text">{r.leads?.business_name ?? r.lead_id.slice(0, 8)}</td>
                    <td className="pr-3 text-text-muted font-mono text-xs">{r.tool}/{r.model}</td>
                    <td className="pr-3">
                      <span className={"text-xs px-2 py-0.5 rounded-full font-medium " + (r.status === "done" ? "bg-ready-bg text-ready-fg" : r.status === "failed" ? "bg-dropped-bg text-dropped-fg" : r.status === "processing" ? "bg-notready-bg text-notready-fg" : "bg-surface-2 text-text-muted")}>{r.status}</span>
                      {r.error && <div className="text-[11px] text-dropped-fg mt-1 max-w-[260px]">{r.error}</div>}
                    </td>
                    <td className="pr-3 font-mono text-text-muted">{r.attempts}</td>
                    <td className="pr-3 text-text-faint text-xs whitespace-nowrap">{new Date(r.finished_at ?? r.created_at).toLocaleString()}</td>
                    <td className="pr-3 whitespace-nowrap">
                      {r.status === "done" && r.generation_id && <a href={`/ai-tools/generations/${r.generation_id}`} className="text-xs text-accent-ink hover:underline">View</a>}
                      {r.status === "failed" && <button onClick={() => retryRow(r.id)} className="text-xs text-accent-ink hover:underline">Retry</button>}
                      {r.status === "pending" && <button onClick={() => cancelRow(r.id)} className="text-xs text-dropped-fg hover:underline">Cancel</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
```

- [ ] **Step 2: Add the manual button + status to `components/leads/LeadDetail.tsx`.** It already imports `usePermissions` and computes `canWebcraft`/`canDeepseek`. Add a queue control in the header actions. Near the other `const can…` lines add:
```typescript
  const canQueue = canWebcraft || canDeepseek;
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [queuing, setQueuing] = useState(false);
  async function queueForGeneration() {
    setQueuing(true); setQueueMsg(null);
    const res = await fetch("/api/ai-tools/wge/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: lead.id }) });
    setQueuing(false);
    const j = await res.json().catch(() => ({}));
    setQueueMsg(res.ok ? "Queued for generation ✓" : (j.error ?? "Could not queue"));
  }
```
Then in the header action buttons row (where the WebCraft/DeepSeek links are), add:
```tsx
          {canQueue && (
            <button onClick={queueForGeneration} disabled={queuing} className="text-sm px-3 py-2 rounded-md border border-border text-text hover:bg-surface-2 disabled:opacity-60">
              {queuing ? "Queuing…" : "Queue for generation"}
            </button>
          )}
```
And render `queueMsg` near the existing `msg` banner:
```tsx
      {queueMsg && <div className="mb-4 text-sm rounded-md px-3 py-2 bg-accent-soft text-accent-ink">{queueMsg}</div>}
```
(Ensure `useState` is imported — it already is.)

- [ ] **Step 3: Verify** `npx tsc --noEmit` + `npm run build`.

- [ ] **Step 4: Commit.**
```bash
git add components/ai-tools/wge/WgeControl.tsx components/leads/LeadDetail.tsx
git commit -m "feat(wge2): queue management tab + lead-detail queue button"
```

---

## Task 11: Notification bell — surface finished generations

**Files:** Modify `components/layout/NotificationBell.tsx`.

- [ ] **Step 1: Fetch the caller's recent finished generations and merge into the dropdown.** Add state + a second fetch in the existing component:

```typescript
type WgeNote = { id: string; status: string; generation_id: string | null; leads: { business_name: string } | null };
// inside the component, add:
const [wge, setWge] = useState<WgeNote[]>([]);
// add a second effect (alongside the pre-leads one):
useEffect(() => {
  let active = true;
  (async () => {
    try {
      const res = await fetch("/api/ai-tools/wge/queue?mine=1");
      if (res.ok && active) setWge(((await res.json()).items ?? []) as WgeNote[]);
    } catch { /* ignore — bell still works for pre-leads */ }
  })();
  return () => { active = false; };
}, []);
```

- [ ] **Step 2: Include WGE items in the count and the dropdown list.** Update the count:
```typescript
const count = due.length + overdue.length + wge.length;
```
And render a WGE section in the dropdown panel (place it above or below the existing follow-up lists, following the same `<li>`/`<Link>` styling). Add:
```tsx
            {wge.length > 0 && (
              <>
                <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-text-faint font-semibold">Website generations</div>
                <ul>
                  {wge.map((w) => (
                    <li key={w.id}>
                      <Link
                        href={w.status === "done" && w.generation_id ? `/ai-tools/generations/${w.generation_id}` : "/ai-tools/wge"}
                        onClick={() => setOpen(false)}
                        className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-surface-2 transition-colors"
                      >
                        <span className="text-sm font-medium text-text truncate">
                          {w.status === "done" ? "Website ready" : "Generation failed"} — {w.leads?.business_name ?? "lead"}
                        </span>
                        <span className={"text-[11px] whitespace-nowrap " + (w.status === "done" ? "text-ready-fg" : "text-dropped-fg")}>{w.status}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
```
Also make sure the "empty" state of the dropdown accounts for `wge.length` (if the bell shows an "all caught up" message only when `count === 0`, it already works since `count` now includes `wge`).

- [ ] **Step 3: Verify** `npx tsc --noEmit` + `npm run build`.

- [ ] **Step 4: Commit.**
```bash
git add components/layout/NotificationBell.tsx
git commit -m "feat(wge2): notification bell surfaces finished generations"
```

---

## Task 12: Live verification (Chrome MCP + DeepSeek)

**Files:** none.

- [ ] **Step 1** Ensure the dev server is running with the new env (`WGE_PROCESSOR_SECRET`, `WGE_SELF_ORIGIN`). If it was already running before Task 6, RESTART it (`npm run dev`) so the new env vars + `instrumentation.ts` load.
- [ ] **Step 2** As admin, open `/ai-tools/wge` → **Engine Settings**: set **Auto engine** = `DeepSeek — deepseek-chat`, turn **Auto-generate** ON, ensure **Required fields** = `name, services, pages`. Save.
- [ ] **Step 3** Create a lead that meets the threshold: `/leads/new` with business name + services + (number of) pages set. Submit.
- [ ] **Step 4** Open `/ai-tools/wge` → **Queue** tab → Refresh. Expect a row for that lead transitioning `pending`/`processing` → `done` within ~1–2 min (DeepSeek). Confirm a generation appears in `/ai-tools/analytics` history and the queue row's **View** opens the preview.
- [ ] **Step 5** Confirm the **notification bell** shows "Website ready — {business}".
- [ ] **Step 6** Create a lead that is NOT ready (e.g., no services) → confirm NO queue row is created.
- [ ] **Step 7** On a lead detail page, click **Queue for generation** → confirm it queues and processes (manual path).
- [ ] **Step 8** Force a failure: temporarily set Auto engine to `WebCraft` (suspended Moonshot), queue a lead → confirm the queue row goes `failed` with the suspension message, then **Retry** requeues it. Set the engine back to DeepSeek afterward.
- [ ] **Step 9** Confirm a normal manual generation (the existing `/ai-tools/deepseek` flow) still works (no Phase-4/WGE-1 regression). Clean up any test leads/generations/queue rows created during testing.

---

## Self-Review Notes (addressed)

- **Spec coverage:** queue table + partial-unique + RLS own-or-manage (Task 1); serial processor via `wge_claim_next` xact-lock + "claim only if none processing" (Tasks 1, 6); shared `persistGeneration`/`callProvider`/`runGenerationForLead` reuse (Tasks 2, 3); readiness + auto/manual enqueue + dedup (Tasks 4, 5); trigger on create (Task 8); manual button + status (Task 10); poller (Task 9); queue UI with retry/cancel (Task 10); bell integration via `?mine=1` (Tasks 7, 11); env secret (Task 6); failure→failed+manual-retry, stale reclaim, truncation handling (Tasks 1, 6, 3). Notifications use the derived bell (no new table) per spec.
- **Connection-pooling safety:** serialization uses `pg_advisory_xact_lock` *inside* `wge_claim_next()` (transaction-scoped, released at statement end) + a "not exists processing" guard — correct under Supabase's pooled connections, unlike a session-level `pg_advisory_lock` split across `rpc()` calls.
- **Type consistency:** `enqueueLeadIfReady(lead, userId)`, `enqueueManual(leadId, userId): Promise<string|null>`, `kickProcessor()`, `processQueue()`, `persistGeneration(PersistInput)`, `callProvider(tool, model, sys, user, opts)`, `runGenerationForLead(leadId, {tool,model}, enqueuedBy)`, `AI_TOOLS_PERMS_OK(perms)`, `isLeadReady`, `shouldAutoEnqueue` — signatures match across all call sites (lead route, queue routes, processor, UI).
- **No placeholders:** every code step is complete.
```
