"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Circle, Loader2, MinusCircle, Pause, Play, PlugZap, RotateCcw, Square,
} from "lucide-react";
import type { GenStep } from "@/lib/template-engine/types";
import { buildEtaLabel } from "@/lib/template-engine/wizard";
import { isOrphaned, orphanSilenceMinutes } from "@/lib/template-engine/liveness";
import { useToast } from "@/components/common/Toast";
import { RedoButton, StaleNotice } from "./RedoControls";
import type { GenerationDetail } from "./GenerationWizard";
import { cn } from "@/lib/utils";

function StepIcon({ status, stalled }: { status: GenStep["status"]; stalled?: boolean }) {
  // A `running` step on a run that stopped responding is the endless spinner
  // this change exists to kill — it is not running and it did not fail, so it
  // gets the "needs attention" mark rather than either lie.
  if (stalled && status === "running") return <AlertTriangle className="h-4 w-4 text-notready-fg" />;
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

/**
 * How long a "Stopping…" may last before the UI offers the force option.
 *
 * The stop itself is instant (the API aborts the in-flight AI call in process);
 * all that remains is the runner unwinding and writing its final row, which is
 * one database round-trip. Ten seconds of no status change means something is
 * wrong — most likely that there was never a runner to hear the click, which is
 * exactly the case that used to spin forever.
 */
const STOPPING_PATIENCE_MS = 10_000;

export function BuildTracker({ gen, onChanged }: { gen: GenerationDetail; onChanged?: () => void }) {
  const steps = Array.isArray(gen.steps) ? gen.steps : [];
  const inFlight = ACTIVE_STATUSES.has(gen.status);
  const paused = gen.status === "paused";
  const cancelled = gen.status === "cancelled";
  // The API aborts the run's in-flight AI call in process, so the stop itself
  // is instant — but the runner still has to unwind and write its final row, so
  // there is a brief window where the operator has clicked and the status has
  // not moved yet. Say so rather than looking unresponsive.
  const stopping = inFlight && (gen.control === "pause" || gen.control === "cancel");
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
  async function run(action: Action, force = false) {
    if (action === "cancel" && !force) {
      const ok = window.confirm(
        "Stop this generation now? It stops immediately, so any partial build output is discarded. " +
          "It cannot be resumed — you would have to retry the run from the start.",
      );
      if (!ok) return;
    }
    if (force) {
      const ok = window.confirm(
        "Force stop this run? Use this when the run is not responding — it marks the run stopped, frees the queue " +
          "and discards any partial build output, without waiting for the process that was building it.",
      );
      if (!ok) return;
    }
    setBusy(action);
    try {
      const res = await fetch(`/api/template-engine/generations/${gen.id}/${action}`, {
        method: "POST",
        ...(force
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) }
          : {}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ kind: "error", title: MESSAGES[action].fail, body: body.error ?? "Try again" });
        return;
      }
      const { status, forced: wasForced } = (await res.json().catch(() => ({}))) as {
        status?: string;
        forced?: boolean;
      };
      // `forced` is the server telling us it resolved a run that was not
      // responding, rather than one that stopped cooperatively. Those are very
      // different events for an operator and must not read the same.
      toast(
        wasForced
          ? {
              kind: "info",
              title: action === "pause" ? "Paused a run that had stopped responding" : "Stopped a run that was no longer responding",
              body: "Its process was gone, so it was resolved here. The queue is free again.",
            }
          : { kind: "info", title: MESSAGES[action].title, body: MESSAGES[action].body(status ?? "") },
      );
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

  // Re-tick while the run claims to be in flight, so both the countdown and the
  // liveness check stay honest between realtime pokes. 5s (rather than the 30s
  // this used to be) because it now decides whether the operator is looking at a
  // live build or a ghost, and being 30s late to say so is 30s of lying.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [inFlight]);

  // THE GHOST CHECK. Computed from the same pure helper the API uses, so the
  // screen and the server can never disagree about whether a run is alive.
  const orphaned = isOrphaned({
    status: gen.status,
    heartbeatAt: gen.heartbeat_at,
    updatedAt: gen.updated_at,
    now,
  });
  const silentFor = orphanSilenceMinutes({ heartbeatAt: gen.heartbeat_at, updatedAt: gen.updated_at, now });
  // "Running" is now a claim we verify rather than a status we believe: the
  // spinner, the ETA and the Pause/Stop controls all belong to a live run only.
  const running = inFlight && !orphaned;

  // A stop that has not landed. `stopping` comes from the row; this measures how
  // long WE have been watching it stay that way, which needs no extra column and
  // survives the runner being gone (the case where nothing will ever update the
  // row again). Resets whenever the flag clears.
  const stoppingSince = useRef<number | null>(null);
  if (stopping && stoppingSince.current === null) stoppingSince.current = Date.now();
  if (!stopping) stoppingSince.current = null;
  const stoppingStuck =
    stopping && stoppingSince.current !== null && now - stoppingSince.current > STOPPING_PATIENCE_MS;

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

      {/* THE GHOST PANEL. The row still says "building", but nothing has
          reported activity in minutes — the process running it is gone (a deploy
          restart is the usual cause). This used to be an endless spinner, and
          pressing Stop did nothing at all, because Stop only writes a flag that a
          live runner reads. Say what happened and offer the two things that
          actually work: force stop, and retry. */}
      {orphaned ? (
        <div className="rounded-md border border-dropped-fg/30 bg-dropped-bg p-4 text-sm text-dropped-fg">
          <p className="flex items-center gap-1.5 font-medium">
            <PlugZap className="h-4 w-4" />
            This run stopped responding
          </p>
          <p className="mt-1">
            No activity for {silentFor} minute{silentFor === 1 ? "" : "s"}. The process that was building it is gone, so
            it cannot stop itself and it is holding up the queue. Force stop clears it out; the brief, content model and
            image picks are kept, so Retry starts again from the last point its work survives.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => run("cancel", true)}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-md border border-dropped-fg/30 bg-surface px-3 py-1.5 text-sm font-medium text-dropped-fg hover:bg-dropped-bg disabled:opacity-60"
            >
              {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              Force stop
            </button>
            <ControlButton action="retry" icon={RotateCcw} label="Retry run" />
          </div>
        </div>
      ) : null}

      {running ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 p-3">
          <ControlButton action="pause" icon={Pause} label="Pause" />
          <ControlButton action="cancel" icon={Square} label="Stop" tone="danger" />
          {/* A stop that has not landed within STOPPING_PATIENCE_MS is the early
              warning for the same problem: almost certainly nobody heard it. */}
          {stoppingStuck ? (
            <button
              type="button"
              onClick={() => run("cancel", true)}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-md border border-dropped-fg/30 bg-surface px-3 py-1.5 text-sm font-medium text-dropped-fg hover:bg-dropped-bg disabled:opacity-60"
            >
              <PlugZap className="h-4 w-4" />
              Force stop
            </button>
          ) : null}
          <p className="text-xs text-text-muted">
            {stoppingStuck
              ? "Still stopping — this is taking longer than it should. Force stop resolves it here without waiting."
              : stopping
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
                <StepIcon status={s.status} stalled={orphaned} />
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
