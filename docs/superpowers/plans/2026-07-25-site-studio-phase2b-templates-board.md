# Site Studio Phase 2b — Templates Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first Site Studio screen an operator sees: one page where a template's whole life happens — drop a zip, watch it compile, review the compiled package side-by-side against the original, run AI enrichment, and certify it. Drives the Phase 2a endpoints; adds no new backend behavior.

**Architecture:** A server page component checks `studio.manage` and renders a client board (repo convention — mirrors `app/(app)/ai-tools/templates/page.tsx`). The board owns the template list and the upload flow; a review drawer owns the per-template review. **The client drives the compile pipeline as discrete steps** (`POST compile` → `POST enrich-identity` → `POST enrich-semantics`), showing progress per step — this is the "client-driven short steps" design from the spec, and it's why no queue exists. Preview is an `<iframe>` pointed at the Phase 2a `/preview` route (sandbox CSP makes the untrusted template inert; `X-Frame-Options: SAMEORIGIN` is why it can be framed at all).

**Tech Stack:** Next.js app-router (this repo's fork), React client components with plain `useState`/`useEffect`/`fetch` (NO SWR/react-query — repo convention), Tailwind semantic tokens, lucide-react icons, vitest for the pure helpers.

**Spec authority:** `docs/superpowers/specs/2026-07-23-site-studio-design.md` §4 (review UI + certification), §5 (Concept 3 — the one-page board). Phase 2a plan (endpoint contracts): `docs/superpowers/plans/2026-07-25-site-studio-phase2a-compile-service.md`.

**Out of scope (recorded):** JS compile-time baking (needs its own phase — the browser-snapshot design); SOP panel (Concept 10, Phase 4); generation launch (Phase 3); preview thumbnails on cards (the drawer renders live previews; card thumbnails would need a screenshot pipeline — not worth it).

---

## Repo UI conventions (verified in live code — follow exactly)

**Page shell** (`app/(app)/ai-tools/templates/page.tsx` is the model):
```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";

export const dynamic = "force-dynamic";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const perms = await getUserPermissions(user.id);
  if (!perms.has("studio.manage")) redirect("/dashboard");
  return <SiteStudioBoard />;
}
```

**Client data flow:** `"use client"`, `useState` + `useCallback` loader + `useEffect` to call it, plain `fetch("/api/...")`, re-`load()` after mutations. No global store.

**Primitives available (use these, do not reinvent):**
- `components/common/buttons.ts` — `btnPrimary`, `btnSecondary`, `btnSecondarySm`, `btnGhostSm`, `iconBtn`, `iconBtnDanger` (class strings, applied to real `<button>`/`<a>`).
- `components/common/Panel.tsx` — `PageHeader({title, description, action})`, `Panel`, `EmptyPanel({icon, title, hint, action})`, `Pill({tone, icon, children})` with tones `ready | notready | dropped | accent | neutral`.
- `components/common/Toast.tsx` — `const { toast } = useToast()`, then `toast({ kind: "success"|"error"|"info", title, body? })`.
- `components/common/EmptyState.tsx` — `EmptyState({icon, title, hint})`.
- `components/forms/Field.tsx` — `inputCls` (input class string).
- `components/common/Select.tsx` — `Select`.
- `components/common/RelativeTime.tsx` — `RelativeTime({ iso, className? })` — note the prop is `iso`, NOT `value`.
- `cn` from `@/lib/utils`.
- Icons from `lucide-react`.
- Modal/overlay idiom (from `components/admin/CreateUserDialog.tsx`): `<div className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4">` wrapping a `bg-surface border border-border rounded-lg` panel with `max-h-[90vh] overflow-auto`.

**Tailwind tokens (semantic — never raw colors):** `bg-surface`, `bg-surface-2`, `text-text`, `text-text-muted`, `text-text-faint`, `border-border`, `bg-accent`, `accent-ink`, `accent-soft`, `ready-bg/fg`, `notready-bg/fg`, `dropped-bg/fg`, `font-display`.

**Sidebar entry** (`components/layout/Sidebar.tsx`): the `AI_TOOLS` array holds `{ href, label, icon, perms: string[] }` items; add one entry.

**Hard rules:** never import from `lib/template-engine/`; do NOT modify the old engine's board/routes; targeted vitest runs (`npx vitest run tests/<file>`), full `npm test` only at the final gate; `NODE_OPTIONS=--max-old-space-size=6144` for tsc/build; commit per task with the exact message; do not push.

**File structure (new):**

```
lib/site-studio/ui/status.ts                  (pure: status → pill tone/label, diagnostic grouping, step state)
components/site-studio/SiteStudioBoard.tsx    (client: list, filters, upload drop-zone, cards, actions)
components/site-studio/TemplateCard.tsx       (client: one card — chips, counts, inline rename, actions)
components/site-studio/ReviewDrawer.tsx       (client: side-by-side previews, diagnostics checklist, enrich, certify)
app/(app)/ai-tools/site-studio/page.tsx       (server: perms gate → board)
components/layout/Sidebar.tsx                 (modified: one nav entry)
tests/siteStudioUiStatus.test.ts              (pure-helper tests)
```

Component split rationale: the board owns *collection* state, the card owns *row* presentation, the drawer owns *review* state. Each stays readable on its own; only the drawer needs the heavier preview/iframe logic.

---

### Task 1: Pure UI helpers (status, diagnostics, steps)

All the logic worth testing, extracted from the components so the components stay presentational.

**Files:**
- Create: `lib/site-studio/ui/status.ts`
- Test: `tests/siteStudioUiStatus.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/siteStudioUiStatus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  statusPill, groupDiagnostics, canCertify, nextStepHint, blockerCount,
} from "@/lib/site-studio/ui/status";
import type { Diagnostic } from "@/lib/site-studio/schema";

const d = (level: Diagnostic["level"], code: string, page?: string): Diagnostic =>
  ({ level, code, message: `${code} message`, ...(page ? { page } : {}) });

describe("statusPill", () => {
  it("maps every status to a tone and label", () => {
    expect(statusPill("uploaded")).toEqual({ tone: "neutral", label: "Uploaded" });
    expect(statusPill("needs_review")).toEqual({ tone: "notready", label: "Needs review" });
    expect(statusPill("certified")).toEqual({ tone: "ready", label: "Certified" });
    expect(statusPill("rejected")).toEqual({ tone: "dropped", label: "Rejected" });
    expect(statusPill("disabled")).toEqual({ tone: "neutral", label: "Disabled" });
  });
});

describe("groupDiagnostics", () => {
  it("splits by level, newest-code-first order preserved within a level", () => {
    const g = groupDiagnostics([d("warn", "a"), d("blocker", "b"), d("info", "c"), d("warn", "e")]);
    expect(g.blockers.map((x) => x.code)).toEqual(["b"]);
    expect(g.warnings.map((x) => x.code)).toEqual(["a", "e"]);
    expect(g.infos.map((x) => x.code)).toEqual(["c"]);
  });
  it("handles null/undefined diagnostics", () => {
    expect(groupDiagnostics(undefined)).toEqual({ blockers: [], warnings: [], infos: [] });
  });
});

describe("blockerCount / canCertify", () => {
  it("certify needs needs_review + a manifest + zero blockers", () => {
    expect(canCertify("needs_review", true, [])).toBe(true);
    expect(canCertify("needs_review", true, [d("warn", "w")])).toBe(true);
    expect(canCertify("needs_review", true, [d("blocker", "b")])).toBe(false);
    expect(canCertify("needs_review", false, [])).toBe(false);
    expect(canCertify("uploaded", true, [])).toBe(false);
    expect(canCertify("certified", true, [])).toBe(false);
  });
  it("counts only blockers", () => {
    expect(blockerCount([d("blocker", "a"), d("warn", "b"), d("blocker", "c")])).toBe(2);
    expect(blockerCount(undefined)).toBe(0);
  });
});

describe("nextStepHint", () => {
  it("tells the operator what to do next from each state", () => {
    expect(nextStepHint({ status: "uploaded", hasManifest: false, diagnostics: [] })).toMatch(/compile/i);
    expect(nextStepHint({ status: "uploaded", hasManifest: false, diagnostics: [d("blocker", "no_pages")] })).toMatch(/blocking/i);
    expect(nextStepHint({ status: "needs_review", hasManifest: true, diagnostics: [] })).toMatch(/review|certify/i);
    expect(nextStepHint({ status: "needs_review", hasManifest: true, diagnostics: [d("blocker", "x")] })).toMatch(/blocking/i);
    expect(nextStepHint({ status: "certified", hasManifest: true, diagnostics: [] })).toMatch(/ready/i);
    expect(nextStepHint({ status: "rejected", hasManifest: true, diagnostics: [] })).toMatch(/rejected/i);
    expect(nextStepHint({ status: "disabled", hasManifest: true, diagnostics: [] })).toMatch(/disabled/i);
  });
});
```

Run: `npx vitest run tests/siteStudioUiStatus.test.ts` — FAIL (module not found).

- [ ] **Step 2: Implement `lib/site-studio/ui/status.ts`**

```ts
import type { Diagnostic } from "../schema";
import type { StudioTemplateStatus } from "../service/types";

export type PillTone = "ready" | "notready" | "dropped" | "accent" | "neutral";

/** Status → pill presentation. One place, so board and drawer never diverge. */
export function statusPill(status: StudioTemplateStatus): { tone: PillTone; label: string } {
  switch (status) {
    case "uploaded": return { tone: "neutral", label: "Uploaded" };
    case "needs_review": return { tone: "notready", label: "Needs review" };
    case "certified": return { tone: "ready", label: "Certified" };
    case "rejected": return { tone: "dropped", label: "Rejected" };
    case "disabled": return { tone: "neutral", label: "Disabled" };
  }
}

export interface GroupedDiagnostics {
  blockers: Diagnostic[];
  warnings: Diagnostic[];
  infos: Diagnostic[];
}

export function groupDiagnostics(diagnostics: Diagnostic[] | null | undefined): GroupedDiagnostics {
  const list = diagnostics ?? [];
  return {
    blockers: list.filter((d) => d.level === "blocker"),
    warnings: list.filter((d) => d.level === "warn"),
    infos: list.filter((d) => d.level === "info"),
  };
}

export function blockerCount(diagnostics: Diagnostic[] | null | undefined): number {
  return (diagnostics ?? []).filter((d) => d.level === "blocker").length;
}

/** Mirrors the certify route's preconditions exactly — the button must not
 *  offer an action the server will refuse. */
export function canCertify(
  status: StudioTemplateStatus,
  hasManifest: boolean,
  diagnostics: Diagnostic[] | null | undefined,
): boolean {
  return status === "needs_review" && hasManifest && blockerCount(diagnostics) === 0;
}

/** One sentence telling the operator what to do next. */
export function nextStepHint(t: {
  status: StudioTemplateStatus;
  hasManifest: boolean;
  diagnostics: Diagnostic[] | null | undefined;
}): string {
  const blockers = blockerCount(t.diagnostics);
  if (blockers > 0) {
    return `${blockers} blocking problem${blockers === 1 ? "" : "s"} — fix the template and compile again.`;
  }
  switch (t.status) {
    case "uploaded": return "Compile this template to turn it into a package.";
    case "needs_review": return "Review the compiled pages, then certify.";
    case "certified": return "Ready to generate sites from.";
    case "rejected": return "Rejected. Re-open it to review again.";
    case "disabled": return "Disabled — certified but withheld from new runs.";
  }
}
```

- [ ] **Step 3: Run test — PASS. Commit**

```bash
git add lib/site-studio/ui/status.ts tests/siteStudioUiStatus.test.ts
git commit -m "feat(site-studio): pure UI helpers for status, diagnostics and next-step hints"
```

---

### Task 2: TemplateCard

One card. Presentational + its own row actions; all data mutation goes through callbacks the board owns.

**Files:**
- Create: `components/site-studio/TemplateCard.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useState } from "react";
import { Check, Cog, FileText, Loader2, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { Pill } from "@/components/common/Panel";
import { btnGhostSm, btnSecondarySm, iconBtn, iconBtnDanger } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { RelativeTime } from "@/components/common/RelativeTime";
import { blockerCount, nextStepHint, statusPill } from "@/lib/site-studio/ui/status";
import type { StudioTemplateListRow } from "@/components/site-studio/SiteStudioBoard";

export function TemplateCard({
  template,
  busy,
  onOpen,
  onCompile,
  onRename,
  onDelete,
}: {
  template: StudioTemplateListRow;
  busy: boolean;
  onOpen: () => void;
  onCompile: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(template.name);
  const [saving, setSaving] = useState(false);

  const pill = statusPill(template.status);
  const blockers = blockerCount(template.diagnostics);
  const pages = template.manifest?.pages?.length ?? 0;

  async function save() {
    const name = draft.trim();
    if (!name || name === template.name) { setEditing(false); return; }
    setSaving(true);
    try {
      await onRename(name);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                className={inputCls}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save();
                  if (e.key === "Escape") { setDraft(template.name); setEditing(false); }
                }}
                disabled={saving}
              />
              <button className={iconBtn} title="Save name" aria-label="Save name" onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </button>
              <button
                className={iconBtn}
                title="Cancel rename"
                aria-label="Cancel rename"
                onClick={() => { setDraft(template.name); setEditing(false); }}
                disabled={saving}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <h3 className="truncate font-medium text-text">{template.name}</h3>
              <button
                className={iconBtn}
                title="Rename template"
                aria-label="Rename template"
                onClick={() => { setDraft(template.name); setEditing(true); }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <p className="mt-1 text-xs text-text-muted">{nextStepHint(template)}</p>
        </div>
        <Pill tone={pill.tone}>{pill.label}</Pill>
      </div>

      <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        <div className="flex items-center gap-1">
          <FileText className="h-3.5 w-3.5 text-text-faint" />
          <dt className="sr-only">Pages</dt>
          <dd>{template.manifest ? `${pages} page${pages === 1 ? "" : "s"}` : "not compiled"}</dd>
        </div>
        {template.manifest ? (
          <div>
            <dt className="sr-only">Version</dt>
            <dd>v{template.version}</dd>
          </div>
        ) : null}
        {blockers > 0 ? <Pill tone="dropped">{blockers} blocking</Pill> : null}
        {template.identity_enriched_at ? <Pill tone="accent" icon={Sparkles}>identity</Pill> : null}
        {template.semantics_enriched_at ? <Pill tone="accent" icon={Sparkles}>semantics</Pill> : null}
        <div className="ml-auto">
          <dt className="sr-only">Uploaded</dt>
          <dd><RelativeTime iso={template.created_at} /></dd>
        </div>
      </dl>

      <div className="flex items-center gap-1.5">
        <button className={btnSecondarySm} onClick={onOpen} disabled={busy}>
          {template.manifest ? "Review" : "Details"}
        </button>
        <button className={btnGhostSm} onClick={onCompile} disabled={busy || template.status === "certified"}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cog className="h-3.5 w-3.5" />}
          {template.compiled_at ? "Re-compile" : "Compile"}
        </button>
        <button
          className={`${iconBtnDanger} ml-auto`}
          title="Delete template"
          aria-label="Delete template"
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

`NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` will FAIL until Task 3 exports `StudioTemplateListRow` — that is expected; this task's commit is fine to land with the type import pending, but if you prefer a green tree per commit, do Task 2 and Task 3 as one commit. Either way, state which you did.

```bash
git add components/site-studio/TemplateCard.tsx
git commit -m "feat(site-studio): template card with inline rename and row actions"
```

---

### Task 3: SiteStudioBoard

Owns the list, the search/filter, the drop-zone upload, and the compile-pipeline driving.

**Files:**
- Create: `components/site-studio/SiteStudioBoard.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutTemplate, Loader2, Search, Upload } from "lucide-react";
import { EmptyPanel, PageHeader } from "@/components/common/Panel";
import { btnPrimary, btnSecondary } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import type { Diagnostic, TemplateManifest } from "@/lib/site-studio/schema";
import type { StudioTemplateStatus } from "@/lib/site-studio/service/types";
import { statusPill } from "@/lib/site-studio/ui/status";
import { TemplateCard } from "@/components/site-studio/TemplateCard";
import { ReviewDrawer } from "@/components/site-studio/ReviewDrawer";

/** The row shape the list endpoint returns (plus manifest, which the detail
 *  endpoint adds — the board keeps whichever it has). */
export interface StudioTemplateListRow {
  id: string;
  name: string;
  status: StudioTemplateStatus;
  version: number;
  niche_tags: string[];
  diagnostics: Diagnostic[] | null;
  manifest?: TemplateManifest | null;
  hasManifest: boolean;
  compiled_at: string | null;
  identity_enriched_at: string | null;
  semantics_enriched_at: string | null;
  certified_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_FILTERS: (StudioTemplateStatus | "all")[] = ["all", "uploaded", "needs_review", "certified", "disabled", "rejected"];

export function SiteStudioBoard() {
  const { toast } = useToast();
  const [rows, setRows] = useState<StudioTemplateListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StudioTemplateStatus | "all">("all");

  // upload
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StudioTemplateListRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/site-studio/templates");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not load templates");
      const list = ((await res.json()).templates ?? []) as Omit<StudioTemplateListRow, "hasManifest">[];
      // the list endpoint omits manifest (it is large); it tells us compiled_at,
      // which is a faithful stand-in for "has a package"
      setRows(list.map((r) => ({ ...r, hasManifest: Boolean(r.compiled_at) })));
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load templates" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.niche_tags.some((t) => t.toLowerCase().includes(q));
    });
  }, [rows, query, statusFilter]);

  function pickFile(f: File | null) {
    setFile(f);
    if (f && !name.trim()) setName(f.name.replace(/\.zip$/i, ""));
  }

  async function upload() {
    if (!file || !name.trim()) {
      toast({ kind: "error", title: "A name and a .zip file are required" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name.trim());
      const res = await fetch("/api/site-studio/templates", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      const id = body.template?.id as string | undefined;
      setName("");
      setFile(null);
      setFileKey((k) => k + 1);
      toast({ kind: "success", title: "Uploaded", body: "Compiling…" });
      await load();
      if (id) await compile(id, { silent: true });
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  /** Deterministic compile. The operator can then run enrichment from the drawer. */
  async function compile(id: string, opts?: { silent?: boolean }) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/site-studio/templates/${id}/compile`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Compile failed");
      await load();
      if (body.ok) {
        if (!opts?.silent) toast({ kind: "success", title: "Compiled", body: "Review it, then certify." });
        setOpenId(id);
      } else {
        toast({ kind: "error", title: "Compiled with blocking problems", body: "Open it to see what to fix." });
      }
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Compile failed" });
    } finally {
      setBusyId(null);
    }
  }

  async function rename(id: string, newName: string) {
    const res = await fetch(`/api/site-studio/templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ kind: "error", title: body.error ?? "Rename failed" });
      return;
    }
    await load();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/site-studio/templates/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Delete failed");
      toast({ kind: "success", title: `Deleted "${deleteTarget.name}"` });
      setDeleteTarget(null);
      await load();
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Delete failed" });
    } finally {
      setDeleting(false);
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Site Studio"
        description="Compile a website template once, certify it, then generate client sites from it forever."
      />

      {/* upload */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) pickFile(f);
        }}
        className={cn(
          "rounded-lg border border-dashed p-4 transition-colors",
          dragging ? "border-accent bg-accent-soft/40" : "border-border bg-surface",
        )}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="studio-name">Template name</label>
            <input
              id="studio-name"
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Plumber Pro"
              disabled={uploading}
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="studio-file">Template .zip</label>
            <input
              id="studio-file"
              key={fileKey}
              type="file"
              accept=".zip,application/zip"
              className={inputCls}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
            />
          </div>
          <button className={btnPrimary} onClick={() => void upload()} disabled={uploading || !file || !name.trim()}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload &amp; compile
          </button>
        </div>
        <p className="mt-2 text-xs text-text-faint">
          Drop a zip anywhere in this box. Max 25MB. The original is kept immutable — you can re-compile any time.
        </p>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            className={cn(inputCls, "pl-8")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates or tags"
            aria-label="Search templates"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                statusFilter === s ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text",
              )}
            >
              {s === "all" ? `All (${rows.length})` : `${statusPill(s).label}${counts[s] ? ` (${counts[s]})` : ""}`}
            </button>
          ))}
        </div>
      </div>

      {/* grid */}
      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
        </div>
      ) : shown.length === 0 ? (
        <EmptyPanel
          icon={LayoutTemplate}
          title={rows.length === 0 ? "No templates yet" : "Nothing matches that filter"}
          hint={rows.length === 0 ? "Upload a template zip above to compile your first package." : undefined}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              busy={busyId === t.id}
              onOpen={() => setOpenId(t.id)}
              onCompile={() => void compile(t.id)}
              onRename={(n) => rename(t.id, n)}
              onDelete={() => setDeleteTarget(t)}
            />
          ))}
        </div>
      )}

      {openId ? (
        <ReviewDrawer
          templateId={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
          <div className="w-full max-w-[420px] rounded-lg border border-border bg-surface p-6">
            <h2 className="mb-2 font-semibold text-text">Delete “{deleteTarget.name}”?</h2>
            <p className="mb-4 text-sm text-text-muted">
              The uploaded zip and its compiled package are removed. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button className={btnSecondary} onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
              <button className={btnPrimary} onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

`NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` will still fail until Task 4's `ReviewDrawer` exists. If you did Task 2 as its own commit, this one may also land red; state it. Otherwise combine Tasks 2–4 into one commit.

```bash
git add components/site-studio/SiteStudioBoard.tsx
git commit -m "feat(site-studio): templates board with search, filters and drop-zone upload"
```

---

### Task 4: ReviewDrawer

The certification workflow: side-by-side original vs compiled preview, the diagnostics checklist, AI enrichment, and Certify.

**Files:**
- Create: `components/site-studio/ReviewDrawer.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Info, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";
import { Pill } from "@/components/common/Panel";
import { btnPrimary, btnSecondary, btnSecondarySm, iconBtn } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import type { Diagnostic, TemplateManifest } from "@/lib/site-studio/schema";
import type { StudioTemplateStatus } from "@/lib/site-studio/service/types";
import { canCertify, groupDiagnostics, statusPill } from "@/lib/site-studio/ui/status";

interface DetailRow {
  id: string;
  name: string;
  status: StudioTemplateStatus;
  version: number;
  manifest: TemplateManifest | null;
  diagnostics: Diagnostic[] | null;
  identity_enriched_at: string | null;
  semantics_enriched_at: string | null;
}

const LEVEL_ICON = { blocker: AlertTriangle, warn: AlertTriangle, info: Info } as const;

export function ReviewDrawer({
  templateId,
  onClose,
  onChanged,
}: {
  templateId: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [row, setRow] = useState<DetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "identity" | "semantics" | "certify" | "reject">(null);
  const [pageFile, setPageFile] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/site-studio/templates/${templateId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not load template");
      const t = (await res.json()).template as DetailRow;
      setRow(t);
      setPageFile((prev) => prev ?? t.manifest?.pages?.[0]?.file ?? null);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load template" });
    } finally {
      setLoading(false);
    }
  }, [templateId, toast]);

  useEffect(() => { void load(); }, [load]);

  // Escape closes the drawer (matches the app's dialog behaviour)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const grouped = useMemo(() => groupDiagnostics(row?.diagnostics), [row]);
  const certifiable = row ? canCertify(row.status, Boolean(row.manifest), row.diagnostics) : false;

  async function post(path: string, kind: NonNullable<typeof busy>, okTitle: string) {
    setBusy(kind);
    try {
      const res = await fetch(`/api/site-studio/templates/${templateId}/${path}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      if (body.reverted) {
        toast({ kind: "info", title: "Reverted", body: "The AI change broke the round-trip check, so it was discarded." });
      } else {
        toast({ kind: "success", title: okTitle });
      }
      await load();
      await onChanged();
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(status: StudioTemplateStatus, okTitle: string) {
    setBusy("reject");
    try {
      const res = await fetch(`/api/site-studio/templates/${templateId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      toast({ kind: "success", title: okTitle });
      await load();
      await onChanged();
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusy(null);
    }
  }

  const pages = row?.manifest?.pages ?? [];
  const pill = row ? statusPill(row.status) : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[1100px] flex-col border-l border-border bg-surface"
        role="dialog"
        aria-label="Template review"
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-lg font-semibold text-text">{row?.name ?? "Loading…"}</h2>
            {row ? (
              <p className="text-xs text-text-muted">
                v{row.version} · {pages.length} page{pages.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
          {pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}
          <button className={iconBtn} onClick={onClose} title="Close review" aria-label="Close review">
            <X className="h-4 w-4" />
          </button>
        </header>

        {loading || !row ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* left: checklist + actions */}
            <div className="w-[340px] shrink-0 space-y-4 overflow-auto border-r border-border p-4">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">Review checklist</h3>
                {grouped.blockers.length + grouped.warnings.length + grouped.infos.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-sm text-text-muted">
                    <Check className="h-4 w-4 text-ready-fg" /> Nothing flagged.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {[...grouped.blockers, ...grouped.warnings, ...grouped.infos].map((d, i) => {
                      const Icon = LEVEL_ICON[d.level];
                      return (
                        <li key={`${d.code}-${i}`} className="rounded-md border border-border bg-surface-2 p-2">
                          <div className="flex items-center gap-1.5">
                            <Icon
                              className={cn(
                                "h-3.5 w-3.5",
                                d.level === "blocker" ? "text-dropped-fg" : d.level === "warn" ? "text-notready-fg" : "text-text-faint",
                              )}
                            />
                            <span className="text-xs font-medium text-text">{d.code}</span>
                            {d.page ? <span className="ml-auto text-[11px] text-text-faint">{d.page}</span> : null}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-text-muted">{d.message}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-faint">AI enrichment</h3>
                <p className="text-xs leading-relaxed text-text-muted">
                  Optional. Each pass is verified against the original — anything that breaks the round-trip is discarded automatically.
                </p>
                <button
                  className={btnSecondarySm}
                  disabled={busy !== null || row.status !== "needs_review"}
                  onClick={() => void post("enrich-identity", "identity", "Identity pass complete")}
                >
                  {busy === "identity" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Find residual identity
                  {row.identity_enriched_at ? <Check className="h-3.5 w-3.5 text-ready-fg" /> : null}
                </button>
                <button
                  className={btnSecondarySm}
                  disabled={busy !== null || row.status !== "needs_review"}
                  onClick={() => void post("enrich-semantics", "semantics", "Semantics pass complete")}
                >
                  {busy === "semantics" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Label pages &amp; slots
                  {row.semantics_enriched_at ? <Check className="h-3.5 w-3.5 text-ready-fg" /> : null}
                </button>
              </section>

              <section className="space-y-2 border-t border-border pt-4">
                <button
                  className={btnPrimary}
                  disabled={!certifiable || busy !== null}
                  onClick={() => void post("certify", "certify", "Certified")}
                >
                  {busy === "certify" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Certify template
                </button>
                {!certifiable && row.status === "needs_review" ? (
                  <p className="text-xs text-dropped-fg">
                    {grouped.blockers.length} blocking problem{grouped.blockers.length === 1 ? "" : "s"} must be cleared first.
                  </p>
                ) : null}
                {row.status === "needs_review" ? (
                  <button className={btnSecondary} disabled={busy !== null} onClick={() => void setStatus("rejected", "Rejected")}>
                    Reject
                  </button>
                ) : null}
                {row.status === "certified" ? (
                  <button className={btnSecondary} disabled={busy !== null} onClick={() => void setStatus("disabled", "Disabled")}>
                    Disable
                  </button>
                ) : null}
                {row.status === "disabled" ? (
                  <button className={btnSecondary} disabled={busy !== null} onClick={() => void setStatus("certified", "Re-enabled")}>
                    Re-enable
                  </button>
                ) : null}
                {row.status === "rejected" ? (
                  <button className={btnSecondary} disabled={busy !== null} onClick={() => void setStatus("needs_review", "Re-opened")}>
                    Re-open
                  </button>
                ) : null}
              </section>
            </div>

            {/* right: previews */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
                <select
                  className={cn(inputSelectCls)}
                  value={pageFile ?? ""}
                  onChange={(e) => setPageFile(e.target.value)}
                  aria-label="Preview page"
                >
                  {pages.map((p) => (
                    <option key={p.file} value={p.file}>{p.file} · {p.kind}{p.stampable ? " (stampable)" : ""}</option>
                  ))}
                </select>
                <label className="ml-auto flex items-center gap-1.5 text-xs text-text-muted">
                  <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} />
                  Show original side-by-side
                </label>
              </div>
              {!row.manifest || !pageFile ? (
                <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-text-muted">
                  Not compiled yet — compile this template to preview it.
                </div>
              ) : (
                <div className={cn("grid min-h-0 flex-1", showOriginal ? "grid-cols-2" : "grid-cols-1")}>
                  {showOriginal ? (
                    <figure className="flex min-h-0 flex-col border-r border-border">
                      <figcaption className="border-b border-border bg-surface-2 px-3 py-1 text-[11px] font-medium text-text-muted">
                        Original upload
                      </figcaption>
                      <iframe
                        title="Original template page"
                        src={`/api/site-studio/templates/${row.id}/original/${pageFile}`}
                        className="min-h-0 flex-1 bg-white"
                        sandbox=""
                      />
                    </figure>
                  ) : null}
                  <figure className="flex min-h-0 flex-col">
                    <figcaption className="border-b border-border bg-surface-2 px-3 py-1 text-[11px] font-medium text-text-muted">
                      Compiled package, rendered from its own samples
                    </figcaption>
                    <iframe
                      title="Compiled template page"
                      src={`/api/site-studio/templates/${row.id}/preview/${pageFile}`}
                      className="min-h-0 flex-1 bg-white"
                      sandbox=""
                    />
                  </figure>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

const inputSelectCls =
  "rounded-md border border-border bg-surface px-2 py-1 text-xs text-text outline-none focus:ring-2 focus:ring-accent";
```

Notes for the implementer:
- The `sandbox=""` attribute on both iframes is belt-and-braces on top of the server's CSP `sandbox` header — an empty sandbox attribute is the most restrictive setting. Keep both.
- If `pages[].file` values contain subdirectories (`sub/page.html`), the URL still works — the routes use a catch-all segment.
- `inputSelectCls` is declared at the bottom of the file but used above; that is legal for `const` at module scope only because it is referenced inside a component body (evaluated after module init). If the linter objects, move it above the component.

- [ ] **Step 2: Verify + commit**

Run `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` — must now be CLEAN (all three components exist). Fix any type errors before committing.

```bash
git add components/site-studio/ReviewDrawer.tsx
git commit -m "feat(site-studio): review drawer with side-by-side preview, checklist and certify"
```

---

### Task 5: Page route + sidebar entry

**Files:**
- Create: `app/(app)/ai-tools/site-studio/page.tsx`
- Modify: `components/layout/Sidebar.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { SiteStudioBoard } from "@/components/site-studio/SiteStudioBoard";

export const dynamic = "force-dynamic";

export default async function SiteStudioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const perms = await getUserPermissions(user.id);
  if (!perms.has("studio.manage")) redirect("/dashboard");

  return <SiteStudioBoard />;
}
```

- [ ] **Step 2: Add the sidebar entry**

In `components/layout/Sidebar.tsx`, in the `AI_TOOLS` array, add this entry immediately AFTER the existing `/ai-tools/templates` ("Templates") item:

```tsx
  { href: "/ai-tools/site-studio", label: "Site Studio", icon: Wand2, perms: ["studio.manage"] },
```

Import `Wand2` from `lucide-react` alongside the file's other icon imports (check the existing import list and add it there; if `Wand2` is already imported, reuse it).

- [ ] **Step 3: Verify + commit**

`NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` clean.

```bash
git add "app/(app)/ai-tools/site-studio/page.tsx" components/layout/Sidebar.tsx
git commit -m "feat(site-studio): board page route and sidebar entry"
```

---

### Task 6: Gates + live verification

- [ ] **Step 1: Full suite** — `npm test` → all green (the new pure-helper tests plus everything existing).

- [ ] **Step 2: Typecheck** — `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` → zero errors.

- [ ] **Step 3: Production build** — `NODE_OPTIONS=--max-old-space-size=6144 npm run build` → succeeds, and the route list includes `/ai-tools/site-studio`. Make sure no dev server is running first.

- [ ] **Step 4: LIVE VERIFICATION (this is the point of Phase 2b — do not skip).** Use the Browser pane, not manual instructions to the user:
  1. `.claude/launch.json` ALREADY has the entry `sed-lms-dev` (npm run dev, port 3000) — just `preview_start` with `{ name: "sed-lms-dev" }`. Do not create a new config.
  2. Navigate to `/ai-tools/site-studio`. If it redirects to `/dashboard`, the signed-in account lacks `studio.manage` — STOP and report that the user must grant it in Admin → Permissions (the page is working correctly; it is a permission gap, not a bug).
  3. With access: zip the `tests/fixtures/site-studio/plumberpro` fixture (write the zip to the scratchpad, not the repo), upload it through the UI, and confirm: the card appears, compile runs, status becomes "Needs review", and the drawer opens showing BOTH iframes rendering the plumbing site side-by-side.
  4. Check `read_console_messages` and `preview_logs` for errors. Take a screenshot of the drawer.
  5. Verify the compiled preview shows the DEMO content (it renders from samples) and that the checklist lists the expected warns (`identity_name_heuristic`, `stranded_text`).
  6. Clean up: delete the test template through the UI, then `preview_stop`.
- [ ] **Step 5: Report** — screenshot + console/log status + what worked and what didn't. If anything is broken, fix it (new commit) and re-verify before declaring done.

- [ ] **Step 6: Clean tree** — `git status --short` → clean.

**Phase 2b is complete when:** the board renders, an upload compiles end-to-end, the drawer shows side-by-side previews with the diagnostics checklist, certify works on a clean template, and all gates are green.

---

## Self-review notes (already applied)

- **Spec coverage:** Concept 3's one-page board (dense grid, status chips, drop-zone upload with live compile, inline rename, full action set) and Concept 2's review UI (side-by-side original vs compiled, flagged-items checklist, Certify). Deferred with reasons: card thumbnails (needs a screenshot pipeline), SOP panel (Phase 4), JS baking (own phase).
- **Convention fidelity:** every primitive used (`PageHeader`/`EmptyPanel`/`Pill`/`useToast`/`btn*`/`iconBtn*`/`inputCls`/`RelativeTime`/`cn`) is verified to exist in this repo with the signature used here; data flow is the repo's `useState` + `fetch` + `load()` idiom, not a new library.
- **Server-truth alignment:** `canCertify` mirrors the certify route's preconditions exactly, and enrichment buttons disable outside `needs_review` — the UI never offers an action the API will refuse.
- **Security:** previews are framed from the Phase 2a routes whose CSP `sandbox` neutralizes the untrusted template; the iframes additionally carry `sandbox=""`.
- **Type-sequencing caveat is called out honestly** in Tasks 2–3 (the components reference each other, so tsc is only meaningful after Task 4) with an explicit choice offered rather than a silent red build.
- **No placeholders:** every task carries complete code or exact commands.
