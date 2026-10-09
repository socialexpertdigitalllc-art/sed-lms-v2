"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { DEFAULT_ASSISTANT_NAME, MAX_ASSISTANT_NAME_LENGTH, NAME_SUGGESTIONS } from "@/lib/assistant/name";
import { useAssistant } from "@/providers/AssistantProvider";
import { btnPrimary, btnSecondary } from "@/components/common/buttons";
import { cn } from "@/lib/utils";
import { SedAiAvatar } from "./SedAiMark";

/**
 * Naming the assistant. On first open the user is asked what to call it; the
 * name is theirs alone and is used everywhere they see the assistant. The
 * same form renames it later.
 */
export function NameAssistant({ mode, onDone, compact }: { mode: "first" | "rename"; onDone?: () => void; compact?: boolean }) {
  const { name, saveName } = useAssistant();
  const [draft, setDraft] = useState(mode === "rename" ? name : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: string) {
    if (!value.trim()) {
      setError("Type a name first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveName(value);
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={cn("mx-auto w-full", compact ? "max-w-sm px-5 py-6" : "max-w-md px-4 py-10")}
      onSubmit={(e) => {
        e.preventDefault();
        void save(draft);
      }}
    >
      <div className="mb-5 text-center">
        <SedAiAvatar size="md" className="mx-auto mb-3" />
        <h2 className="font-display text-lg font-semibold tracking-tight text-text">
          {mode === "first" ? `Meet your ${DEFAULT_ASSISTANT_NAME}` : "Rename your assistant"}
        </h2>
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-text-muted">
          {mode === "first"
            ? "What would you like to call it? It will go by this name everywhere in your dashboard — just for you."
            : "The new name shows everywhere you see your assistant."}
        </p>
      </div>

      <label className="block">
        <span className="sr-only">Assistant name</span>
        <input
          autoFocus
          value={draft}
          maxLength={MAX_ASSISTANT_NAME_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Nova"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-center text-base text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
          aria-invalid={error ? true : undefined}
        />
      </label>

      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {NAME_SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setDraft(s)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              draft === s ? "border-accent bg-accent-soft text-accent-ink" : "border-border text-text-muted hover:border-accent/50 hover:text-text",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-3 text-center text-xs text-dropped-fg" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-2">
        <button type="submit" className={cn(btnPrimary, "w-full")} disabled={saving || !draft.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {mode === "first" ? "Save and start" : "Save name"}
        </button>
        {mode === "first" ? (
          <button type="button" className={cn(btnSecondary, "w-full")} disabled={saving} onClick={() => void save(DEFAULT_ASSISTANT_NAME)}>
            Keep “{DEFAULT_ASSISTANT_NAME}”
          </button>
        ) : (
          <button type="button" className={cn(btnSecondary, "w-full")} disabled={saving} onClick={() => onDone?.()}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
