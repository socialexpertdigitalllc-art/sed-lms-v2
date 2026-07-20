"use client";

import { useState } from "react";
import { History, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { parseImageSlots } from "@/lib/template-engine/imageSlots";
import {
  canRedoFrom, describeImagesRedoLoss, isStale, redoSpec, staleNote, type RedoStepKey,
} from "@/lib/template-engine/redo";
import type { GenerationDetail } from "./GenerationWizard";
import { cn } from "@/lib/utils";

/**
 * The Redo control for one step. Renders nothing when the run's current status
 * does not allow that redo (the pure table in lib/template-engine/redo.ts is the
 * single source of truth for that, on both sides of the wire).
 *
 * A destructive redo — images — goes through a confirm dialog that states the
 * exact loss in numbers before it will POST `confirm: true`. That dialog closes
 * only via its own buttons (house rule).
 */
export function RedoButton({ gen, step, onDone, label, tone = "default" }: {
  gen: GenerationDetail;
  step: RedoStepKey;
  onDone: () => void;
  /** Defaults to "Redo <step label>". */
  label?: string;
  tone?: "default" | "stale";
}) {
  const spec = redoSpec(step);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { toast } = useToast();

  if (!spec || !canRedoFrom(step, gen.status)) return null;

  async function post() {
    setConfirming(false);
    setBusy(true);
    try {
      const res = await fetch(`/api/template-engine/generations/${gen.id}/redo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, confirm: true }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ kind: "error", title: "Could not redo", body: body.error ?? "Try again" });
        return;
      }
      toast({
        kind: "info",
        title: `Redoing the ${spec!.label} step`,
        body: spec!.invalidates.length
          ? "The steps after it are marked out of date until you redo them too."
          : "Watch it on the Build step.",
      });
      onDone();
    } catch {
      toast({ kind: "error", title: "Could not redo", body: "Network error — please try again." });
    } finally {
      setBusy(false);
    }
  }

  const loss = describeImagesRedoLoss(parseImageSlots(gen.image_slots));
  return (
    <>
      <button
        type="button"
        onClick={() => (spec.destructive ? setConfirming(true) : post())}
        disabled={busy}
        title={spec.summary}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-60",
          tone === "stale"
            ? "border-notready-fg/40 bg-surface text-notready-fg hover:bg-notready-bg"
            : "border-border bg-surface text-text-muted hover:text-text",
        )}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {label ?? `Redo ${spec.label}`}
      </button>

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="dialog" aria-modal="true" aria-label="Re-gather all images?">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-text">
              <TriangleAlert className="h-4 w-4 text-notready-fg" /> Re-gather all images?
            </h3>
            <p className="mt-2 text-sm text-text-muted">{loss}</p>
            <p className="mt-2 text-sm text-text-muted">
              Your content stays exactly as it is — only the image candidates are replaced.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">
                Keep my images
              </button>
              <button type="button" onClick={post}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">
                Re-gather anyway
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * The amber "this ran before the step above it changed" marker, plus the
 * one-click way to fix it. Clear, not alarming: nothing is broken, the operator
 * simply has a choice to make. Renders nothing unless the step is marked stale.
 */
export function StaleNotice({ gen, step, onDone }: {
  gen: GenerationDetail; step: RedoStepKey; onDone: () => void;
}) {
  if (!isStale(gen.stale_steps, step)) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-notready-fg/30 bg-notready-bg px-3 py-2 text-sm text-notready-fg">
      {/* History, not a warning triangle: nothing is broken, this step simply
          ran against an older version of the step above it. */}
      <span className="inline-flex items-center gap-1.5 font-medium">
        <History className="h-3.5 w-3.5" /> {staleNote(step)}
      </span>
      <RedoButton gen={gen} step={step} onDone={onDone} label="Redo this too" tone="stale" />
    </div>
  );
}
