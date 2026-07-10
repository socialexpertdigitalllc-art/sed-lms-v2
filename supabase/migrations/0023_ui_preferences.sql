-- Per-user UI preferences (sidebar pin now; future density/theme/default-sort).
alter table public.profiles
  add column if not exists ui_preferences jsonb not null default '{}'::jsonb;
