"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Upload,
  Archive,
  RotateCcw,
  Save,
  ChevronRight,
  Loader2,
  Stethoscope,
  Pencil,
  Trash2,
  Check,
  X,
  Sparkles,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import type { PageKind, TemplateManifest } from "@/lib/template-engine/types";
import type { TemplateEngineSettings } from "@/lib/template-engine/settings";
import type { FixPreview } from "@/lib/template-engine/fix";
import { Select } from "@/components/common/Select";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { HealthChecks, HealthPill, healthOf } from "@/components/template-engine/TemplateHealth";

const PAGE_KINDS: PageKind[] = [
  "home",
  "about",
  "services_hub",
  "areas_hub",
  "gallery",
  "contact",
  "service_detail",
  "area_detail",
  "other",
];

type TemplateRow = {
  id: string;
  name: string;
  slug: string;
  manifest: TemplateManifest;
  page_count: number;
  status: "active" | "archived";
  created_at: string;
  /** How many generations were built from this template (drives the delete-confirm copy). */
  generation_count?: number;
  /** jsonb — null for templates uploaded before health checks existed */
  health: unknown;
  health_checked_at: string | null;
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function TemplatesBoard() {
  const { toast } = useToast();

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  // upload card
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0); // remounts the file input to clear it
  const [uploading, setUploading] = useState(false);

  // manifest editor
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [kindDraft, setKindDraft] = useState<Record<string, PageKind>>({});
  const [savingKinds, setSavingKinds] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  // AI-fix preview + apply, keyed by template id.
  const [fixPreview, setFixPreview] = useState<Record<string, FixPreview>>({});
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  // inline rename
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState<TemplateRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // engine settings
  const [settings, setSettings] = useState<TemplateEngineSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async (all: boolean) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/template-engine/templates${all ? "?all=1" : ""}`);
      if (res.ok) setTemplates(((await res.json()).templates ?? []) as TemplateRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(showArchived);
  }, [load, showArchived]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/template-engine/settings");
        if (res.ok && active) setSettings((await res.json()) as TemplateEngineSettings);
      } catch {
        /* settings card just stays hidden */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function upload() {
    if (!uploadName.trim() || !uploadFile) {
      toast({ kind: "error", title: "A template name and a zip file are required" });
      return;
    }
    setUploading(true);
    const fd = new FormData();
    fd.append("file", uploadFile);
    fd.append("name", uploadName.trim());
    const res = await fetch("/api/template-engine/templates", { method: "POST", body: fd });
    setUploading(false);
    const j = await res.json().catch(() => ({}));
    if (res.status !== 201) {
      toast({ kind: "error", title: "Upload failed", body: j.error ?? "Could not upload the template" });
      return;
    }
    toast({
      kind: "success",
      title: `Template "${j.template?.name ?? uploadName.trim()}" uploaded`,
      body: `${j.template?.page_count ?? 0} pages detected`,
    });
    setUploadName("");
    setUploadFile(null);
    setFileKey((k) => k + 1);
    load(showArchived);
  }

  function toggleExpand(t: TemplateRow) {
    if (expandedId === t.id) {
      setExpandedId(null);
      return;
    }
    const draft: Record<string, PageKind> = {};
    for (const p of t.manifest?.pages ?? []) draft[p.file] = p.kind;
    setKindDraft(draft);
    setExpandedId(t.id);
  }

  async function saveKinds(t: TemplateRow) {
    setSavingKinds(true);
    const res = await fetch(`/api/template-engine/templates/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kinds: kindDraft }),
    });
    setSavingKinds(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ kind: "error", title: "Save failed", body: j.error ?? "Could not save page kinds" });
      return;
    }
    toast({ kind: "success", title: "Page kinds saved" });
    load(showArchived);
  }

  function startRename(t: TemplateRow) {
    setEditingId(t.id);
    setRenameDraft(t.name);
  }

  function cancelRename() {
    setEditingId(null);
    setRenameDraft("");
  }

  async function saveRename(t: TemplateRow) {
    const name = renameDraft.trim();
    if (!name) {
      toast({ kind: "error", title: "A template name is required" });
      return;
    }
    if (name === t.name) {
      cancelRename();
      return;
    }
    setRenaming(true);
    // Optimistic: show the new name immediately, roll back if the PATCH fails.
    const prev = templates;
    setTemplates((ts) => ts.map((x) => (x.id === t.id ? { ...x, name } : x)));
    const res = await fetch(`/api/template-engine/templates/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRenaming(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setTemplates(prev);
      toast({ kind: "error", title: "Rename failed", body: j.error ?? "Could not rename the template" });
      return;
    }
    cancelRename();
    toast({ kind: "success", title: "Template renamed" });
  }

  function askDelete(t: TemplateRow) {
    setDeleteError(null);
    setDeleteTarget(t);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/template-engine/templates/${deleteTarget.id}`, { method: "DELETE" });
    setDeleting(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 409 carries the specific in-progress message; surface it in the dialog.
      setDeleteError(j.error ?? "Could not delete the template");
      return;
    }
    setTemplates((ts) => ts.filter((x) => x.id !== deleteTarget.id));
    toast({
      kind: "success",
      title: `Template "${deleteTarget.name}" deleted`,
      body: `${j.unlinkedGenerations ?? 0} generated site${
        (j.unlinkedGenerations ?? 0) === 1 ? "" : "s"
      } unlinked`,
    });
    setDeleteTarget(null);
  }

  async function setStatus(t: TemplateRow, status: "active" | "archived") {
    setBusyId(t.id);
    const res = await fetch(`/api/template-engine/templates/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusyId(null);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ kind: "error", title: "Update failed", body: j.error ?? "Could not update the template" });
      return;
    }
    toast({ kind: "success", title: status === "archived" ? "Template archived" : "Template restored" });
    load(showArchived);
  }

  /**
   * Re-run the deterministic checks against what is in storage now. Free — no
   * AI, no generation — so it is safe to offer as a plain button.
   */
  async function recheck(t: TemplateRow) {
    setCheckingId(t.id);
    const res = await fetch(`/api/template-engine/templates/${t.id}/health`, { method: "POST" });
    setCheckingId(null);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ kind: "error", title: "Re-check failed", body: j.error ?? "Could not run the health checks" });
      return;
    }
    const status = j.health?.status as "pass" | "info" | "warn" | "fail" | undefined;
    toast({
      kind: status === "fail" ? "error" : "success",
      title:
        status === "fail"
          ? "Health check failed"
          : status === "warn"
            ? "Health check passed with warnings"
            : status === "info"
              ? "Health check passed with notes"
              : "Template is healthy",
      body: "See the report below for what each check found.",
    });
    load(showArchived);
  }

  /**
   * Ask the model for a NON-DESTRUCTIVE fix. This only PREVIEWS: the route
   * applies the proposed edits to a copy, re-runs the health checks, and returns
   * what it would change plus a before/after — it writes nothing until the
   * operator confirms with "Apply fix".
   */
  async function askAiFix(t: TemplateRow) {
    setFixingId(t.id);
    const res = await fetch(`/api/template-engine/templates/${t.id}/fix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setFixingId(null);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ kind: "error", title: "Couldn't propose a fix", body: j.error ?? "The model could not be reached" });
      return;
    }
    const preview = j.preview as FixPreview | undefined;
    if (!preview) {
      toast({ kind: "error", title: "Couldn't propose a fix", body: "No preview was returned" });
      return;
    }
    setFixPreview((p) => ({ ...p, [t.id]: preview }));
    if (!preview.fixable) {
      toast({ kind: "info", title: "Nothing the AI can safely fix", body: preview.reason ?? undefined });
    } else if (!preview.improved) {
      toast({
        kind: "error",
        title: "Proposed edit is not an improvement",
        body: preview.reason ?? "It would not clear the failure, so it can't be applied.",
      });
    } else {
      toast({ kind: "success", title: "Fix ready to review", body: "Check the diff, then Apply." });
    }
  }

  /** Write the previewed patch. The route re-verifies and refuses unless it genuinely improves the template, backing up the old files first. */
  async function applyAiFix(t: TemplateRow) {
    const preview = fixPreview[t.id];
    if (!preview || !preview.improved) return;
    setApplyingId(t.id);
    const res = await fetch(`/api/template-engine/templates/${t.id}/fix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply: true, files: preview.proposedFiles }),
    });
    setApplyingId(null);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ kind: "error", title: "Apply failed", body: j.error ?? "The fix could not be applied" });
      return;
    }
    setFixPreview((p) => {
      const next = { ...p };
      delete next[t.id];
      return next;
    });
    toast({
      kind: "success",
      title: "Fix applied",
      body: `Old files backed up at ${j.backupPrefix ?? "a backup prefix"}.`,
    });
    load(showArchived);
  }

  function dismissFix(id: string) {
    setFixPreview((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  }

  async function saveSettings() {
    if (!settings) return;
    const maxTokens = Math.round(Number(settings.max_tokens));
    const temperature = Number(settings.temperature);
    if (!Number.isFinite(maxTokens) || maxTokens < 500 || maxTokens > 32000) {
      toast({ kind: "error", title: "Max tokens must be between 500 and 32000" });
      return;
    }
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
      toast({ kind: "error", title: "Temperature must be between 0 and 1" });
      return;
    }
    setSavingSettings(true);
    const res = await fetch("/api/template-engine/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_prompt: settings.system_prompt,
        edit_prompt: settings.edit_prompt,
        image_query_prompt: settings.image_query_prompt,
        max_tokens: maxTokens,
        temperature,
      }),
    });
    setSavingSettings(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ kind: "error", title: "Save failed", body: j.error ?? "Could not save engine settings" });
      return;
    }
    setSettings(j as TemplateEngineSettings);
    toast({ kind: "success", title: "Engine settings saved", body: "Affects all future generations." });
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Website Templates</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {templates.length} template{templates.length === 1 ? "" : "s"}
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-text-muted whitespace-nowrap">
          <input
            type="checkbox"
            className="accent-accent w-4 h-4"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {/* Upload card */}
      <div className="bg-surface border border-border rounded-lg p-5 mb-6">
        <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-4">
          Upload a template
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <label className="block text-xs font-medium text-text-muted mb-1">Template name</label>
            <input
              type="text"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              placeholder="e.g. Modern Plumber"
              className={inputCls}
            />
          </div>
          <div className="min-w-64">
            <label className="block text-xs font-medium text-text-muted mb-1">Template zip</label>
            <input
              key={fileKey}
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              className="block text-sm text-text-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-text hover:file:bg-surface"
            />
          </div>
          <button
            type="button"
            onClick={upload}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60 whitespace-nowrap"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </div>
        <p className="text-[11px] text-text-faint mt-2">
          Zip of a static HTML template (max 25MB). Pages, styles, and images are detected automatically.
        </p>
      </div>

      {/* Templates list */}
      {loading ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center text-text-faint">
          Loading templates…
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center text-text-faint">
          No templates yet. Upload a zip above to get started.
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          {templates.map((t) => {
            const expanded = expandedId === t.id;
            const health = healthOf(t.health);
            return (
              <div key={t.id} className="bg-surface border border-border rounded-lg">
                <div className="w-full flex flex-wrap items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(t)}
                    aria-expanded={expanded}
                    aria-label={expanded ? "Collapse template" : "Expand template"}
                    className="shrink-0 text-text-faint"
                  >
                    <ChevronRight
                      className={"w-4 h-4 transition-transform" + (expanded ? " rotate-90" : "")}
                    />
                  </button>

                  {editingId === t.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveRename(t);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelRename();
                          }
                        }}
                        placeholder="Template name"
                        className="w-56 px-2.5 py-1.5 rounded-md border border-border bg-surface text-sm font-semibold text-text outline-none focus:ring-2 focus:ring-accent"
                      />
                      <button
                        type="button"
                        onClick={() => saveRename(t)}
                        disabled={renaming}
                        aria-label="Save name"
                        className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-text-muted hover:bg-surface-2 disabled:opacity-60"
                      >
                        {renaming ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={cancelRename}
                        disabled={renaming}
                        aria-label="Cancel rename"
                        className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-text-muted hover:bg-surface-2 disabled:opacity-60"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleExpand(t)}
                        className={
                          "font-semibold text-text text-left" +
                          (t.status === "archived" ? " opacity-60" : "")
                        }
                      >
                        {t.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => startRename(t)}
                        aria-label="Rename template"
                        className="shrink-0 rounded p-1 text-text-faint hover:text-text hover:bg-surface-2"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}

                  <span
                    className={
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium " +
                      (t.status === "active" ? "bg-ready-bg text-ready-fg" : "bg-surface-2 text-text-faint")
                    }
                  >
                    {t.status}
                  </span>
                  <HealthPill report={health} />
                  <span className="ml-auto flex items-center gap-4 text-xs text-text-muted">
                    <span>{t.page_count} page{t.page_count === 1 ? "" : "s"}</span>
                    <span className="font-mono">{formatBytes(t.manifest?.totalBytes ?? 0)}</span>
                    <span className="text-text-faint whitespace-nowrap">
                      {new Date(t.created_at).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => askDelete(t)}
                      aria-label="Delete template"
                      className="shrink-0 rounded p-1 text-text-faint hover:text-dropped-fg hover:bg-surface-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </span>
                </div>

                {expanded && (
                  <div className="border-t border-border px-4 py-4">
                    {/* Health report first: it is the thing that decides whether
                        this template can produce a correct site at all. */}
                    <div className="mb-5">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">
                          Health check
                        </span>
                        <HealthPill report={health} />
                        {t.health_checked_at ? (
                          <span className="text-[11px] text-text-faint">
                            checked {new Date(t.health_checked_at).toLocaleString()}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => recheck(t)}
                          disabled={checkingId === t.id}
                          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-muted hover:bg-surface-2 disabled:opacity-60"
                        >
                          {checkingId === t.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Stethoscope className="h-4 w-4" />
                          )}
                          {checkingId === t.id ? "Checking…" : "Re-check"}
                        </button>
                      </div>
                      <HealthChecks report={health} />
                      <p className="mt-2 text-[11px] text-text-faint">
                        Deterministic checks only — no AI is called and nothing is generated, so re-checking is free.
                      </p>

                      {health?.status === "fail" && (
                        <div className="mt-3 rounded-md border border-border-subtle bg-surface-2 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Sparkles className="h-4 w-4 text-accent" />
                            <span className="text-sm font-medium text-text">AI-assisted fix</span>
                            <span className="text-[11px] text-text-faint">
                              Edits the template itself, backs up the current version first, and only offers Apply
                              when the health genuinely improves.
                            </span>
                            <button
                              type="button"
                              onClick={() => askAiFix(t)}
                              disabled={fixingId === t.id}
                              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-muted hover:bg-surface disabled:opacity-60"
                            >
                              {fixingId === t.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Sparkles className="h-4 w-4" />
                              )}
                              {fixingId === t.id ? "Thinking…" : fixPreview[t.id] ? "Re-run" : "Ask AI to fix"}
                            </button>
                          </div>

                          {fixPreview[t.id] &&
                            (() => {
                              const fp = fixPreview[t.id];
                              if (!fp.fixable) {
                                return (
                                  <p className="mt-3 text-xs text-text-muted">
                                    {fp.reason ?? "There is nothing the AI can safely auto-fix here."}
                                  </p>
                                );
                              }
                              const blocked =
                                fp.improvement.newFails.length > 0 || fp.blanked.length > 0;
                              return (
                                <div className="mt-3 border-t border-border-subtle pt-3">
                                  {fp.summary && <p className="text-xs text-text">{fp.summary}</p>}
                                  {!fp.improved && fp.reason && (
                                    <p className="mt-1 text-xs text-text-muted">{fp.reason}</p>
                                  )}
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <span className="text-[11px] text-text-faint">Health</span>
                                    <HealthPill report={fp.before} />
                                    <ArrowRight className="h-3.5 w-3.5 text-text-faint" />
                                    <HealthPill report={fp.after} />
                                  </div>
                                  {fp.improvement.resolvedFails.length > 0 && (
                                    <p className="mt-2 text-[11px] text-ready-fg">
                                      Resolves: {fp.improvement.resolvedFails.join(", ")}
                                    </p>
                                  )}
                                  {blocked && (
                                    <p className="mt-2 text-[11px] text-dropped-fg">
                                      {fp.blanked.length > 0
                                        ? `Would blank ${fp.blanked.join(", ")}`
                                        : `Would introduce new failures: ${fp.improvement.newFails.join(", ")}`}
                                      {" "}— cannot apply.
                                    </p>
                                  )}
                                  {fp.changes.length > 0 && (
                                    <ul className="mt-2 space-y-1">
                                      {fp.changes.map((c) => (
                                        <li
                                          key={c.file}
                                          className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted"
                                        >
                                          <span className="font-mono">{c.file}</span>
                                          <span className="text-text-faint">
                                            {c.sizeBefore} → {c.sizeAfter} bytes
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => applyAiFix(t)}
                                      disabled={!fp.improved || applyingId === t.id}
                                      className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-50"
                                    >
                                      {applyingId === t.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <ShieldCheck className="h-4 w-4" />
                                      )}
                                      {applyingId === t.id ? "Applying…" : "Apply fix"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => dismissFix(t.id)}
                                      disabled={applyingId === t.id}
                                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-muted hover:bg-surface disabled:opacity-60"
                                    >
                                      Discard
                                    </button>
                                    {!fp.improved && (
                                      <span className="text-[11px] text-text-faint">
                                        Apply is disabled until a proposal clears a failure without a regression.
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}
                        </div>
                      )}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wide text-text-faint">
                            <th className="py-2 pr-3">File</th>
                            <th className="pr-3">Title</th>
                            <th className="pr-3">Kind</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(t.manifest?.pages ?? []).map((p) => (
                            <tr key={p.file} className="border-t border-border-subtle">
                              <td className="py-1.5 pr-3 font-mono text-xs text-text-muted">{p.file}</td>
                              <td className="pr-3 text-text">{p.title}</td>
                              <td className="pr-3">
                                <Select
                                  value={kindDraft[p.file] ?? p.kind}
                                  onChange={(e) =>
                                    setKindDraft((d) => ({ ...d, [p.file]: e.target.value as PageKind }))
                                  }
                                  className={inputCls + " w-44"}
                                >
                                  {PAGE_KINDS.map((k) => (
                                    <option key={k} value={k}>
                                      {k}
                                    </option>
                                  ))}
                                </Select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-text-faint">
                      <span>{t.manifest?.css?.length ?? 0} css</span>
                      <span>{t.manifest?.js?.length ?? 0} js</span>
                      <span>{t.manifest?.imageFiles?.length ?? 0} images</span>
                      <span>{t.manifest?.assets?.length ?? 0} assets</span>
                      {t.manifest?.components && <span className="font-mono">{t.manifest.components}</span>}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => saveKinds(t)}
                        disabled={savingKinds}
                        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60"
                      >
                        <Save className="w-4 h-4" />
                        {savingKinds ? "Saving…" : "Save kinds"}
                      </button>
                      {t.status === "active" ? (
                        <button
                          type="button"
                          onClick={() => setStatus(t, "archived")}
                          disabled={busyId === t.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-muted hover:bg-surface-2 disabled:opacity-60"
                        >
                          <Archive className="w-4 h-4" /> Archive
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setStatus(t, "active")}
                          disabled={busyId === t.id}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-muted hover:bg-surface-2 disabled:opacity-60"
                        >
                          <RotateCcw className="w-4 h-4" /> Restore
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Engine settings */}
      {settings && (
        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold">
              Engine Settings
            </div>
            <button
              type="button"
              onClick={saveSettings}
              disabled={savingSettings}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {savingSettings ? "Saving…" : "Save settings"}
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">System prompt</label>
              <textarea
                rows={6}
                value={settings.system_prompt}
                onChange={(e) => setSettings((s) => (s ? { ...s, system_prompt: e.target.value } : s))}
                className={inputCls + " font-mono text-xs leading-relaxed"}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Edit prompt (per page)</label>
              <textarea
                rows={6}
                value={settings.edit_prompt}
                onChange={(e) => setSettings((s) => (s ? { ...s, edit_prompt: e.target.value } : s))}
                className={inputCls + " font-mono text-xs leading-relaxed"}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Image query prompt</label>
              <textarea
                rows={6}
                value={settings.image_query_prompt}
                onChange={(e) => setSettings((s) => (s ? { ...s, image_query_prompt: e.target.value } : s))}
                className={inputCls + " font-mono text-xs leading-relaxed"}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Max tokens</label>
                <input
                  type="number"
                  min={500}
                  max={32000}
                  step={100}
                  value={settings.max_tokens}
                  onChange={(e) =>
                    setSettings((s) => (s ? { ...s, max_tokens: Number(e.target.value) } : s))
                  }
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">Temperature</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.temperature}
                  onChange={(e) =>
                    setSettings((s) => (s ? { ...s, temperature: Number(e.target.value) } : s))
                  }
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm — states the consequence honestly */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4"
        >
          <div className="bg-surface border border-border rounded-lg p-6 w-full max-w-[440px] max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-text">Delete template</h2>
            <p className="text-sm text-text-muted mt-2">
              This permanently deletes{" "}
              <span className="font-medium text-text">{deleteTarget.name}</span> and its files.
              {(deleteTarget.generation_count ?? 0) > 0 ? (
                <>
                  {" "}
                  <span className="font-medium text-text">{deleteTarget.generation_count}</span>{" "}
                  site{(deleteTarget.generation_count ?? 0) === 1 ? " was" : "s were"} generated from
                  it — those built sites are <span className="font-medium text-text">not</span>{" "}
                  deleted, but they&apos;ll no longer be linked to a template.
                </>
              ) : (
                " No sites have been generated from it yet."
              )}
            </p>
            {deleteError && (
              <div className="mt-3 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">
                {deleteError}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-danger text-white font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                {deleting ? "Deleting…" : "Delete template"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
