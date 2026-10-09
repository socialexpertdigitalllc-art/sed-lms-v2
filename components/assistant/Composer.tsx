"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { AI_BRAND } from "@/lib/assistant/name";
import { cn } from "@/lib/utils";

const MAX = 8000;

/**
 * The message box. Enter sends, Shift+Enter starts a new line; while an
 * answer is coming the send button becomes Stop. Grows with the text.
 */
export function Composer({
  assistantName,
  onSend,
  onStop,
  running,
  disabled,
  autoFocus,
  compact,
  placeholder,
}: {
  assistantName: string;
  onSend: (text: string) => void;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** The floating chat: smaller type and a shorter footnote. */
  compact?: boolean;
  placeholder?: string;
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

  const round = "grid h-9 w-9 shrink-0 place-items-center rounded-full transition-[background-color,opacity] duration-150";

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        className={cn(
          "flex items-end gap-2 rounded-[26px] border bg-surface py-2 pl-4 pr-2 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.12)] transition-colors",
          disabled ? "border-border opacity-60" : "border-border focus-within:border-accent/60",
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
          placeholder={disabled ? `${assistantName} is not available right now` : (placeholder ?? `Ask ${assistantName} anything…`)}
          className={cn(
            "max-h-[200px] min-h-[24px] flex-1 resize-none self-center bg-transparent py-1 leading-relaxed text-text placeholder:text-text-faint focus:outline-none",
            compact ? "text-sm" : "text-[15px]",
          )}
          aria-label="Message the assistant"
        />
        {running ? (
          <button type="button" onClick={onStop} className={cn(round, "bg-text text-surface hover:opacity-85")} aria-label="Stop answering" title="Stop">
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || disabled}
            className={cn(round, "bg-text text-surface hover:opacity-85 disabled:bg-border disabled:text-text-faint disabled:hover:opacity-100")}
            aria-label="Send message"
            title="Send (Enter)"
          >
            <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} />
          </button>
        )}
      </div>
      <p className="mt-1.5 text-center text-[11px] text-text-faint">
        {compact
          ? `${AI_BRAND} can make mistakes. Check important numbers.`
          : `${assistantName} only sees what your account can see. ${AI_BRAND} can make mistakes, so check important numbers.`}
        {text.length > MAX - 1000 ? ` · ${MAX - text.length} characters left` : ""}
      </p>
    </div>
  );
}
