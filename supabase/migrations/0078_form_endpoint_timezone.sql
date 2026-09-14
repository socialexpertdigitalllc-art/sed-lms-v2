-- 0078: per-endpoint email timezone for the form relay.
-- NULL = automatic (lead's area-derived zone, falling back to Eastern).
alter table public.form_endpoints
  add column if not exists timezone text;
