-- 0052_studio_permission.sql — seed the studio.manage permission row.
--
-- THE BUG THIS FIXES. Phase 2a added `studio.manage` to the PERMISSIONS array
-- in lib/permissions/constants.ts and assumed that was enough, because the
-- runtime grant tables (department_permissions, user_permission_overrides)
-- store bare key strings and the resolver never joins to a catalogue.
--
-- It is NOT enough. The admin Permissions page (app/(app)/admin/permissions/
-- page.tsx) and the department grant UI both read `public.permissions` — the
-- DB table — so a key that exists only in the TypeScript constant is invisible
-- in the admin UI and therefore ungrantable through it. The operator went
-- looking for "Manage Site Studio", found nothing, and was correctly stuck.
--
-- The code constant and this table are two separate catalogues that must be
-- kept in step; every prior feature seeded its keys the same way (see 0026's
-- templates.* block, 0011's category permissions). This migration does that for
-- Site Studio.
--
-- Idempotent: on conflict do nothing, so re-running is safe.
insert into public.permissions (key, name, description, category, is_sensitive) values
  (
    'studio.manage',
    'Manage Site Studio (Template Engine v3)',
    'Upload, compile, review and certify Site Studio template packages.',
    'templates',
    true
  )
on conflict (key) do nothing;
