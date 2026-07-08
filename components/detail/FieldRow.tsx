"use client";

import { useState } from "react";
import { Pencil, Copy, Check, X, ExternalLink } from "lucide-react";

export type FieldType = "text" | "number" | "url" | "textarea" | "datetime" | "select";
export type SelectOption = { value: string; label: string };

/**
 * A single labelled datum shown as plain text, with per-field Copy and (optional)
 * inline Edit. Edit swaps the text for the right control with ✓ save / ✕ cancel;
 * saving calls `onSave(nextRawString)` — the caller maps it to the API payload.
 */
export function FieldRow({
  label,
  value,
  display,
  copy,
  type = "text",
  options,
  canEdit = false,
  onSave,
  className = "",
}: {
  label: string;
  /** Current raw value as an editable string ("" when empty). */
  value: string;
  /** Optional custom display node (pill, link…). Defaults to `value` or "—". */
  display?: React.ReactNode;
  /** String to copy; defaults to `value`. */
  copy?: string;
  type?: FieldType;
  options?: readonly SelectOption[];
  canEdit?: boolean;
  onSave?: (next: string) => Promise<void> | void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyText = copy ?? value;
  const hasValue = value.trim() !== "";
  const openHref = type === "url" && hasValue ? value.trim() : undefined;

  function startEdit() {
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  async function commit() {
    if (!onSave) return setEditing(false);
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function doCopy() {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  const inputCls =
    "w-full px-2.5 py-1.5 rounded-md border border-accent bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent/40";

  return (
    <div className={"group py-2 " + className}>
      <div className="text-[10px] uppercase tracking-wide text-text-faint">{label}</div>

      {editing ? (
        <div className="mt-1 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {type === "textarea" ? (
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                className={inputCls}
              />
            ) : type === "select" ? (
              <select autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className={inputCls}>
                {options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                autoFocus
                type={type === "number" ? "number" : type === "datetime" ? "datetime-local" : type === "url" ? "url" : "text"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(false);
                }}
                className={inputCls}
              />
            )}
            {error && <p className="mt-1 text-[11px] text-dropped-fg">⚠ {error}</p>}
          </div>
          <button
            type="button"
            onClick={commit}
            disabled={busy}
            aria-label="Save"
            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent text-white hover:bg-accent-ink disabled:opacity-60"
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={busy}
            aria-label="Cancel"
            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border text-text-muted hover:bg-surface-2"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="mt-0.5 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 text-sm text-text">
            {display ?? (hasValue ? value : <span className="text-text-faint">—</span>)}
          </div>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {openHref && (
              <a
                href={openHref}
                target="_blank"
                rel="noreferrer"
                aria-label={"Open " + label + " in a new tab"}
                title="Open in new tab"
                className="grid h-6 w-6 place-items-center rounded text-text-faint hover:bg-surface-2 hover:text-accent-ink"
              >
                <ExternalLink size={13} />
              </a>
            )}
            {hasValue && (
              <button
                type="button"
                onClick={doCopy}
                aria-label={"Copy " + label}
                title="Copy"
                className="grid h-6 w-6 place-items-center rounded text-text-faint hover:bg-surface-2 hover:text-text"
              >
                {copied ? <Check size={13} className="text-ready-fg" /> : <Copy size={13} />}
              </button>
            )}
            {canEdit && onSave && (
              <button
                type="button"
                onClick={startEdit}
                aria-label={"Edit " + label}
                title="Edit"
                className="grid h-6 w-6 place-items-center rounded text-text-faint hover:bg-surface-2 hover:text-accent-ink"
              >
                <Pencil size={13} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
