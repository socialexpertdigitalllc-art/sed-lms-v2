# SED LMS v2 — Polish 6: sticky modals, bulk tagging, user-scoped tags + sharing

**Date:** 2026-07-14 · **Branch:** `polish-6` (off main @ 9ebb05b) · Groups 1 (modals) → 2 (user-scoped tags + sharing) → 3 (bulk tag). Sequential. Next migration = **0033**.

---

## Group 1 — Modals close only via Cancel, not backdrop click
Every popup MODAL must stop closing on background/overlay click — only its Cancel/close (X) button closes it. (Prevents losing form input on a stray click.)
- The 11 modals: `components/leads/{StatusChangeModal,FollowUpModal,FollowUpLogModal,FollowUpDetailModal,DeleteLeadModal}.tsx`, `components/preleads/FollowUpModal.tsx`, `components/admin/{NewDepartmentForm,UserManager,CreateUserDialog}.tsx`, `components/tickets/TicketModal.tsx`, `components/payments/PaymentLinkModal.tsx`.
- In each, the overlay `<div className="fixed inset-0 …" onClick={onClose|onCancel|setOpen(false)…}>` — **remove that backdrop `onClick` handler** (whatever the close call is). Leave the inner panel's `onClick={(e)=>e.stopPropagation()}` (now a harmless no-op) OR remove it too — either is fine. Keep every Cancel/X button working. Do NOT change any other behavior. Keep `role="dialog" aria-modal="true"` where present.
- Also grep `components/` for any other overlay with `fixed inset-0` + a click-to-close that is a true modal (has a Cancel/Save footer) and apply the same; leave click-outside DROPDOWNS/popovers (TagFilter, RegionFilter, ColumnsMenu, SavedViews, bells) untouched — those SHOULD close on outside click.

---

## Group 2 — Tags become user-scoped, with admin sharing + view-all (permission-guarded)
Today tags are a GLOBAL catalog: every `leads.tags.view` user sees every tag on every lead. New model: **each user owns their tags; a user sees only their own by default.** Two admin capabilities, each its own permission:
- **See everyone's tags** → `leads.tags.view_all` (sensitive).
- **Share my tags with a department or user** → `leads.tags.share` (sensitive) + a shares table + UI.

### 2.1 Migration `0033_user_scoped_tags.sql`
- `lead_tags`: `add column owner_id uuid references profiles(id) on delete cascade;` → backfill `update lead_tags set owner_id = created_by;` → `alter column owner_id set not null;`. Drop the global name unique (`alter table lead_tags drop constraint lead_tags_name_key;` — verify the constraint name via `\d`; it's the `unique(name)`) and add `unique(owner_id, name)`.
- `lead_tag_shares` (NEW): `id uuid pk default gen_random_uuid()`, `owner_id uuid not null references profiles(id) on delete cascade` (whose tags), `target_type text not null check (target_type in ('user','department'))`, `target_id uuid not null` (profile or department id), `created_by uuid references profiles(id) on delete set null`, `created_at timestamptz default now()`, `unique(owner_id, target_type, target_id)`. Index on `owner_id`.
- Permissions (0029 pattern): `('leads.tags.view_all','View All Users'' Tags','See every user''s tags on leads, not just your own','leads',true)`, `('leads.tags.share','Share Tags','Let chosen departments/users see your tags on leads','leads',true)`. Grant both to `admin` only (admin extends via grid).
- RLS helper:
```sql
create or replace function public.can_see_user_tags(owner uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select owner = auth.uid()
    or public.has_permission('leads.tags.view_all')
    or exists (
      select 1 from public.lead_tag_shares s
      where s.owner_id = owner and (
        (s.target_type = 'user' and s.target_id = auth.uid())
        or (s.target_type = 'department' and exists (
          select 1 from public.department_members dm
          where dm.user_id = auth.uid() and dm.department_id = s.target_id))
      ));
$$;
```
- Replace the four existing tag policies (drop `"read lead tags"`,`"write lead tags"`,`"read lead tag links"`,`"write lead tag links"`), new ones:
  - `lead_tags` SELECT: `(has_permission('leads.tags.view') or has_permission('leads.tags.manage')) and can_see_user_tags(owner_id)`.
  - `lead_tags` ALL: `using (owner_id = auth.uid() and has_permission('leads.tags.manage')) with check (owner_id = auth.uid() and has_permission('leads.tags.manage'))`.
  - `lead_tag_links` SELECT: `(view or manage) and exists (select 1 from lead_tags t where t.id = tag_id and can_see_user_tags(t.owner_id))`.
  - `lead_tag_links` ALL: `using (has_permission('leads.tags.manage') and exists (select 1 from lead_tags t where t.id = tag_id and t.owner_id = auth.uid())) with check (same)`.
- `lead_tag_shares` RLS: SELECT `using (owner_id = auth.uid() or has_permission('leads.tags.view_all') or has_permission('leads.tags.share'))`; ALL `using (owner_id = auth.uid() and has_permission('leads.tags.share')) with check (same)`.
- Add all 4 keys already? Only the 2 NEW keys go in `lib/permissions/constants.ts` (view/manage already there): `leads.tags.view_all`, `leads.tags.share` (category leads, sensitive).

### 2.2 Types + `owner`/`mine` plumbing
- `lib/leads/types.ts` `LeadTag`: add `owner_id: string`. (Optional `mine?: boolean` if convenient.)
- Wherever the catalog is loaded/passed, also pass the current `userId` so the UI can tell "mine" (appliable) from "visible-only" (filter/read).

### 2.3 API (all: switch tag reads to the RLS USER client so scoping applies)
- `app/api/tags/route.ts`:
  - GET → **use the user client** (not admin): `supabase.from("lead_tags").select("id,name,color,owner_id").order("name")` (RLS returns only visible). Also return the caller's `userId` (so the client marks `mine`). Keep the `leads.tags.view|manage` gate.
  - POST → set `owner_id: user.id` (+ created_by). Dupe now per-owner (23505 → "You already have a tag with that name.").
- `app/api/tags/[id]/route.ts` PATCH/DELETE: keep `leads.tags.manage`, AND verify ownership — load the tag; if `owner_id !== user.id` → 403 "You can only edit your own tags." (Even though RLS blocks it, the route uses admin client, so add the explicit check.)
- `app/api/leads/[id]/tags/route.ts` PUT: now replaces **only the caller's own** tags on the lead.
  - Validate every incoming `tagIds` is owned by the caller (load `lead_tags` where `id in tagIds and owner_id = user.id`; if count mismatch → 422 "You can only apply your own tags.").
  - Delete only the caller's links: `admin.from("lead_tag_links").delete().eq("lead_id", id).eq("added_by", user.id)` — leaves other users' tags on the lead intact. Then insert with `added_by: user.id`.
- **`app/api/tags/shares/route.ts` (NEW)**: gate `leads.tags.share`. GET → `{ shares, departments, users }` (my shares = `lead_tag_shares where owner_id=user.id`; departments = active depts; users = active profiles excluding self — via admin client). POST `{target_type, target_id}` → insert `(owner_id:user.id, target_type, target_id, created_by:user.id)` (on-conflict ignore). DELETE `?id=` → delete where id and owner_id=user.id.

### 2.4 UI
- `components/leads/TagFilter.tsx`: unchanged filter behavior (RLS already scopes the `tags` prop to visible). The inline "create/delete" stays but delete only shows for tags where `owner_id === userId` (pass `userId` prop). Add a "Manage tag sharing" button when `canShare` → opens `TagSharingModal`.
- **`components/leads/TagSharingModal.tsx` (NEW)**: a modal (NO backdrop-close, per Group 1) that fetches `/api/tags/shares` and lists Departments + Users each with a toggle "can see my tags" → POST/DELETE. Section headers, search optional. Gate render on `canShare`.
- `components/leads/LeadDetail.tsx` tags SectionCard: the removable/editable chips + the "add tag" dropdown must be limited to the caller's OWN tags (`allTags.filter(t => t.owner_id === currentUserId)`); other users' tags currently on the lead that the viewer can see (via view_all/shares) render as **read-only** chips (optionally with a small owner hint). Pass `currentUserId` in from the page loader. Keep `canManageTags` gating for editing.
- `components/leads/LeadsTable.tsx`: chips + filter already RLS-scoped; add `canShareTags`/`currentUserId` passthrough only if TagFilter needs it (it does, for the delete-own + share button). Wire `canShareTags` from perms in `app/(app)/leads/page.tsx`.
- Loaders `app/(app)/leads/page.tsx` + `app/(app)/leads/[id]/page.tsx`: select `owner_id` on the catalog; pass `currentUserId={user.id}` and `canShareTags={perms.has("leads.tags.share")}` down. (leads/page already loads perms + user for tags.)

### 2.5 Tests
`tests/tags.test.ts`: extend — a pure `ownTags(tags, userId)` filter + `canApplyTag(tag, userId)` helper in `lib/leads/tagFilter.ts`, used by LeadDetail/BulkTag. Cover own-vs-others.

---

## Group 3 — Bulk-select tagging
Apply the caller's own tags to many selected leads at once (ADD, not replace — never wipes existing tags).
- `app/api/leads/bulk/route.ts`: extend the `action` enum with `"tag"`; `PERM.tag = "leads.tags.manage"`. For `action==="tag"`: `value` = comma-joined tag ids. Validate all are the caller's own tags (owner_id=user.id) else 422. For the selected `ids` × tagIds, upsert `lead_tag_links` `(lead_id, tag_id, added_by:user.id)` with `onConflict: "lead_id,tag_id", ignoreDuplicates: true` (don't touch the `leads` table for this action — it's a link insert, so branch before the `leads.update`). activity_log `lead.bulk_tag`.
- `components/leads/BulkActionBar.tsx`: add a "Tag" control (a small dropdown/popover of the caller's OWN tags with checkboxes + "Apply") shown when `can.tag`. Props: add `tags: LeadTag[]` (own tags) + `can.tag: boolean`. On apply → `run("tag", selectedTagIds.join(","))`. Style consistent with the existing status/assign selects.
- `components/leads/LeadsTable.tsx`: pass `can={{ …, tag: canManageTags }}` and the caller's own tags to `<BulkActionBar>`; extend `canBulk` to include `canManageTags` so the bar shows for taggers.

---

## Gates & rollout
Per group: subagent `npx tsc --noEmit` + `npx vitest run` green (NO build per group). Controller applies migration 0033 via MCP, runs final `npm run build`, ff-merges → main, pushes. Live-verify deferred. Prod needs hPanel redeploy.
