-- 0090_assistant_permission_modes.sql — Act mode's permission modes: how much
-- SED AI may do without a click (lib/assistant/actions/permissions.ts).
-- ADDITIVE ONLY (shared prod DB): new columns with defaults, no drops.
--
-- Each person's own mode and "don't ask again" list live in
-- profiles.ui_preferences.assistantPermissions (no schema change needed).

-- Per action: false = it always waits on its card, whatever a person's mode.
alter table public.assistant_action_settings
  add column if not exists auto_run boolean not null default true;

-- The most autonomy anyone may pick: 'ask' (nothing runs on its own),
-- 'auto_safe' (safe changes may), 'auto' (all but high-impact may).
-- High-impact changes and anything needing an approver always ask.
alter table public.app_settings
  add column if not exists assistant_max_permission_mode text not null default 'auto'
    check (assistant_max_permission_mode in ('ask', 'auto_safe', 'auto'));
