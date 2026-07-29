-- 0062_ai_provider_rate_limits.sql — operator-set rate budget per AI provider.
--
-- ADDITIVE ONLY. Shared prod DB: one nullable column, no drops, no type
-- changes, no edits to existing columns or data.
--
-- WHY. Site Builder generations began returning HTTP 429 after roughly the
-- fifth run: every page of a site was dispatched simultaneously with nothing
-- pacing them. The gate that now paces them (lib/ai-tools/providers/gate.ts)
-- needs to know each provider's ceiling, and those ceilings are per ACCOUNT
-- TIER, not per vendor — Kimi alone spans 1 to 1000 concurrent requests across
-- its published tiers. Hardcoding one number per vendor would be wrong for
-- every operator but one.
--
-- SHAPE: {"concurrency": 100, "rpm": 500, "tpm": 3000000, "tpd": null}
-- A key ABSENT means "use the shipped default"; a key present with null means
-- "this vendor does not limit that dimension, stop enforcing it". Those are
-- different intents and the settings UI offers both, so they cannot share one
-- representation. Validation lives in resolveBudget()
-- (lib/ai-tools/providers/limits.ts), which ignores anything unusable rather
-- than letting a typo throttle generation to nothing — so this column needs no
-- check constraint beyond being an object.
--
-- NULL is the default for every existing row, meaning "shipped defaults only",
-- so applying this changes no behaviour.
alter table public.ai_providers
  add column if not exists rate_limits jsonb
    check (rate_limits is null or jsonb_typeof(rate_limits) = 'object');
