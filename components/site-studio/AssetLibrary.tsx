"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, ShieldCheck, Trash2, Upload } from "lucide-react";
import { EmptyPanel, PageHeader, Pill } from "@/components/common/Panel";
import { btnPrimary, iconBtnDanger } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import type { AssetRow } from "@/lib/site-studio/assets/types";

type LibraryRow = AssetRow & { thumb_url: string | null };
type KindFilter = "all" | "stock" | "client";

const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stock", label: "Stock" },
  { id: "client", label: "Client" },
];

/** The library management surface: search, upload, delete-with-confirm.
 *  Client-owned rows are shown with their lead's name and a badge making the
 *  fence visible in the UI, not just enforced server-side (spec §8: a
 *  client's own photos are never offered to any other client). */
export function AssetLibrary() {
  const { toast } = useToast();
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [leadNames, setLeadNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSubject, setUploadSubject] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (opts?: { subject?: string; kind?: KindFilter }) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const s = opts?.subject ?? subject;
      const k = opts?.kind ?? kind;
      if (s.trim()) params.set("subject", s.trim());
      if (k !== "all") params.set("kind", k);
      const res = await fetch(`/api/site-studio/assets?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load the asset library");
      setRows((body.assets ?? []) as LibraryRow[]);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load the asset library" });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const loadLeadNames = useCallback(async () => {
    try {
      const res = await fetch("/api/leads");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const names: Record<string, string> = {};
      for (const l of (body.leads ?? []) as { id: string; business_name: string }[]) names[l.id] = l.business_name;
      setLeadNames(names);
    } catch {
      // Non-critical: client-owned cards just fall back to showing the raw lead id.
    }
  }, []);

  useEffect(() => { void load(); void loadLeadNames(); }, [load, loadLeadNames]);

  function search() {
    void load({ subject, kind });
  }

  function changeKind(next: KindFilter) {
    setKind(next);
    void load({ subject, kind: next });
  }

  async function upload() {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("subject", uploadSubject.trim());
      const res = await fetch("/api/site-studio/assets", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      toast({ kind: "success", title: "Uploaded" });
      setUploadFile(null);
      setUploadSubject("");
      await load();
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setUploading(false);
    }
  }

  async function remove(row: LibraryRow) {
    if (!confirm(`Delete "${row.subject || "this image"}"? This cannot be undone.`)) return;
    setDeletingId(row.id);
    try {
      const res = await fetch(`/api/site-studio/assets/${row.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 (an active run still references it) surfaces verbatim.
        toast({ kind: "error", title: body.error ?? "Delete failed" });
        return;
      }
      toast({ kind: "success", title: "Deleted" });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Delete failed" });
    } finally {
      setDeletingId(null);
    }
  }

  const empty = useMemo(() => !loading && rows.length === 0, [loading, rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asset library"
        description="Every operator-approved image lands here and feeds future runs — library first, Pexels top-up second."
      />

      {/* upload */}
      <div className="rounded-lg border border-dashed border-border bg-surface p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="asset-subject">Subject</label>
            <input
              id="asset-subject"
              className={inputCls}
              value={uploadSubject}
              onChange={(e) => setUploadSubject(e.target.value)}
              placeholder="e.g. plumber van"
              disabled={uploading}
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="asset-file">Image file</label>
            <input
              id="asset-file"
              type="file"
              accept="image/*"
              className={inputCls}
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
            />
          </div>
          <button className={btnPrimary} onClick={() => void upload()} disabled={uploading || !uploadFile}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload
          </button>
        </div>
        <p className="mt-2 text-xs text-text-faint">Uploads land as shared stock — max 15MB.</p>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            className={cn(inputCls, "pl-8")}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
            placeholder="Search by subject"
            aria-label="Search assets"
          />
        </div>
        <div className="flex items-center gap-1">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => changeKind(f.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                kind === f.id ? "bg-accent text-white" : "bg-surface-2 text-text-muted hover:text-text",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading library…
        </div>
      ) : empty ? (
        <EmptyPanel icon={Upload} title="No assets yet" hint="Upload one above, or pick images from a run to grow the library." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((a) => (
            <div key={a.id} className="rounded-lg border border-border bg-surface p-3">
              <div className="relative mb-2 aspect-[4/3] overflow-hidden rounded-md bg-surface-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.thumb_url ?? ""} alt="" loading="lazy" className="h-full w-full object-cover" />
              </div>
              <p className="truncate text-sm font-medium text-text" title={a.subject}>{a.subject || "(no subject)"}</p>
              <p className="text-xs text-text-muted">{a.width}×{a.height} · used {a.use_count}×</p>
              {(a.niche_tags ?? []).length > 0 ? (
                <p className="mt-1 truncate text-xs text-text-faint">{a.niche_tags.join(", ")}</p>
              ) : null}
              {a.source === "pexels" && a.photographer ? (
                <p className="mt-1 text-xs text-text-faint">Photo by {a.photographer} · Pexels</p>
              ) : null}
              {a.kind === "client" ? (
                <div className="mt-2 flex items-center gap-1.5">
                  <Pill tone="accent" icon={ShieldCheck}>
                    {leadNames[a.lead_id ?? ""] ?? "Client"}
                  </Pill>
                  <span className="text-[10px] text-text-faint">never offered to other clients</span>
                </div>
              ) : null}
              <div className="mt-2 flex justify-end">
                <button
                  className={iconBtnDanger}
                  title="Delete"
                  aria-label={`Delete ${a.subject || "asset"}`}
                  onClick={() => void remove(a)}
                  disabled={deletingId === a.id}
                >
                  {deletingId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
