-- 0059_ai_task_output_tokens.sql — operator-set output-token budget per AI task.
--
-- ADDITIVE ONLY. Shared prod DB: one nullable column, no drops, no type
-- changes, no edits to existing columns or data.
--
-- WHY. `ai_task_assignments` says WHICH model runs a task; it had no way to say
-- HOW MUCH that model may emit, so every task ran at whatever the registry
-- hardcoded. When the registry's MiniMax figure (a placeholder 32000, set
-- before the vendor published one) sat far below the model's real ceiling,
-- whole-page rewrites came back truncated mid-file. The registry now carries
-- the vendor's real numbers, and this column lets the operator tune a single
-- task inside them without a code change.
--
-- NULL means "use the model's vendor-recommended default" — that is the
-- default for every existing row, so applying this changes no behaviour.
-- The value is re-clamped to the CURRENT model's allowed range on every
-- resolve (lib/ai-tools/providers/registry.ts#clampOutputTokens), so a budget
-- left over from a previously-assigned model can never produce a request the
-- vendor would reject. The check below is therefore a sanity floor only, not
-- the real ceiling: the real ceiling is per-model and lives in the registry.
alter table public.ai_task_assignments
  add column if not exists max_output_tokens integer
    check (max_output_tokens is null or max_output_tokens > 0);
