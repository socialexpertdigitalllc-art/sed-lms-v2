-- 0084_sed_assistant_name.sql — the AI Assistant is now the SED Assistant.
--
-- FILE ONLY. Do NOT apply — the operator's DB is production; they apply this
-- after review.
--
-- Cosmetic: renames ONE permission's display label so the permission screens
-- match the product name. No schema change; the key (assistant.use) and every
-- grant of it are untouched, so applying this — or not — changes no access.
--
-- Each user's chosen name for their assistant needs no migration: it lives in
-- profiles.ui_preferences.assistantName, like the other per-user UI settings.

update public.permissions
   set name = 'Use SED Assistant',
       description = 'Chat with the SED Assistant about the data you can already see'
 where key = 'assistant.use';
