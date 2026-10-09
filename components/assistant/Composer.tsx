"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX = 8000;

/** Enter sends, Shift+Enter starts a new line; Stop while an answer is coming. */
export function Composer({
  onSend,
  onStop,
  running,
  disabled,
  autoFocus,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to about eight lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  function send() {
    const t = text.trim();
    if (!t || running || disabled) return;
    onSend(t);
    setText("");
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        className={cn(
          "flex items-end gap-2 rounded-xl border bg-surface px-3 py-2 shadow-sm transition-colors",
          disabled ? "border-border opacity-60" : "border-border focus-within:border-accent",
        )}
      >
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          disabled={disabled}
          placeholder={disabled ? "The assistant is not available right now" : "Ask about your leads, calls, team or strategy…"}
          className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed text-text placeholder:text-text-faint focus:outline-none"
          aria-label="Message the assistant"
        />
        {running ? (
          <button
            type="button"
            onClick={onStop}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-text text-surface transition-opacity hover:opacity-85"
            aria-label="Stop answering"
            title="Stop"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || disabled}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-ink disabled:opacity-40"
            aria-label="Send message"
            title="Send (Enter)"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="mt-1.5 text-center text-[11px] text-text-faint">
        The assistant only sees what your account can see. It can make mistakes — check important numbers.
        {text.length > MAX - 1000 ? ` · ${MAX - text.length} characters left` : ""}
      </p>
    </div>
  );
}
