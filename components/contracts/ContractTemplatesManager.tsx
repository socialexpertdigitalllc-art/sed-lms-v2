"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plug,
  Unplug,
  RefreshCw,
  Trash2,
  Plus,
  Check,
  FolderInput,
  FileText,
  FileQuestion,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  LibraryBig,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { Panel, EmptyPanel } from "@/components/common/Panel";
import { btnPrimary, btnSecondary, btnSecondarySm, iconBtn, iconBtnDanger } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { formatDateTime } from "@/lib/leads/format";
import { SUPPORTED_PLACEHOLDERS } from "@/lib/contracts/placeholders";

export type RegisteredTemplate = { id: string; google_doc_id: string; name: string; placeholders: string[]; synced_at: string | null };
export type AvailableDoc = {
  id: string;
  name: string;
  modifiedTime: string;
  registered: boolean;
  /** Drive mimeType — only native Google Docs can be copied + placeholder-filled. */
  mimeType: string;
  isDoc: boolean;
};
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
  folderNotAccessible = false,
  loadError = null,
  registered,
}: {
  status: GoogleStatus;
  folderId: string;
  available: AvailableDoc[];
  folderMissing: boolean;
  /** Drive could not see the folder at all (wrong account / not shared). */
  folderNotAccessible?: boolean;
  /** A real Drive/API error, surfaced instead of showing a blank list. */
  loadError?: string | null;
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
    <div className="space-y-5">
      {/* ── Connection status banner ─────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-md",
              status.connected ? "bg-ready-bg text-ready-fg" : "bg-notready-bg text-notready-fg",
            )}
          >
            {status.connected ? <CheckCircle2 className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{status.connected ? "Google connected" : "Google not connected"}</p>
            {status.connected ? (
              <p className="truncate font-mono text-xs text-text-muted">{status.account_email || "—"}</p>
            ) : (
              <p className="text-xs leading-relaxed text-text-muted">
                Connect a Google account with access to the templates folder to browse and register docs.
              </p>
            )}
          </div>
        </div>
        {status.connected ? (
          <button type="button" onClick={disconnect} className={btnSecondary}>
            <Unplug className="h-4 w-4" /> Disconnect
          </button>
        ) : (
          <a href="/api/admin/google/connect" className={btnPrimary}>
            <Plug className="h-4 w-4" /> Connect Google
          </a>
        )}
      </div>

      {/* ── Templates folder ─────────────────────────────────────── */}
      <form onSubmit={saveFolder}>
        <Panel
          icon={FolderInput}
          title="Templates folder"
          description="The Drive folder scanned for contract template documents."
          footer={
            <button type="submit" disabled={savingFolder} className={btnPrimary}>
              {savingFolder ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {savingFolder ? "Saving…" : "Save folder"}
            </button>
          }
        >
          <Field label="Google Drive folder ID" hint="From the folder URL: drive.google.com/drive/folders/<THIS_ID>">
            <input
              className={cn(inputCls, "font-mono transition-colors duration-150")}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="1AbC…"
            />
          </Field>
        </Panel>
      </form>

      {/* ── Drive docs + registered templates ────────────────────── */}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel
          icon={FileText}
          title="Available in Drive"
          description="Docs found in the folder above."
          count={docs.length}
          flush
        >
          {!status.connected ? (
            <EmptyPanel
              icon={Plug}
              title="Google not connected"
              hint="Connect a Google account above to browse template documents in Drive."
              action={
                <a href="/api/admin/google/connect" className={btnSecondarySm}>
                  <Plug className="h-3.5 w-3.5" /> Connect Google
                </a>
              }
            />
          ) : folderMissing ? (
            <EmptyPanel
              icon={FolderInput}
              title="No folder selected"
              hint="Paste your Drive folder ID (or its URL) in the setting above, then save to list the docs inside it."
            />
          ) : loadError ? (
            <div className="px-4 py-6">
              <div className="flex gap-3 rounded-md border border-dropped-fg/25 bg-dropped-bg/50 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-dropped-fg" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-dropped-fg">Drive could not list this folder</p>
                  <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-text-muted">{loadError}</p>
                </div>
              </div>
            </div>
          ) : folderNotAccessible ? (
            <div className="px-4 py-6">
              <div className="flex gap-3 rounded-md border border-notready-fg/25 bg-notready-bg/60 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-notready-fg" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-notready-fg">That folder isn&apos;t visible to the connected account</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">
                    Google is connected as{" "}
                    <span className="font-mono text-[11px] text-text">{status.account_email ?? "this account"}</span>, which cannot open folder{" "}
                    <span className="font-mono text-[11px] text-text">{folder || folderId}</span>. Either share the folder with that
                    address (Viewer is enough to list; Editor to copy), or reconnect using the account that owns it.
                  </p>
                </div>
              </div>
            </div>
          ) : docs.length === 0 ? (
            <EmptyPanel
              icon={FileQuestion}
              title="Folder is empty"
              hint="The connected account can see this folder, but it contains no files. Add your template docs to it, then refresh."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-text-muted">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text" title={d.name}>{d.name}</p>
                    <p className="tabular truncate font-mono text-[11px] text-text-faint">Modified {formatDateTime(d.modifiedTime)}</p>
                  </div>
                  {!d.isDoc ? (
                    <span
                      title={`${d.mimeType} — open it in Drive and use File → Save as Google Docs`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-text-faint"
                    >
                      <FileQuestion className="h-3.5 w-3.5" /> Not a Google Doc
                    </span>
                  ) : d.registered ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-ready-bg px-2 py-1 text-xs font-medium text-ready-fg">
                      <Check className="h-3.5 w-3.5" /> Added
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addDoc(d.id)}
                      disabled={busyId === d.id}
                      className={cn(btnSecondarySm, "shrink-0")}
                    >
                      {busyId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      Add
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          icon={LibraryBig}
          title="Registered templates"
          description="What agents can pick when composing a contract."
          count={rows.length}
          flush
        >
          {rows.length === 0 ? (
            <EmptyPanel
              icon={LibraryBig}
              title="No templates yet"
              hint="Add a doc from the Drive list to make it selectable in the contract composer."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {rows.map((r) => {
                const bad = new Set(unmapped(r.placeholders));
                const busy = busyId === r.id;
                return (
                  <li key={r.id} className="space-y-2 px-4 py-3 transition-colors duration-150 hover:bg-surface-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text" title={r.name}>{r.name}</p>
                        <p className="tabular mt-0.5 font-mono text-[11px] text-text-faint">
                          Synced {r.synced_at ? formatDateTime(r.synced_at) : "never"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => refresh(r.id)}
                          disabled={busy}
                          title="Refresh placeholders from the Google Doc"
                          aria-label="Refresh template"
                          className={iconBtn}
                        >
                          <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(r.id)}
                          disabled={busy}
                          title="Remove from the registry"
                          aria-label="Remove template"
                          className={iconBtnDanger}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {r.placeholders.length === 0 ? (
                      <p className="text-[11px] text-text-faint">No placeholders detected in this document.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {r.placeholders.map((p) => (
                          <span
                            key={p}
                            title={bad.has(p) ? "Not a known merge field — left as-is in the PDF" : "Filled from the lead"}
                            className={cn(
                              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px]",
                              bad.has(p)
                                ? "bg-notready-bg text-notready-fg"
                                : "bg-surface-2 text-text-muted ring-1 ring-inset ring-border-subtle",
                            )}
                          >
                            {bad.has(p) ? <AlertTriangle className="h-3 w-3 shrink-0" /> : null}
                            {p}
                          </span>
                        ))}
                      </div>
                    )}

                    {bad.size > 0 && (
                      <p className="text-[11px] leading-relaxed text-notready-fg">
                        {bad.size} unmapped placeholder{bad.size === 1 ? "" : "s"} — left as-is in the generated PDF.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
