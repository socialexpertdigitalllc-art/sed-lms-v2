"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plug, RefreshCw, Trash2, Plus, FolderInput, CheckCircle2, AlertTriangle } from "lucide-react";
import { Field, FormSection, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { SUPPORTED_PLACEHOLDERS } from "@/lib/contracts/placeholders";

export type RegisteredTemplate = { id: string; google_doc_id: string; name: string; placeholders: string[]; synced_at: string | null };
export type AvailableDoc = { id: string; name: string; modifiedTime: string; registered: boolean };
type GoogleStatus = { connected: boolean; account_email: string | null };

function unmapped(placeholders: string[]): string[] {
  const supported = new Set<string>(SUPPORTED_PLACEHOLDERS);
  return placeholders.filter((p) => !supported.has(p));
}

export function ContractTemplatesManager({
  status,
  folderId,
  available,
  folderMissing,
  registered,
}: {
  status: GoogleStatus;
  folderId: string;
  available: AvailableDoc[];
  folderMissing: boolean;
  registered: RegisteredTemplate[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<RegisteredTemplate[]>(registered);
  const [docs, setDocs] = useState<AvailableDoc[]>(available);
  const [folder, setFolder] = useState(folderId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingFolder, setSavingFolder] = useState(false);

  async function disconnect() {
    if (!confirm("Disconnect Google? Existing contracts keep their stored PDFs, but new Google-template contracts will fail until reconnected.")) return;
    const res = await fetch("/api/admin/google/disconnect", { method: "POST" });
    if (!res.ok) { toast({ kind: "error", title: "Disconnect failed" }); return; }
    toast({ kind: "success", title: "Google disconnected" });
    router.refresh();
  }

  async function saveFolder(e: React.FormEvent) {
    e.preventDefault();
    setSavingFolder(true);
    try {
      const res = await fetch("/api/admin/contract-templates/folder", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder_id: folder }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Save failed", body: data.error }); return; }
      toast({ kind: "success", title: "Folder saved" });
      router.refresh();
    } finally { setSavingFolder(false); }
  }

  async function addDoc(id: string) {
    setBusyId(id);
    try {
      const res = await fetch("/api/admin/contract-templates", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ google_doc_id: id }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Add failed", body: data.error }); return; }
      setRows((prev) => [...prev, data.template]);
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, registered: true } : d)));
      toast({ kind: "success", title: "Template added" });
    } finally { setBusyId(null); }
  }

  async function refresh(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/contract-templates/${id}/refresh`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Refresh failed", body: data.error }); return; }
      setRows((prev) => prev.map((r) => (r.id === id ? data.template : r)));
      toast({ kind: "success", title: "Template refreshed" });
    } finally { setBusyId(null); }
  }

  async function remove(id: string) {
    if (!confirm("Remove this template from the registry? The Google Doc is not deleted.")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/contract-templates/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); toast({ kind: "error", title: "Remove failed", body: d.error }); return; }
      const removed = rows.find((r) => r.id === id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      if (removed) setDocs((prev) => prev.map((d) => (d.id === removed.google_doc_id ? { ...d, registered: false } : d)));
      toast({ kind: "success", title: "Template removed" });
    } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-6">
      {/* Connection */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-text"><Plug className="w-4 h-4" /> Google connection</div>
        {status.connected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <CheckCircle2 className="w-4 h-4 text-ready-fg" /> Connected as <span className="font-medium text-text">{status.account_email || "—"}</span>
            </div>
            <button onClick={disconnect} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-2">Disconnect</button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-muted">Not connected. Connect a Google account with access to the templates folder.</p>
            <a href="/api/admin/google/connect" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink">Connect Google</a>
          </div>
        )}
      </div>

      {/* Folder */}
      <form onSubmit={saveFolder} className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-text"><FolderInput className="w-4 h-4" /> Templates folder</div>
        <Field label="Google Drive folder ID" hint="From the folder URL: drive.google.com/drive/folders/<THIS_ID>">
          <input className={inputCls} value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="1AbC…" />
        </Field>
        <div className="flex justify-end">
          <button type="submit" disabled={savingFolder} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
            {savingFolder ? "Saving…" : "Save folder"}
          </button>
        </div>
      </form>

      {/* Available */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="text-sm font-semibold text-text">Available docs in folder</div>
        {folderMissing ? (
          <p className="text-xs text-text-faint">Set a folder ID above to list template docs.</p>
        ) : docs.length === 0 ? (
          <p className="text-xs text-text-faint">No Google Docs found in that folder.</p>
        ) : (
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-text">{d.name}</span>
                <button
                  onClick={() => addDoc(d.id)}
                  disabled={d.registered || busyId === d.id}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text hover:bg-surface-2 disabled:opacity-50"
                >
                  {d.registered ? "Added" : <><Plus className="w-3.5 h-3.5" /> Add</>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Registered */}
      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div className="text-sm font-semibold text-text">Registered templates</div>
        {rows.length === 0 ? (
          <p className="text-xs text-text-faint">No templates registered yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const bad = unmapped(r.placeholders);
              return (
                <li key={r.id} className="py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text">{r.name}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => refresh(r.id)} disabled={busyId === r.id} title="Refresh" className="p-1.5 rounded text-text-muted hover:text-text hover:bg-surface-2 disabled:opacity-50">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button onClick={() => remove(r.id)} disabled={busyId === r.id} title="Remove" className="p-1.5 rounded text-text-muted hover:text-dropped-fg hover:bg-surface-2 disabled:opacity-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {r.placeholders.length === 0 && <span className="text-[11px] text-text-faint">No placeholders detected.</span>}
                    {r.placeholders.map((p) => (
                      <span key={p} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-muted font-mono">{p}</span>
                    ))}
                  </div>
                  {bad.length > 0 && (
                    <div className="flex items-center gap-1 text-[11px] text-dropped-fg">
                      <AlertTriangle className="w-3.5 h-3.5" /> Unmapped (left as-is): {bad.join(", ")}
                    </div>
                  )}
                  <div className="text-[11px] text-text-faint">Last synced {r.synced_at ? new Date(r.synced_at).toLocaleString() : "—"}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
