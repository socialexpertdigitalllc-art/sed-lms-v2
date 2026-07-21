"use client";

// The upload-time health report, rendered. See lib/template-engine/health.ts for
// what the checks are and why each one exists — the short version is that three
// production bugs (an unpassable leak gate, colours that bound nothing, a
// missing logo slot with 404ing menu links) were all invisible until generation
// time, and this is where they become visible at upload instead.

import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
import type { HealthReport, HealthSeverity } from "@/lib/template-engine/health";
import { cn } from "@/lib/utils";

/** Design-token classes per severity, plus the "never checked" null case. */
const TONE: Record<HealthSeverity, { pill: string; icon: typeof CheckCircle2; label: string }> = {
  pass: { pill: "bg-ready-bg text-ready-fg", icon: CheckCircle2, label: "healthy" },
  warn: { pill: "bg-notready-bg text-notready-fg", icon: AlertTriangle, label: "warnings" },
  fail: { pill: "bg-dropped-bg text-dropped-fg", icon: XCircle, label: "failing" },
};

export function healthOf(v: unknown): HealthReport | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Partial<HealthReport>;
  if (r.status !== "pass" && r.status !== "warn" && r.status !== "fail") return null;
  return { status: r.status, checks: Array.isArray(r.checks) ? r.checks : [], checkedAt: r.checkedAt ?? "" };
}

/** A one-glance status pill. `null` means the template predates the check. */
export function HealthPill({ report, className }: { report: HealthReport | null; className?: string }) {
  if (!report) {
    return (
      <span
        title="This template was uploaded before health checks existed. Use Re-check to run them."
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-faint",
          className
        )}
      >
        <HelpCircle className="h-3 w-3" /> not checked
      </span>
    );
  }
  const tone = TONE[report.status];
  const Icon = tone.icon;
  const bad = report.checks.filter((c) => c.severity !== "pass").length;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tone.pill, className)}
    >
      <Icon className="h-3 w-3" />
      {tone.label}
      {bad > 0 ? ` (${bad})` : ""}
    </span>
  );
}

/** The full report: every check with what was found and what to do about it. */
export function HealthChecks({ report }: { report: HealthReport | null }) {
  if (!report) {
    return (
      <p className="text-xs text-text-faint">
        No health report yet — this template was uploaded before the checks existed. Run a re-check to see how it
        will behave at generation time.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {report.checks.map((c) => {
        const tone = TONE[c.severity];
        const Icon = tone.icon;
        return (
          <li key={c.id} className="rounded-md border border-border-subtle bg-surface-2 p-3">
            <div className="flex items-start gap-2">
              <Icon
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  c.severity === "pass" ? "text-ready-fg" : c.severity === "warn" ? "text-notready-fg" : "text-dropped-fg"
                )}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{c.label}</p>
                <p className="mt-0.5 text-xs text-text-muted">{c.detail}</p>
                {c.severity !== "pass" ? (
                  <p className="mt-1 text-xs text-text-faint">
                    <span className="font-medium">Fix:</span> {c.hint}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
