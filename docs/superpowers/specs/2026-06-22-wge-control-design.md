# WGE (Website Generation Engine) Control — Design

**Date:** 2026-06-22
**Status:** Approved (brainstorm) — ready for implementation plan
**Scope of this spec:** WGE-1, the **control layer**. The automation layer (queue + auto-generate-on-lead-submit) is **WGE-2**, a separate spec built afterward. Settings that WGE-2 needs are created and stored in WGE-1 but remain inert until WGE-2.

---

## 1. Problem & Goal

Phase 4 shipped two website generators (WebCraft, DeepSeek). Everything that drives them is **hardcoded**: the prompt template (incl. the full CSS design system) lives in `lib/ai-tools/prompt.ts`, and the lead→form field mapping lives in `lib/ai-tools/leadPrefill.ts`. Changing any of it requires a code edit and redeploy.

**Goal:** a single admin-facing control center — **WGE Control** — where the prompt, the field mappings, and the engine settings are all editable from the UI and persisted in the database. Nothing about generation should be hardcoded. The generators read their behavior from this config.

Out of scope here (→ WGE-2): the serial queue, headless server-side generation, and auto-generate-on-lead-submit.

## 2. Approach

**DB-backed config + a generic template engine** (chosen over: editing repo JSON from the UI — hacky, breaks across environments; or keeping the prompt in code and exposing only settings — fails the core ask).

A single `wge_config` row holds the editable prompt, variable/mapping definitions, and engine settings. `buildPrompt` and `mapLeadToInput` are refactored into thin wrappers that read this config. The **seeded default config reproduces today's exact prompt and mapping**, so generation output is byte-identical until someone edits it — the refactor is behavior-preserving.

## 3. Permissions

- New permission **`wge.manage`**, category **`ai_tools`**, `is_sensitive: true`. Assignable to any user/department through the existing Permissions grid — *not* hardcoded to admin.
- **Dependency rule:** WGE Control is only meaningful with AI Tools access. Access requires `wge.manage` **AND** at least one of `ai_tools.webcraft` / `ai_tools.deepseek`. Enforced in three layers:
  1. Sidebar nav (item hidden unless both conditions hold).
  2. `/ai-tools/wge` page guard — redirect to `/ai-tools` (or `/dashboard`) otherwise.
  3. WGE config API routes — `403` otherwise.
- Editing WGE config affects **everyone's** generations; the `is_sensitive` flag surfaces the warning styling in the grid. Granting the permission remains the admin's decision.
- Seed: grant `wge.manage` to the same departments that already hold `ai_tools.*` (e.g. `tech`); `management` may view/manage per admin preference. (Exact seed mapping decided in the plan; default: `tech` only.)

## 4. Data Model

### `wge_config` (singleton)
A single active row (enforced by a fixed primary key / `singleton boolean unique default true`).

| column | type | notes |
|---|---|---|
| `id` | uuid pk | fixed singleton |
| `system_prompt` | text | the model's system message |
| `prompt_template` | text | the user-message template with `{{placeholders}}` |
| `variables` | jsonb | array of variable definitions (see below) |
| `settings` | jsonb | engine + automation settings (see below) |
| `updated_at` | timestamptz | |
| `updated_by` | uuid → profiles | nullable |

**`variables[]`** — each entry:
```jsonc
{
  "key": "name",              // referenced as {{name}} — keys match today's GenInput
  "label": "Business name",   // form + WGE label
  "type": "text",             // text | textarea | number | list
  "fallback": "(not provided)", // used when value empty (also overridable inline in template)
  "lead_column": "business_name", // source column on leads, or null (no auto-map)
  "join": ", "                // for list types from array columns: ", " or "\n"
}
```
> Default variable keys mirror the current `GenInput` fields (`name`, `phone`, `email`, `services`, `exp`, `profile`, `pages`, `pageNames`, `google`, `map`, `hero`, `logo`, `serviceImgs`, `imgs`, `color`, `r1`–`r4`, `extra`) so the default template's `{{name}}` etc. stay byte-identical to today.

**`settings`** (jsonb):
```jsonc
{
  "provider": "deepseek",       // default engine for the generator UI
  "model": "deepseek-chat",
  "max_tokens": 8192,
  "temperature": 0.7,
  "default_pages": 5,
  "auto_download": false,       // generator auto-triggers ZIP after a run
  // --- stored now, consumed by WGE-2 ---
  "auto_generate": false,       // master auto-gen switch
  "auto_engine": null,          // provider/model for headless runs; null = "set later"
  "ready_required": ["name", "services", "pages"] // "ready enough" threshold
}
```

RLS: `select` for authenticated users who can use AI tools; `update` only via service role behind the `wge.manage` API guard. (Reads also fine for the generator. We keep one row; no insert/delete from clients.)

### Default config (seed)
A new migration seeds the singleton row from constants derived from today's code:
- `system_prompt` = current `SYSTEM_PROMPT`.
- `prompt_template` = current `buildPrompt` body with `${d.x}` → `{{x}}` and the `|| '(not provided)'` fallbacks converted to `{{x|(not provided)}}`. Derived bits (`${refs.length || 4}`, `${pnames}`) map to derived variables (§5).
- `variables` = the current `GenInput` fields + their `mapLeadToInput` source columns.
- `settings` = current generator defaults.

## 5. Template Engine — `lib/ai-tools/template.ts`

- `renderTemplate(template: string, context: Record<string,string>): string`
  - Replaces `{{key}}` with `context[key]` (empty string if missing).
  - Replaces `{{key|fallback text}}` with `context[key]` if non-empty, else the literal `fallback text`.
  - Unknown keys with no inline fallback render empty (and are reported by a lint helper in the UI, not at runtime).
- `buildContext(values, config)` assembles the substitution context:
  - One entry per variable key from the form values (arrays already joined per the variable's `join`).
  - **Derived variables** computed in code and added to the context:
    - `references` — newline-joined non-empty reference URLs (`r1..r4`).
    - `ref_count` — count of provided references (or `4` fallback, matching current behavior).
    - `page_names` — `pageNames` if set, else the default page list for `pages` (today's `defaultPages`).
- `listTemplateVars(template)` — returns the set of `{{keys}}` used, for the UI "unmapped variable" warnings.

Refactors:
- `buildPrompt(values, config)` → `renderTemplate(config.prompt_template, buildContext(values, config))`.
- `mapLeadToInput(lead, config)` → builds form values by reading each `variable.lead_column` off the lead (joining arrays per `variable.join`).
- The generator imports config (fetched server-side, passed to the client component) rather than the static constants.

**Parity requirement:** rendering the default config for a representative input must equal the output of the pre-refactor `buildPrompt`. Covered by a unit test (§8).

## 6. Config Loading

- `lib/ai-tools/wge.ts`: `getWgeConfig()` (server) reads the singleton row via the server client, with an in-code default fallback if the row is somehow missing (defensive — never crash the generator).
- Server components (generator pages, WGE page) load config and pass the needed parts to client components.
- `GET /api/ai-tools/wge` — returns config (auth + AI-tools access).
- `PUT /api/ai-tools/wge` — validates (Zod) and updates the singleton (auth + `wge.manage` + AI-tools dependency). Logs to `activity_log` (`wge.config.updated`).
- `POST /api/ai-tools/wge/reset` — restores the seeded default config (same guard).

## 7. UI — `/ai-tools/wge`

New route under the AI Tools section, gated per §3. Three tabs (client component, RHF-free controlled state matching existing patterns; save via the PUT route; inline success/error messages consistent with the rest of the app):

1. **Prompt Studio**
   - System-prompt editor + template editor (mono textareas).
   - "Available variables" reference: chips for every variable key + the derived ones, each insertable at the cursor. Warns about `{{keys}}` in the template that aren't defined.
   - **Test render**: pick a real lead → shows the assembled prompt (calls a render helper; read-only).
2. **Variables & Mapping**
   - Editable table: key, label, type, fallback, lead column (select of `leads` columns), join rule. Add/remove rows. Key validated (snake_case, unique).
3. **Engine Settings**
   - provider, model (from `TOOLS`), max tokens, temperature, default pages, auto-download.
   - Automation block (auto_generate switch, auto_engine, ready_required multiselect) rendered but badged **"Used by automation — WGE-2"** so it's visible/storable but clearly not yet active.
   - **Reset to defaults** button (confirm dialog).

Sidebar: add `{ href: "/ai-tools/wge", label: "Engine (WGE)", perms: [...] }` with the dependency check.

## 8. Generator Refactor

- Generator form fields render from `config.variables` (type-aware inputs) instead of the static `FIELDS` array. Prefill from a lead uses config-driven mapping.
- Prompt build uses `renderTemplate`. Provider/model/tokens/temp/default-pages default from `config.settings` (still per-run overridable in Step 2). `auto_download` honored after a successful run.
- No change to the generate/save API routes or the streaming/parse/storage pipeline.

## 9. Error Handling

- Missing/corrupt config row → fall back to in-code defaults; surface a non-blocking banner in WGE ("using built-in defaults — save to persist").
- Invalid config on save → `422` with field issues; UI shows them inline; nothing persisted.
- Template referencing an undefined variable → renders empty + UI warning; never throws at generation time.
- WGE access without the AI-tools dependency → guard redirects / `403`.

## 10. Testing

- `renderTemplate`: substitution, inline fallback, missing key, multiple occurrences, fallback containing `|`.
- `buildContext`: array joins, derived `references`/`ref_count`/`page_names`.
- Config-driven `mapLeadToInput`: maps configured columns, respects join rules, null `lead_column` skipped.
- **Parity test**: default config + sample input renders identically to the captured legacy `buildPrompt` output.
- Zod config schema: rejects bad variable keys, unknown types, out-of-range settings.
- (Build green + existing 49 tests stay green.)

## 11. Deferred to WGE-2 (next spec)

- `wge_queue` table; enqueue on lead create (when `auto_generate` and the lead meets `ready_required`).
- Serial processor with a single-run lock; headless server-side generation (non-streamed) → parse → storage → `ai_generations`, reusing the existing save logic.
- Queue-status UI (pending/processing/done/failed; cancel/retry); completion notifications via the existing bell.
- Uses the `settings.auto_*` values already stored by WGE-1.

## 12. Out of Scope

- Prompt version history / rollback (single editable row only; reset-to-default covers the safety net).
- Per-tool separate prompts (one shared template for both engines, as today).
- Multi-config / A-B prompts.
