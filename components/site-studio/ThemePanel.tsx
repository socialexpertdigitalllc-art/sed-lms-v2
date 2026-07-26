"use client";

import { useEffect, useState } from "react";
import { Loader2, Palette } from "lucide-react";
import { btnSecondarySm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import type { TemplateManifest } from "@/lib/site-studio/schema";
import type { StudioRunRow } from "@/lib/site-studio/run/types";

export interface ThemePanelProps {
  runId: string;
  manifest: TemplateManifest;
  /** `content_doc.theme` — a partial map of role -> hex, seeded onto every
   *  declared role below (falling back to black for a role the doc hasn't
   *  set a value for yet). */
  theme: Record<string, string>;
  onRunUpdated: (run: StudioRunRow) => void;
}

/** Expands 3-digit hex (`#abc`) to 6-digit (`#aabbcc`) for `<input
 *  type="color">`, which only accepts the 6-digit form — display only, the
 *  value actually PATCHed is whatever the color picker itself produces. */
function toColorInputValue(hex: string | undefined): string {
  if (!hex) return "#000000";
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : "#000000";
}

/**
 * One colour input per manifest-declared theme role (Task 7), seeded from
 * the run's own `content_doc.theme`, saving via `PATCH /theme` and handing
 * the fresh run back through `onRunUpdated` — `RunPreview`'s iframe `src`
 * carries `run.updated_at`, so a successful theme save re-renders the
 * preview with zero extra wiring here.
 *
 * A role the template's manifest doesn't declare is never shown — the
 * theme route itself 422s on an undeclared role (a role the renderer's
 * `applyTheme` never consumes would otherwise look like a working control
 * that silently does nothing), so this panel only ever offers roles that
 * are guaranteed to do something.
 */
export function ThemePanel({ runId, manifest, theme, onRunUpdated }: ThemePanelProps) {
  const { toast } = useToast();
  const roleIds = Object.keys(manifest.theme.roles);
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...theme }));
  const [saving, setSaving] = useState(false);

  // Re-seed whenever the run's own theme changes underneath us (another
  // tab's edit, or this panel's own save bubbling back through
  // `onRunUpdated`) — a plain object-identity dependency would re-fire on
  // every parent render even when the values are unchanged, so this
  // compares the serialized values instead.
  const themeKey = JSON.stringify(theme);
  useEffect(() => {
    setDraft({ ...theme });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey]);

  if (roleIds.length === 0) return null;

  const dirty = roleIds.filter((role) => draft[role] !== theme[role]);

  async function save() {
    if (dirty.length === 0) return;
    setSaving(true);
    try {
      const roles = Object.fromEntries(dirty.map((role) => [role, draft[role]]));
      const res = await fetch(`/api/site-studio/runs/${runId}/theme`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast({
          kind: "error",
          title: body.error ?? "This run changed while you were editing — your view has been refreshed, please redo that change",
        });
        const freshRes = await fetch(`/api/site-studio/runs/${runId}`);
        const fresh = await freshRes.json().catch(() => ({}));
        if (freshRes.ok && fresh.run) onRunUpdated(fresh.run as StudioRunRow);
        return;
      }
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not save the theme" });
        return;
      }
      toast({ kind: "success", title: "Theme updated" });
      onRunUpdated(body.run as StudioRunRow);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-text">
        <Palette className="h-4 w-4" /> Theme
      </h3>
      <div className="flex flex-wrap gap-4">
        {roleIds.map((role) => (
          <label key={role} className="flex items-center gap-2 text-xs text-text-muted">
            {role}
            <input
              type="color"
              aria-label={`Theme role ${role}`}
              value={toColorInputValue(draft[role])}
              onChange={(e) => setDraft((d) => ({ ...d, [role]: e.target.value }))}
              disabled={saving}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className={`${btnSecondarySm} mt-3`}
        onClick={() => void save()}
        disabled={saving || dirty.length === 0}
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save theme
      </button>
    </div>
  );
}
