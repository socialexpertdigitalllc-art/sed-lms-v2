"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { SocialProfilesField } from "@/components/forms/SocialProfilesField";
import { cleanSocialProfiles } from "@/lib/leads/newLeadForm";
import type { SocialProfile } from "@/lib/leads/types";

/**
 * The lead's social profiles on the detail page, editable in place.
 *
 * A structured list does not fit `FieldRow`'s string draft, so this is its
 * own row with the same shape: label, value, and an Edit that swaps in the
 * repeater the submission form already uses. It exists because a lead
 * submitted with this field empty — the common case on a first call — had
 * no way to gain profiles afterwards, when the agent actually has them.
 */
export function SocialProfilesRow({
  profiles,
  canEdit,
  onSave,
  className = "",
}: {
  profiles: SocialProfile[];
  canEdit: boolean;
  /** Receives the cleaned list, or null when every row was emptied. Throws to keep editing. */
  onSave: (next: SocialProfile[] | null) => Promise<void> | void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SocialProfile[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function begin() {
    // Start with one blank row when there is nothing yet — the point of
    // opening the editor on an empty field is to add one, not to hunt for
    // the add button first.
    setDraft(profiles.length ? profiles.map((p) => ({ ...p })) : [{ platform: "Facebook", url: "", label: null }]);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const cleaned = cleanSocialProfiles(draft);
    setSaving(true);
    setError(null);
    try {
      await onSave(cleaned.length ? cleaned : null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const labelOf = (p: SocialProfile) => (p.platform === "Other" ? p.label || "Other" : p.platform);

  return (
    <div className={"group/row min-w-0 " + className}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-text-faint">Social profiles</div>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={begin}
            aria-label="Edit social profiles"
            title="Edit social profiles"
            className="inline-grid h-6 w-6 place-items-center rounded text-text-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-text focus-visible:opacity-100 group-hover/row:opacity-100"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-1.5 space-y-2" data-testid="social-profiles-editor">
          <SocialProfilesField values={draft} onChange={setDraft} />
          {error && <p className="text-[11px] text-dropped-fg">{error}</p>}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-ink disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-text-muted hover:bg-surface-2"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </div>
      ) : profiles.length > 0 ? (
        <ul className="mt-0.5 space-y-0.5 text-sm">
          {profiles.map((p, i) => (
            <li key={i} className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 text-xs text-text-muted">{labelOf(p)}</span>
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-accent-ink hover:underline"
              >
                {p.url}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-0.5 text-sm text-text-faint">
          —{canEdit && <span className="ml-1 text-xs">(hover to add)</span>}
        </div>
      )}
    </div>
  );
}
