"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, CirclePause, Loader2, RefreshCw, Square, X } from "lucide-react";
import type { TaskView } from "@/lib/assistant/tasks";
import { cn } from "@/lib/utils";

/** Finished tasks stay on the banner this long (unless dismissed). */
const SHOW_FINISHED_MS = 24 * 3_600_000;

/** What the banner says about a task. PURE; tested. */
export function taskHeadline(t: TaskView): string {
  switch (t.status) {
    case "running":
      return t.working ? "Working in the background" : "Carrying on in the background";
    case "done":
      return "Background task finished";
    case "blocked":
      return "The background task needs you";
    case "failed":
      return "The background task couldn't finish";
    default:
      return "Background task stopped";
  }
}

/**
 * The chat's background task, above the message box: it carries on by itself
 * (run after run, even with the page closed) until it is done. Stop task ends
 * it — and the run going right now — at once.
 */
export function TaskBanner({ task, onStop, compact = false }: { task: TaskView; onStop: () => Promise<{ ok: boolean; error?: string }>; compact?: boolean }) {
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const finishedAt = task.finished_at ? Date.parse(task.finished_at) : null;
  // eslint-disable-next-line react-hooks/purity -- "is it recent?" is read once per render on purpose
  const stale = finishedAt !== null && Date.now() - finishedAt > SHOW_FINISHED_MS;
  if (task.status !== "running" && (dismissed === task.id || stale)) return null;

  const running = task.status === "running";
  const Icon = running ? (task.working ? Loader2 : RefreshCw) : task.status === "done" ? CircleCheck : task.status === "blocked" ? CirclePause : CircleAlert;
  const tone = running
    ? "border-accent/30 bg-accent-soft/60 text-accent-ink"
    : task.status === "done"
      ? "border-ready-fg/30 bg-ready-bg/50 text-ready-fg"
      : task.status === "blocked"
        ? "border-notready-fg/30 bg-notready-bg/60 text-notready-fg"
        : "border-border bg-surface-2 text-text-muted";
  const detail = task.status === "running" || task.status === "done" || task.status === "blocked" ? task.progress || task.last_error : task.last_error || task.progress;
  const facts = [`run ${task.runs}${running ? ` of up to ${task.max_runs}` : ""}`, task.changes ? `${task.changes} change${task.changes === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");

  async function stop() {
    setStopping(true);
    setError(null);
    const r = await onStop();
    setStopping(false);
    if (!r.ok) setError(r.error ?? "Could not stop it.");
  }

  return (
    <div className={cn("mx-auto mb-2 w-full max-w-3xl rounded-xl border px-3 py-2", compact ? "text-xs" : "text-[13px]", tone)} role="status" data-testid="task-banner">
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", running && task.working && "animate-spin")} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {taskHeadline(task)}
            <span className="ml-1.5 font-normal opacity-80">{facts}</span>
          </p>
          {detail ? <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-text-muted">{detail}</p> : null}
          {running ? <p className="mt-0.5 text-text-faint">It carries on by itself — you can close this page. You&apos;ll get a notification when it&apos;s done.</p> : null}
          {error ? <p className="mt-0.5 text-dropped-fg">{error}</p> : null}
        </div>
        {running ? (
          <button
            type="button"
            onClick={() => void stop()}
            disabled={stopping}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:bg-surface disabled:opacity-60"
          >
            {stopping ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Square className="h-3 w-3" aria-hidden />} Stop task
          </button>
        ) : (
          <button type="button" onClick={() => setDismissed(task.id)} className="shrink-0 rounded p-0.5 hover:bg-surface" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
