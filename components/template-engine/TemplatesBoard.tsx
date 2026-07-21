"use client";

import { useCallback, useEffect, useState } from "react";
import { Upload, Archive, RotateCcw, Save, ChevronRight, Loader2, Stethoscope } from "lucide-react";
import type { PageKind, TemplateManifest } from "@/lib/template-engine/types";
import type { TemplateEngineSettings } from "@/lib/template-engine/settings";
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
    const status = j.health?.status as "pass" | "warn" | "fail" | undefined;
    toast({
      kind: status === "fail" ? "error" : "success",
      title:
        status === "fail"
          ? "Health check failed"
          : status === "warn"
            ? "Health check passed with warnings"
            : "Template is healthy",
      body: "See the report below for what each check found.",
    });
    load(showArchived);
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
                <button
                  type="button"
                  onClick={() => toggleExpand(t)}
                  className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left"
                >
                  <ChevronRight
                    className={
                      "w-4 h-4 text-text-faint shrink-0 transition-transform" + (expanded ? " rotate-90" : "")
                    }
                  />
                  <span className={"font-semibold text-text" + (t.status === "archived" ? " opacity-60" : "")}>
                    {t.name}
                  </span>
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
                  </span>
                </button>

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
    </div>
  );
}
