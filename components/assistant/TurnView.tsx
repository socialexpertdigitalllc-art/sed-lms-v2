"use client";

import { useState } from "react";
import { Brain, Check, ChevronRight, CircleAlert, Copy, Loader2, RotateCcw, Sparkles, Square } from "lucide-react";
import { answerText, type Segment, type TurnModel } from "@/lib/assistant/turns";
import { btnGhostSm } from "@/components/common/buttons";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";

/** One question and its answer. Live and saved turns render identically. */

function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-text-faint transition-colors hover:bg-surface-2 hover:text-text-muted"
        aria-expanded={open}
      >
        <Brain className={cn("h-3.5 w-3.5", live && "animate-pulse text-accent")} aria-hidden />
        {live ? "Thinking…" : "Reasoning"}
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} aria-hidden />
      </button>
      {open ? (
        <div className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-2 px-3 py-2 leading-relaxed text-text-muted">
          {text}
        </div>
      ) : null}
    </div>
  );
}

function argText(args: Record<string, unknown> | null): string {
  if (!args) return "";
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  return parts.join(" · ");
}

function ToolRow({ seg }: { seg: Extract<Segment, { kind: "tool" }> }) {
  const detail = argText(seg.args);
  return (
    <li className="flex min-w-0 items-start gap-2 text-xs" title={detail || undefined}>
      <span className="mt-0.5 shrink-0">
        {seg.status === "running" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-label="Running" />
        ) : seg.status === "ok" ? (
          <Check className="h-3.5 w-3.5 text-ready-fg" aria-label="Done" />
        ) : (
          <CircleAlert className="h-3.5 w-3.5 text-notready-fg" aria-label="Failed" />
        )}
      </span>
      <span className="min-w-0">
        <span className="font-medium text-text-muted">{seg.label}</span>
        {seg.summary ? <span className="text-text-faint"> — {seg.summary}</span> : null}
      </span>
    </li>
  );
}

export function TurnView({
  turn,
  onRetry,
}: {
  turn: TurnModel;
  /** Offered on a failed answer: ask the same question again. */
  onRetry?: (question: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const live = turn.status === "running";
  const reasoning = turn.segments
    .filter((s): s is Extract<Segment, { kind: "reasoning" }> => s.kind === "reasoning")
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join("\n\n");
  const tools = turn.segments.filter((s): s is Extract<Segment, { kind: "tool" }> => s.kind === "tool");
  const text = answerText(turn);
  const last = turn.segments[turn.segments.length - 1];
  const thinking = live && (!last || last.kind === "reasoning");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — nothing to do */
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-sm leading-relaxed text-text">
          {turn.question}
        </div>
      </div>

      <div className="flex gap-3">
        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-white" aria-hidden>
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          {reasoning ? <Reasoning text={reasoning} live={thinking} /> : null}

          {tools.length ? (
            <ul className="space-y-1 rounded-lg border border-border-subtle bg-surface-2/60 px-3 py-2">
              {tools.map((t) => (
                <ToolRow key={t.callId} seg={t} />
              ))}
            </ul>
          ) : null}

          {text ? <Markdown text={text} streaming={live} /> : null}

          {live && !text ? (
            <p className="flex items-center gap-2 text-xs text-text-faint">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {tools.some((t) => t.status === "running") ? "Looking it up…" : reasoning ? "Thinking it through…" : "Working on it…"}
            </p>
          ) : null}

          {turn.status === "error" ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-dropped-bg bg-dropped-bg/40 px-3 py-2 text-xs text-dropped-fg">
              <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{turn.error || "The answer could not be completed."}</span>
              {onRetry ? (
                <button type="button" className={cn(btnGhostSm, "text-dropped-fg")} onClick={() => onRetry(turn.question)}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Try again
                </button>
              ) : null}
            </div>
          ) : null}

          {turn.status === "stopped" ? (
            <p className="flex items-center gap-1.5 text-xs text-text-faint">
              <Square className="h-3 w-3" aria-hidden /> Stopped{text ? "" : " before answering"}.
            </p>
          ) : null}

          {!live && text ? (
            <div className="flex items-center gap-1 text-text-faint">
              <button type="button" className={btnGhostSm} onClick={() => void copy()} aria-label="Copy answer">
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </button>
              {turn.model ? <span className="ml-1 font-mono text-[11px]">{turn.model}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
