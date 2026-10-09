"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, CircleAlert, Copy, Loader2, Pencil, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { answerText, formatDuration, type Segment, type TurnModel } from "@/lib/assistant/turns";
import type { AnswerFeedback } from "@/lib/assistant/types";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { SedAiAvatar } from "./SedAiMark";
import { useSmoothText } from "./useSmoothText";

/**
 * One question and its answer, drawn the way people know from ChatGPT and
 * Claude: the question in a bubble on the right; the answer as a document
 * under the assistant's name, with what it did to get there folded into one
 * line ("Worked for 12s · 3 lookups") and the usual actions under it — copy,
 * rate, regenerate; copy and edit on the latest question. Live and saved
 * turns render identically.
 */

type ToolSeg = Extract<Segment, { kind: "tool" }>;

function useCopy(text: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* clipboard blocked — nothing to do */
      });
  };
  return [copied, copy];
}

function Action({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-surface-2 hover:text-text",
        pressed ? "text-text" : "text-text-faint",
      )}
    >
      {children}
    </button>
  );
}

function ToolRow({ seg }: { seg: ToolSeg }) {
  return (
    <li className="flex min-w-0 items-start gap-2 text-[13px]">
      <span className="mt-0.5 shrink-0">
        {seg.status === "running" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-text-faint" aria-label="Running" />
        ) : seg.status === "ok" ? (
          <Check className="h-3.5 w-3.5 text-ready-fg" aria-label="Done" />
        ) : (
          <CircleAlert className="h-3.5 w-3.5 text-notready-fg" aria-label="Failed" />
        )}
      </span>
      <span className="min-w-0">
        <span className="text-text-muted">{seg.label}</span>
        {seg.summary ? <span className="text-text-faint"> — {seg.summary}</span> : null}
      </span>
    </li>
  );
}

/** What the assistant did to answer — one line, unfolding to its reasoning and lookups. */
function Activity({ label, working, reasoning, tools }: { label: string; working: boolean; reasoning: string; tools: ToolSeg[] }) {
  const [open, setOpen] = useState(false);
  const text = <span className={cn("text-[13px]", working ? "sed-ai-shimmer font-medium" : "text-text-faint")}>{label}</span>;
  if (!reasoning && !tools.length) return <p className="py-0.5">{text}</p>;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md py-0.5 text-left text-text-faint transition-colors hover:text-text-muted"
      >
        {text}
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} aria-hidden />
      </button>
      {open ? (
        <div className="mt-2 space-y-2.5 border-l-2 border-border pl-3.5">
          {reasoning ? (
            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-text-muted">{reasoning}</p>
          ) : null}
          {tools.length ? (
            <ul className="space-y-1.5">
              {tools.map((t) => (
                <ToolRow key={t.callId} seg={t} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EditQuestion({ initial, onCancel, onSave }: { initial: string; onCancel: () => void; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [draft]);
  const save = () => {
    if (draft.trim()) onSave(draft.trim());
  };
  return (
    <div className="w-full max-w-[85%] rounded-3xl bg-surface-2 p-3">
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, 8000))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        rows={1}
        aria-label="Edit your question"
        className="block w-full resize-none bg-transparent px-1 text-[inherit] leading-relaxed text-text focus:outline-none"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!draft.trim()}
          className="rounded-full bg-text px-3 py-1.5 text-xs font-medium text-surface transition-opacity hover:opacity-85 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}

export function TurnView({
  turn,
  assistantName,
  latest = false,
  compact = false,
  onRetry,
  onRegenerate,
  onEdit,
  onRate,
}: {
  turn: TurnModel;
  /** What this user calls their assistant — shown on its replies. */
  assistantName: string;
  /** The newest turn: its actions stay visible (older ones show on hover). */
  latest?: boolean;
  /** The floating chat: slightly smaller type. */
  compact?: boolean;
  /** Offered on a failed answer. */
  onRetry?: () => void;
  /** Offered on the newest answer when nothing is running. */
  onRegenerate?: () => void;
  /** Offered on the newest question when nothing is running. */
  onEdit?: (text: string) => void;
  onRate?: (answerId: string, feedback: AnswerFeedback | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const live = turn.status === "running";
  const reasoning = turn.segments
    .filter((s): s is Extract<Segment, { kind: "reasoning" }> => s.kind === "reasoning")
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join("\n\n");
  const tools = turn.segments.filter((s): s is ToolSeg => s.kind === "tool");
  const text = answerText(turn);
  const shownText = useSmoothText(text, live);
  const [copied, copy] = useCopy(text);
  const [questionCopied, copyQuestion] = useCopy(turn.question);

  const last = turn.segments[turn.segments.length - 1];
  const running = tools.find((t) => t.status === "running");
  const duration = turn.startedAt && turn.endedAt && turn.endedAt >= turn.startedAt ? formatDuration(turn.endedAt - turn.startedAt) : null;
  const lookups = `${tools.length} ${tools.length === 1 ? "lookup" : "lookups"}`;

  let activity: { label: string; working: boolean } | null = null;
  if (live && !text) {
    activity = {
      working: true,
      label: running ? `${running.label}…` : last?.kind === "reasoning" || !tools.length ? "Thinking…" : "Putting it together…",
    };
  } else if (tools.length || reasoning) {
    activity = {
      working: false,
      label: live || !duration ? (tools.length ? `Used ${lookups}` : "Reasoning") : tools.length ? `Worked for ${duration} · ${lookups}` : `Thought for ${duration}`,
    };
  }

  const size = compact ? "text-sm" : "text-[15px]";
  const showActions = !live && !editing && (Boolean(text) || turn.status === "stopped");

  return (
    <article className={cn("group/turn space-y-3", size)}>
      {/* The question */}
      <div className="group/q flex flex-col items-end gap-1">
        {editing && onEdit ? (
          <EditQuestion
            initial={turn.question}
            onCancel={() => setEditing(false)}
            onSave={(t) => {
              setEditing(false);
              if (t !== turn.question) onEdit(t);
            }}
          />
        ) : (
          <>
            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl bg-surface-2 px-4 py-2.5 leading-relaxed text-text">
              {turn.question}
            </div>
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/q:opacity-100">
              <Action label={questionCopied ? "Copied" : "Copy question"} onClick={copyQuestion}>
                {questionCopied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              </Action>
              {onEdit ? (
                <Action label="Edit question" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </Action>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* The answer */}
      <div className="flex gap-3">
        <SedAiAvatar size="sm" spinning={live} className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="pt-1.5 text-[13px] font-semibold leading-none text-text">{assistantName}</p>

          {activity ? <Activity label={activity.label} working={activity.working} reasoning={reasoning} tools={tools} /> : null}

          {shownText ? <Markdown text={shownText} streaming={live} caret={live} className={size} /> : null}

          {turn.status === "error" ? (
            <div className="rounded-xl border border-dropped-bg bg-dropped-bg/30 px-3.5 py-3 text-[13px]">
              <p className="flex items-start gap-2 text-dropped-fg">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0">{turn.error || "The answer could not be completed."}</span>
              </p>
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-2"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again
                </button>
              ) : null}
            </div>
          ) : null}

          {turn.status === "stopped" ? (
            <p className="text-[13px] text-text-faint">{text ? "You stopped this answer." : "Stopped before answering."}</p>
          ) : null}

          {showActions ? (
            <div
              className={cn(
                "-ml-1.5 flex items-center gap-0.5",
                !latest && "opacity-0 transition-opacity focus-within:opacity-100 group-hover/turn:opacity-100",
              )}
            >
              {text ? (
                <Action label={copied ? "Copied" : "Copy answer"} onClick={copy}>
                  {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                </Action>
              ) : null}
              {turn.answerId && onRate ? (
                <>
                  <Action
                    label="Good answer"
                    pressed={turn.feedback === "up"}
                    onClick={() => onRate(turn.answerId!, turn.feedback === "up" ? null : "up")}
                  >
                    <ThumbsUp className={cn("h-4 w-4", turn.feedback === "up" && "fill-current")} aria-hidden />
                  </Action>
                  <Action
                    label="Bad answer"
                    pressed={turn.feedback === "down"}
                    onClick={() => onRate(turn.answerId!, turn.feedback === "down" ? null : "down")}
                  >
                    <ThumbsDown className={cn("h-4 w-4", turn.feedback === "down" && "fill-current")} aria-hidden />
                  </Action>
                </>
              ) : null}
              {onRegenerate ? (
                <Action label="Regenerate" onClick={onRegenerate}>
                  <RefreshCw className="h-4 w-4" aria-hidden />
                </Action>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
