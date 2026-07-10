# Phase 1 — Icons + Sidebar 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Replace every emoji/symbol glyph with a lucide icon, and turn the sidebar into a sticky collapsible icon-rail that hover-expands, auto-collapses after 5s, and can be pinned open (persisted per-account).

**Architecture:** `lucide-react` (already installed) everywhere. Sidebar keeps its permission-filtered nav data but gains per-item icons + a rail/expanded width toggle driven by `pinned || hovering`; pinned persists to a new `profiles.ui_preferences` JSONB via `PATCH /api/me/preferences`, seeded server-side into the shell so first paint matches. `AppShell` becomes a client shell owning mobile-overlay state.

**Tech Stack:** Next 16 App Router, lucide-react, Supabase (migration 0023), Tailwind tokens.

**Env:** work in `D:/sed-lms-v2` only (never `D:/Old LMS Dashboard/sed-lms`); branch `ux-icons-sidebar`; `npx tsc --noEmit`, `npm run build`, `npx vitest run`; commits end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Group A — DB + preferences plumbing (controller applies migration via Supabase MCP)

### Task A1: migration 0023 (ui_preferences)
- Create `supabase/migrations/0023_ui_preferences.sql`:
```sql
-- Per-user UI preferences (sidebar pin, and future density/theme/default-sort).
alter table public.profiles
  add column if not exists ui_preferences jsonb not null default '{}'::jsonb;
```
- Mirror in `supabase/seed.sql` (add the column to the profiles create/alter section if present; else append the same `alter`).
- **Controller** applies it to project `ikuvbxjkoojtgekapbul` via Supabase MCP `apply_migration` (name `0023_ui_preferences`).

### Task A2: `PATCH /api/me/preferences`
- Create `app/api/me/preferences/route.ts` — mirror `app/api/account/route.ts` auth pattern:
```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED = new Set(["sidebarPinned"]); // extend as prefs grow

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body ?? {})) if (ALLOWED.has(k)) patch[k] = v;
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const { data: row } = await admin.from("profiles").select("ui_preferences").eq("id", user.id).single();
  const merged = { ...((row?.ui_preferences as Record<string, unknown>) ?? {}), ...patch };
  const { error } = await admin.from("profiles").update({ ui_preferences: merged }).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, ui_preferences: merged });
}
```

### Task A3: layout reads prefs → shell
- In `app/(app)/layout.tsx`, extend the profile select to `"display_name, ui_preferences"`, derive `const sidebarPinned = (profile?.ui_preferences as { sidebarPinned?: boolean } | null)?.sidebarPinned ?? false;` and pass `sidebarPinned={sidebarPinned}` into `<AppShell …>`.

---

## Group B — Emoji / glyph → lucide sweep
Mechanical, one commit. For each, import the icon from `lucide-react` and keep placement/size/color. Full inventory (from grep):
- `components/layout/BellBase.tsx:137` — empty state `🎉` → stacked `Inbox` (w-6 h-6 text-text-faint) above "You're all caught up."
- `components/ai-tools/Generator.tsx` — `⚡ Generate website`→`Zap`; `↻ Rebuild`→`RotateCw`; `← Back`→`ArrowLeft`; `Build prompt →`→trailing `ArrowRight`; `↓ Download ZIP`→`Download`; `✓ {n} page(s)`→leading `CheckCircle2`.
- `components/leads/LeadsTable.tsx` — `↓ Export CSV`→`Download`; sort `↑/↓` map → `ArrowUp`/`ArrowDown` (fallback `ChevronsUpDown`).
- `components/preleads/PreLeadsTable.tsx`, `components/ai-tools/GenerationsTable.tsx` — same sort-indicator swap.
- Form-error `⚠` → `AlertTriangle` (w-3.5 h-3.5, inline) in: `components/forms/Field.tsx`, `components/forms/formShell.tsx`, `components/detail/FieldRow.tsx`, `components/payments/PaymentLinkModal.tsx` (×3), `components/leads/NewLeadForm.tsx` (×4), `components/preleads/AddPreLeadForm.tsx` (×4).
- `✕`/`✕ Remove` → `X` in: `components/forms/DynamicList.tsx`, `components/tickets/TicketModal.tsx`, `components/layout/WorldClocks.tsx`.
- Inline `✓` success → leading `Check` in `components/payments/PaymentLinksBoard.tsx` ("Copied"), `components/leads/LeadDetail.tsx` ("Queued").
- `←` back-link char in `app/(app)/admin/users/[id]/page.tsx`, `app/(app)/admin/departments/[id]/page.tsx`, `app/(app)/ai-tools/generations/[id]/page.tsx` → `ArrowLeft` (Phase 2 will make these history-aware; here just de-glyph).
- **Leave:** `⌘K`/`↑↓`/`↵` keycap hints in `CommandPalette.tsx` (keyboard labels), and `→` inside log/prose strings (`"name → status"`, docs copy) — those are data/content, not chrome.
- **Verify:** re-run the emoji grep; only keycap/prose matches should remain.

---

## Group C — Sidebar 2.0 (icon rail, sticky, hover-expand, 5s auto-collapse, pin, mobile overlay)

### Task C1: per-item icons + collapsible rail — rewrite `components/layout/Sidebar.tsx`
- Add `icon: LucideIcon` to each nav item. Icons: Dashboard `LayoutDashboard`, Leads `Building2`, Follow-ups `PhoneCall`, Tickets `Ticket`, By Agent `BarChart3`, Feedback `MessageSquareText`, Payments `CreditCard`, Notifications `Bell`; Pre-Leads Overview `LayoutList`, All Pre-Leads `ListChecks`; AI Overview `Sparkles`, WebCraft `Globe`, DeepSeek `Bot`, Analytics `LineChart`, Engine (WGE) `Cog`; Admin Users `Users`, Departments `Building`, Permissions `ShieldCheck`, Activity Log `ScrollText`, Import `Upload`, Add-ons `Blocks`, Notifications `BellCog`.
- Props: `{ branding, initialPinned, mobileOpen, onMobileClose }`. State: `const [pinned,setPinned]=useState(initialPinned); const [hovering,setHovering]=useState(false); const timer=useRef<ReturnType<typeof setTimeout>|null>(null);` `const expanded = pinned || hovering;`
- Hover: `onMouseEnter`→`{ if(timer.current) clearTimeout(timer.current); setHovering(true); }`; `onMouseLeave`→`{ timer.current=setTimeout(()=>setHovering(false),5000); }` (cleanup on unmount). Skip auto-collapse while pinned.
- Pin toggle (header, top-right): lucide `Pin`/`PinOff` button → `const next=!pinned; setPinned(next); setHovering(false); fetch("/api/me/preferences",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({sidebarPinned:next})}).catch(()=>{});`
- Widths: `expanded ? "w-60" : "w-16"`, `transition-[width] duration-200`, sticky `sticky top-0 h-screen self-start overflow-y-auto overflow-x-hidden`. Desktop only (`hidden md:flex`).
- `renderItem`: always render `<Icon className="w-[18px] h-[18px] shrink-0" />`; label `<span>` shown only when `expanded` (else `title={label}` for tooltip). Active keeps `bg-accent-soft text-accent-ink`; remove the dot bullet.
- Section headers render only when `expanded` (collapsed: a 1px `border-t border-border my-1` divider instead).
- **Mobile overlay:** when `mobileOpen`, also render a fixed slide-over (`fixed inset-y-0 left-0 w-60 z-50 md:hidden` always-expanded) + a `fixed inset-0 bg-black/40 z-40 md:hidden` backdrop calling `onMobileClose`. (Simplest: a second render branch; share `renderItem` with `expanded=true`.)

### Task C2: `AppShell` client shell + mobile toggle
- Convert `components/layout/AppShell.tsx` to `"use client"`; accept `sidebarPinned: boolean` in addition to existing props. Hold `const [mobileOpen,setMobileOpen]=useState(false);`. Render `<Sidebar branding={branding} initialPinned={sidebarPinned} mobileOpen={mobileOpen} onMobileClose={()=>setMobileOpen(false)} />`, `<Topbar … onMenu={()=>setMobileOpen(true)} />`, `<main className="flex-1 p-6 min-w-0">{children}</main>`. Root stays `<div className="min-h-screen flex">`.
- `components/layout/Topbar.tsx`: add optional `onMenu?: () => void`; render a `md:hidden` hamburger (`Menu` icon) button at the far left (before CommandPalette) calling `onMenu`.
- `app/(app)/layout.tsx`: pass `sidebarPinned` (from Task A3) into `<AppShell>`.

---

## Verification (controller)
- `npx tsc --noEmit` clean; `npm run build` succeeds (ignore known middleware/proxy warning); `npx vitest run` stays green.
- Live (Chrome, localhost:3000): emoji grep clean (only keycap/prose left); sidebar shows icons, collapses to rail, hover→expands, leave→collapses after 5s, pin keeps it open and **survives reload** (and re-login); mobile width → hamburger opens overlay, backdrop closes; the `🎉`-free notifications empty state shows an icon.
- Merge `ux-icons-sidebar` → main (ff), push. Prod needs hPanel redeploy (note, don't do).

## Self-review coverage
Icons sweep → Group B · sidebar icons+rail+hover+pin+mobile → Group C · pin persistence (migration+API+layout) → Group A · testing → Verification.
