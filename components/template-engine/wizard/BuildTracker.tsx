"use client";

import { AlertTriangle, CheckCircle2, Circle, Loader2, MinusCircle } from "lucide-react";
import type { GenStep } from "@/lib/template-engine/types";
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

export function BuildTracker({ gen }: { gen: GenerationDetail }) {
  const steps = Array.isArray(gen.steps) ? gen.steps : [];
  const running = ACTIVE_STATUSES.has(gen.status);

  return (
    <div className="space-y-4">
      {gen.status === "failed" ? (
        <div className="rounded-md border border-dropped-fg/30 bg-dropped-bg p-4 text-sm text-dropped-fg">
          <p className="font-medium">Generation failed</p>
          <p className="mt-1">{gen.error ?? "Unknown error"}</p>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Pipeline</h2>
          {running && gen.estimate_ms ? (
            <span className="text-xs text-text-faint">Typically ~{Math.round(gen.estimate_ms / 60000)} min</span>
          ) : null}
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
