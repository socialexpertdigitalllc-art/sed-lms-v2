"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, LayoutTemplate, Loader2, Trash2, Upload } from "lucide-react";
import { EmptyPanel, PageHeader } from "@/components/common/Panel";
import { btnPrimary, btnSecondary, iconBtnDanger } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { RelativeTime } from "@/components/common/RelativeTime";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";

export interface BuilderTemplateRow {
  id: string;
  name: string;
  storage_path: string;
  page_files: string[];
  asset_files: string[];
  created_by: string | null;
  created_at: string;
}

/**
 * The templates screen (spec: "Upload a zip, list templates (name, page
 * count, date), delete with confirm. That is all."). No compile, no health
 * report, no certification, no diagnostics — Site Builder never analyses a
 * template's HTML beyond splitting pages from assets (see
 * `lib/site-builder/templates.ts`), so there is nothing else to show.
 */
export function TemplatesBoard() {
  const { toast } = useToast();
  const [rows, setRows] = useState<BuilderTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<BuilderTemplateRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/site-builder/templates");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load templates");
      setRows((body.templates ?? []) as BuilderTemplateRow[]);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load templates" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

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
      const res = await fetch("/api/site-builder/templates", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      setName("");
      setFile(null);
      setFileKey((k) => k + 1);
      toast({ kind: "success", title: "Template uploaded" });
      await load();
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/site-builder/templates/${deleteTarget.id}`, { method: "DELETE" });
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

  const empty = useMemo(() => !loading && rows.length === 0, [loading, rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Site Builder templates"
        description="Upload a template zip once — the AI rewrites it page-by-page for every site you build from it."
      />

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
            <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="builder-template-name">Template name</label>
            <input
              id="builder-template-name"
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Plumber Pro"
              disabled={uploading}
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="builder-template-file">Template .zip</label>
            <input
              id="builder-template-file"
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
            Upload
          </button>
        </div>
        <p className="mt-2 text-xs text-text-faint">Drop a zip anywhere in this box. Max 25MB.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
        </div>
      ) : empty ? (
        <EmptyPanel icon={LayoutTemplate} title="No templates yet" hint="Upload a template zip above to get started." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => (
            <div key={t.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-medium text-text">{t.name}</h3>
                <div className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                  <FileText className="h-3.5 w-3.5 text-text-faint" />
                  {t.page_files.length} page{t.page_files.length === 1 ? "" : "s"} · {t.asset_files.length} asset{t.asset_files.length === 1 ? "" : "s"}
                </div>
                <p className="mt-1 text-xs text-text-faint"><RelativeTime iso={t.created_at} /></p>
              </div>
              <div className="flex items-center justify-end">
                <button
                  className={iconBtnDanger}
                  title="Delete template"
                  aria-label={`Delete ${t.name}`}
                  onClick={() => setDeleteTarget(t)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
          <div className="w-full max-w-[420px] rounded-lg border border-border bg-surface p-6">
            <h2 className="mb-2 font-semibold text-text">Delete "{deleteTarget.name}"?</h2>
            <p className="mb-4 text-sm text-text-muted">The uploaded zip is removed. This cannot be undone.</p>
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
