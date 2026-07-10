# SED LMS v2 — Leads/Status/Departments polish

**Date:** 2026-07-10 · **Branch:** `leads-dept-polish` (off main @ 3c5313d) · **Status:** approved ("build it" + tweaks; Closing dept starts empty)

Five related refinements. Migration 0027 (Closing dept) already applied.

## 1. Inline Ready-link modal (single-lead status change)
`components/leads/StatusChangeModal.tsx`: add prop `websiteLink: string | null`. When selected status === "Ready" AND `!websiteLink?.trim()`, render a **required** URL input (placeholder `https://…`, label "Website link (required for Ready)"). On Update: if Ready and no existing link, send `{ status: "Ready", website_link: <entered> }`; else send `{ status }` as now. Disable Update until the link is filled in that case. Thread `websiteLink={lead.website_link}` from every opener: `components/leads/LeadsTable.tsx` (the Status action → `modalLead`) and `components/leads/LeadDetail.tsx` (wherever it renders StatusChangeModal). 
- **API** `app/api/leads/[id]/route.ts`: the perm gate currently treats only a lone `status` key as a status change (`leads.status_change`); a `{status, website_link}` body falls to `leads.edit`. Relax it: if the body keys are a subset of `{status, website_link}` AND status is present, require `leads.status_change` (the mandatory Ready link is part of setting the status). Keep the existing Ready-guard 422 handling.

## 2. Bulk "Delete" (rename Archive)
`components/leads/BulkActionBar.tsx`: rename the **Archive** button/label to **Delete** (same `run("archive")` soft-delete, still gated `can.archive`); update the confirm to `Delete N lead(s)? This removes them from the pipeline (recoverable by an admin).`. No API change (bulk `archive` already soft-deletes via deleted_at; single-lead Delete is the same soft-delete). Prop name `can.archive` stays.

## 3. Bulk assign restricted to Sales members
- The leads list page (`app/(app)/leads/page.tsx` — the server component rendering LeadsTable) must load **Sales-department members** (slug `sales`, the `department_members` + `profiles!department_members_user_id_fkey` join, mirror `app/(app)/leads/new/page.tsx` lines 28-42) and pass `salesAgents: {id:string; name:string}[]` down to LeadsTable → BulkActionBar.
- `BulkActionBar`: add prop `salesAgents`; the **Assign to…** dropdown lists `salesAgents` (id→name) + the "Unassigned" option, NOT `agentNameById` (keep `agentNameById` only for Export). 
- **API** `app/api/leads/bulk/route.ts` `assign` action: when `value` (agent_id) is non-empty, verify it belongs to a `department_members` row for the Sales department; else 422 `{error:"Leads can only be bulk-assigned to Sales department members."}`. (Unassign — empty value — always allowed.)

## 4. "Closed by" → Closing department
`app/(app)/leads/new/page.tsx`: change the `salesDept` lookup from slug `'sales'` to slug **`'closing'`** (rename the local vars `salesDept`→`closingDept`, `salesUsers`→`closingUsers`); pass to `NewLeadForm` as the same prop it already consumes for the Closed-by picker (keep the prop name the form expects — READ `NewLeadForm.tsx` to see the prop; it's `salesUsers` — either keep that prop name fed by closing members, or rename both sides). Simplest: keep the form prop name, feed it Closing members. (Closing starts empty → picker empty until admin adds members; that's expected.)

## 5. Create departments from the departments page
- **API** new `app/api/admin/departments/route.ts` POST (gate `admin.departments.manage`): Zod `{ name: trim 1..60, slug?: trim lowercased [a-z0-9-] (default: slugify(name)), description?: trim ≤200 nullable, color?: hex default '#0D9488', icon?: trim default 'building' }`. Unique-ify slug (`-2`, `-3` on conflict). Insert; `activity_log department.created`. Return `{department}`.
- **UI** `app/(app)/admin/departments/page.tsx`: gate a **"New department"** button (perms `admin.departments.manage` — page is server; compute `canManage` via getUserPermissions and pass to a client `NewDepartmentButton`/form). New `components/admin/NewDepartmentForm.tsx` (client): a small inline card/modal with name + description + color inputs → POST → toast + `router.refresh()`. Match design tokens; lucide icons; no emojis.

## Notes
- Bulk-setting Ready on link-less leads still errors (batch op, no per-lead prompt) — out of scope; the inline modal solves the per-lead case.
- New departments start with no members/permissions; admin grants via the existing dept-detail PermissionToggleGrid + (members are added elsewhere — existing flow).
