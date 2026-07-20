"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Circle, Loader2, MinusCircle, Pause, Play, RotateCcw, Square,
} from "lucide-react";
import type { GenStep } from "@/lib/template-engine/types";
import { buildEtaLabel } from "@/lib/template-engine/wizard";
import { useToast } from "@/components/common/Toast";
import { RedoButton, StaleNotice } from "./RedoControls";
import type { GenerationDetail } from "./GenerationWizard";
import { cn } from "@/lib/utils";

function StepIcon({ status }: { status: GenStep["status"] }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-accent-ink" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-accent-ink" />;
  if (status === "failed") return <AlertTriangle className="h-4 w-4 text-dropped-fg" />;
  if (status === "partial") return <MinusCircle className="h-4 w-4 text-notready-fg" />;
  return <Circle className="h-4 w-4 text-text-faint" />;
}

const ACTIVE_STATUSES = new Set(["queued", "running", "planning", "building"]);

/** Human name for the step a paused run came to rest on. */
function pausedAtLabel(gen: GenerationDetail, steps: GenStep[]): string {
  const key = gen.current_step;
  if (!key) return "the start of the run";
  return steps.find((s) => s.key === key)?.label ?? key;
}

type Action = "pause" | "resume" | "cancel" | "retry";

export function BuildTracker({ gen, onChanged }: { gen: GenerationDetail; onChanged?: () => void }) {
  const steps = Array.isArray(gen.steps) ? gen.steps : [];
  const running = ACTIVE_STATUSES.has(gen.status);
  const paused = gen.status === "paused";
  const cancelled = gen.status === "cancelled";
  // The API aborts the run's in-flight AI call in process, so the stop itself
  // is instant — but the runner still has to unwind and write its final row, so
  // there is a brief window where the operator has clicked and the status has
  // not moved yet. Say so rather than looking unresponsive.
  const stopping = running && (gen.control === "pause" || gen.control === "cancel");
  const [busy, setBusy] = useState<Action | null>(null);
  const { toast } = useToast();

  const MESSAGES: Record<Action, { fail: string; title: string; body: (status: string) => string }> = {
    pause: {
      fail: "Could not pause",
      title: "Pausing",
      body: (s) => (s === "paused" ? "Stopped before it started." : "Stopping now — the current step is being cut short."),
    },
    resume: {
      fail: "Could not resume",
      title: "Resumed",
      body: (s) => (s === "curating" ? "Check the images, then build again." : "Back in the pipeline."),
    },
    cancel: {
      fail: "Could not stop",
      title: "Stopping",
      body: (s) => (s === "cancelled" ? "Run stopped." : "Stopping now — partial build output is being discarded."),
    },
    retry: {
      fail: "Could not retry",
      title: "Run reset",
      body: (s) => (s === "curating" ? "Check the images, then build again." : "Queued — the processor will pick it up."),
    },
  };

  // One call shape for all four controls: POST, surface the server's message on
  // failure, then let the wizard re-fetch. A 202 from /pause or /cancel means
  // "the run has been aborted", not "the row already says stopped" — the runner
  // still needs a moment to unwind; /resume and /retry re-enqueue.
  async function run(action: Action) {
    if (action === "cancel") {
      const ok = window.confirm(
        "Stop this generation now? It stops immediately, so any partial build output is discarded. " +
          "It cannot be resumed — you would have to retry the run from the start.",
      );
      if (!ok) return;
    }
    setBusy(action);
    try {
      const res = await fetch(`/api/template-engine/generations/${gen.id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ kind: "error", title: MESSAGES[action].fail, body: body.error ?? "Try again" });
        return;
      }
      const { status } = (await res.json().catch(() => ({}))) as { status?: string };
      toast({ kind: "info", title: MESSAGES[action].title, body: MESSAGES[action].body(status ?? "") });
      onChanged?.();
    } catch {
      toast({ kind: "error", title: MESSAGES[action].fail, body: "Network error — please try again." });
    } finally {
      setBusy(null);
    }
  }

  function ControlButton({
    action, icon: Icon, label, tone = "default",
  }: {
    action: Action;
    icon: typeof Pause;
    label: string;
    tone?: "default" | "danger";
  }) {
    return (
      <button
        type="button"
        onClick={() => run(action)}
        disabled={busy !== null}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60",
          tone === "danger"
            ? "border-dropped-fg/30 bg-surface text-dropped-fg hover:bg-dropped-bg"
            : "border-border bg-surface text-text hover:bg-surface-2",
        )}
      >
        {busy === action ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
        {label}
      </button>
    );
  }

  // Re-tick every 30s so the countdown stays honest between realtime pokes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [running]);
  const eta = running ? buildEtaLabel(steps, gen.estimate_ms, now) : null;

  return (
    <div className="space-y-4">
      {/* Stale = the content or images changed after this site was built. */}
      <StaleNotice gen={gen} step="build" onDone={() => onChanged?.()} />

      {gen.status === "failed" ? (
        <div className="rounded-md border border-dropped-fg/30 bg-dropped-bg p-4 text-sm text-dropped-fg">
          <p className="font-medium">Generation failed</p>
          <p className="mt-1">{gen.error ?? "Unknown error"}</p>
          <div className="mt-3">
            <ControlButton action="retry" icon={RotateCcw} label="Retry run" />
          </div>
        </div>
      ) : null}

      {cancelled ? (
        <div className="rounded-md border border-dropped-fg/30 bg-dropped-bg p-4 text-sm text-dropped-fg">
          <p className="font-medium">Run stopped</p>
          <p className="mt-1">
            It was stopped immediately, so any partial build output was discarded. The brief, content model and image
            picks were kept — retry starts it again from the last point its work survives.
          </p>
          <div className="mt-3">
            <ControlButton action="retry" icon={RotateCcw} label="Retry run" />
          </div>
        </div>
      ) : null}

      {paused ? (
        <div className="rounded-md border border-notready-fg/30 bg-notready-bg p-4 text-sm text-notready-fg">
          <p className="font-medium">Paused at {pausedAtLabel(gen, steps)}</p>
          <p className="mt-1">
            The brief, content model and image picks are all intact. Only the step that was running was cut short, so
            Resume puts it back in the pipeline and re-runs that step.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ControlButton action="resume" icon={Play} label="Resume" />
            <ControlButton action="cancel" icon={Square} label="Stop" tone="danger" />
          </div>
        </div>
      ) : null}

      {running ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 p-3">
          <ControlButton action="pause" icon={Pause} label="Pause" />
          <ControlButton action="cancel" icon={Square} label="Stop" tone="danger" />
          <p className="text-xs text-text-muted">
            {stopping
              ? "Stopping now — cutting the current step short and tidying up."
              : "Stops immediately: the current step is cut short and its work discarded. Completed steps are kept."}
          </p>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Pipeline</h2>
          <div className="flex items-center gap-2">
            {eta ? <span className="text-xs text-text-faint">{eta}</span> : null}
            {/* Re-runs prepare -> build -> verify -> finalize. Reads the content
                model and image picks; never writes them, so nothing the
                operator typed or chose is at risk. */}
            <RedoButton gen={gen} step="build" onDone={() => onChanged?.()} label="Redo build" />
          </div>
        </div>
        {steps.length === 0 ? (
          <p className="text-sm text-text-muted">Waiting for the processor to pick this run up…</p>
        ) : (
          <ol className="space-y-2">
            {steps.map((s) => (
              <li key={s.key} className="flex items-start gap-2.5 text-sm">
                <StepIcon status={s.status} />
                <div className="min-w-0 flex-1">
                  <p className={cn("leading-5", s.status === "pending" ? "text-text-faint" : "text-text")}>
                    {s.label}
                    {typeof s.ms === "number" ? <span className="ml-2 text-xs text-text-faint">{(s.ms / 1000).toFixed(1)}s</span> : null}
                  </p>
                  {s.detail ? <p className="truncate text-xs text-text-muted" title={s.detail}>{s.detail}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {gen.gate_results ? (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-text-faint">Verification gates</h2>
          <p className={cn("mb-2 text-sm font-medium", gen.gate_results.ok ? "text-accent-ink" : "text-dropped-fg")}>
            {gen.gate_results.ok ? "All gates passed" : "Gates failed"}
          </p>
          <ul className="space-y-1 text-sm">
            <li className={gen.gate_results.leaks.length === 0 ? "text-text-muted" : "text-dropped-fg"}>
              Demo-identity leak scan: {gen.gate_results.leaks.length === 0 ? "clean" : `${gen.gate_results.leaks.length} leaks`}
            </li>
            {gen.gate_results.structure.map((f) => (
              <li key={f.file} className={f.ok ? "text-text-muted" : "text-dropped-fg"}>
                {f.file}: {f.ok ? "structure preserved" : f.detail ?? "structure changed"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
