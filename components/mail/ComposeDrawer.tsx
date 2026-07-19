"use client";

import { useEffect, useRef } from "react";
import { Loader2, Send as SendIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";

export type Draft = { to: string; subject: string; body: string };

/**
 * Right-side compose drawer. Purely presentational: it owns no network calls —
 * `onSend` is supplied by the Mailbox and hits /api/mail/send exactly as before.
 */
export function ComposeDrawer({
  draft,
  address,
  sending,
  isReply,
  onChange,
  onClose,
  onSend,
}: {
  draft: Draft;
  address: string;
  sending: boolean;
  isReply: boolean;
  onChange: (d: Draft) => void;
  onClose: () => void;
  onSend: () => void;
}) {
  const toRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    toRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !sending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  const canSend = !sending && draft.to.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-text/25"
        onClick={() => !sending && onClose()}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={isReply ? "Reply" : "New message"}
        className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-text">
              {isReply ? "Reply" : "New message"}
            </h2>
            <p className="mt-0.5 truncate text-xs text-text-muted">
              From <span className="font-mono tabular">{address}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            aria-label="Close compose"
            className="rounded-md p-1.5 text-text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-text disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <Field label="To" required>
            <input
              ref={toRef}
              className={inputCls}
              value={draft.to}
              onChange={(e) => onChange({ ...draft, to: e.target.value })}
              placeholder="recipient@example.com"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Subject">
            <input
              className={inputCls}
              value={draft.subject}
              onChange={(e) => onChange({ ...draft, subject: e.target.value })}
              placeholder="No subject"
            />
          </Field>
          <Field label="Message" className="flex min-h-0 flex-col">
            <textarea
              className={cn(inputCls, "min-h-[18rem] flex-1 resize-y leading-relaxed")}
              value={draft.body}
              onChange={(e) => onChange({ ...draft, body: e.target.value })}
              placeholder="Write your message…"
            />
          </Field>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-text-muted transition-colors duration-150 hover:bg-surface hover:text-text disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendIcon className="h-4 w-4" />}
            {sending ? "Sending…" : "Send"}
          </button>
        </footer>
      </aside>
    </div>
  );
}
