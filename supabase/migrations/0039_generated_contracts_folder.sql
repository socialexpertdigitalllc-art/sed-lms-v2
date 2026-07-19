-- Generated contracts land in their own Drive folder.
--
-- Without this, copyDoc() creates every generated contract next to the source
-- template, so the admin "Available in Drive" list fills up with contracts.
-- Additive only: null keeps the previous (templates-folder) behaviour.

alter table public.app_settings
  add column if not exists generated_contracts_folder_id text;
