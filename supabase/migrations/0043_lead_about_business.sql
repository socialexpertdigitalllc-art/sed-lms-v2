-- 0043_lead_about_business.sql — free-text background on the client's business.
-- ADDITIVE ONLY. Shared prod DB: `add column if not exists` only.
-- No drops, no type changes, no edits to existing columns.
--
-- Optional long text captured by the salesperson (history, specialities, what
-- makes them different, service-area notes). Fed to the website generator's
-- brief so the content planner has richer SUPPLIED facts to draw on — it never
-- licenses invention, it only widens what is already known.
alter table public.leads add column if not exists about_business text;
