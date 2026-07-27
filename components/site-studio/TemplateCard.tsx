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
  // The list endpoint doesn't return `manifest` (it's large) — only
  // `compiled_at`, from which the board derives `hasManifest`. So the
  // compiled/not-compiled decision (and whether to show a version) must key
  // off `hasManifest`, not `manifest` — a compiled template's card would
  // otherwise wrongly claim "not compiled" until the drawer loads the detail
  // row. The page count is only ever known once `manifest` itself is loaded
  // (e.g. after this card's own template was just compiled in this session).
  const pages = template.manifest?.pages?.length;

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
          <dd>
            {!template.hasManifest
              ? "not compiled"
              : pages != null
                ? `${pages} page${pages === 1 ? "" : "s"}`
                : "compiled"}
          </dd>
        </div>
        {template.hasManifest ? (
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
          {template.hasManifest ? "Review" : "Details"}
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
