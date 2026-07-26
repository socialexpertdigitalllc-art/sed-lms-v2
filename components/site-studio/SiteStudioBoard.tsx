"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, LayoutTemplate, Loader2, Search, Upload } from "lucide-react";
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
        action={
          <Link
            href="/ai-tools/site-studio/sops?doc=01-adding-a-template"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text"
          >
            <BookOpen className="h-3.5 w-3.5" /> SOP: Adding a template
          </Link>
        }
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
