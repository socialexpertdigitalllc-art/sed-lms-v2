"use client";

import { useState } from "react";
import { Bookmark, Loader2, X } from "lucide-react";
import { btnGhostSm, btnPrimary } from "@/components/common/buttons";
import { iconBtn } from "@/components/common/buttons";
import { cn } from "@/lib/utils";

/** "/google-lead" from "Google lead". Mirrors toCommand in lib/assistant/recipes.ts. */
const toCommand = (s: string) =>
  s
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/**
 * Save a question as a shortcut: next time, "/" in the message box and one
 * pick sends it again (in Act mode, when it is a task).
 */
export function SaveShortcutDialog({
  prompt,
  canAct,
  onClose,
  onSaved,
}: {
  prompt: string;
  canAct: boolean;
  onClose: () => void;
  onSaved: (command: string) => void;
}) {
  const [name, setName] = useState(() => prompt.split(/\s+/).slice(0, 4).join(" ").slice(0, 60));
  const [command, setCommand] = useState(() => toCommand(prompt.split(/\s+/).slice(0, 3).join(" ")));
  const [text, setText] = useState(prompt);
  const [mode, setMode] = useState<"ask" | "act">(canAct ? "act" : "ask");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/assistant/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), command: toCommand(command), prompt: text.trim(), mode }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; recipe?: { command: string } };
      if (!res.ok || !body.recipe) throw new Error(body.error ?? `HTTP ${res.status}`);
      onSaved(body.recipe.command);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text focus:border-accent focus:outline-none";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Save as a shortcut" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <Bookmark className="h-4 w-4 text-accent" aria-hidden />
          <h2 className="flex-1 font-display text-sm font-semibold text-text">Save as a shortcut</h2>
          <button type="button" className={iconBtn} onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <label className="block space-y-1">
            <span className="text-xs text-text-muted">Name</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} autoFocus />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-text-muted">Command — type it after “/” in the message box</span>
            <div className="flex items-center gap-1">
              <span className="text-text-faint">/</span>
              <input className={input} value={command} onChange={(e) => setCommand(e.target.value.toLowerCase().slice(0, 40))} />
            </div>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-text-muted">What it sends</span>
            <textarea className={cn(input, "min-h-[96px] resize-y")} value={text} onChange={(e) => setText(e.target.value.slice(0, 4000))} />
          </label>
          {canAct ? (
            <label className="flex cursor-pointer items-center gap-2 text-text-muted">
              <input type="checkbox" className="accent-[var(--color-accent)]" checked={mode === "act"} onChange={(e) => setMode(e.target.checked ? "act" : "ask")} />
              Run it in Act mode (it prepares changes for you to confirm)
            </label>
          ) : null}
          {error ? <p className="text-xs text-dropped-fg">{error}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btnGhostSm} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy || !name.trim() || !toCommand(command) || !text.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save shortcut
          </button>
        </div>
      </div>
    </div>
  );
}
