"use client";

import { Check, CircleDashed, Clock, Loader2, X } from "lucide-react";
import { Pill, type PillTone } from "@/components/common/Panel";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, STEP_LABELS, stepsFor, type ClientDomainRow, type DomainStatus, type StepKey } from "@/lib/domains/types";

const TONE: Record<DomainStatus, PillTone> = {
  purchasing: "accent",
  setting_up: "accent",
  waiting_for_site: "notready",
  live: "ready",
  connected: "ready",
  unassigned: "neutral",
  needs_attention: "dropped",
  failed: "dropped",
};

export function DomainStatusPill({ status }: { status: DomainStatus }) {
  return <Pill tone={TONE[status]}>{STATUS_LABELS[status]}</Pill>;
}

export const money = (cents: number | null | undefined, currency = "USD") =>
  cents === null || cents === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

/** True while the background pipeline is still working on the domain. */
export function isWorking(status: DomainStatus): boolean {
  return status === "purchasing" || status === "setting_up";
}

/**
 * The setup checklist: every step for the registrar, with its state and the
 * pipeline's own words about it. Imported domains that were set up by hand
 * have no checklist — there is nothing to run.
 */
export function DomainSteps({ row }: { row: Pick<ClientDomainRow, "registrar" | "steps" | "step" | "status"> }) {
  if (row.status === "connected" || row.status === "unassigned") return null;
  return (
    <ol className="space-y-1.5">
      {stepsFor(row.registrar).map((key: StepKey) => {
        const p = row.steps?.[key];
        const state = p?.state ?? (row.status === "live" ? "done" : "pending");
        const active = row.step === key && isWorking(row.status);
        const icon =
          state === "done" ? (
            <Check className="h-3.5 w-3.5 text-ready-fg" />
          ) : state === "failed" ? (
            <X className="h-3.5 w-3.5 text-dropped-fg" />
          ) : active || state === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-ink" />
          ) : state === "waiting" ? (
            <Clock className="h-3.5 w-3.5 text-notready-fg" />
          ) : (
            <CircleDashed className="h-3.5 w-3.5 text-text-faint" />
          );
        return (
          <li key={key} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span className="min-w-0">
              <span className={cn("font-medium", state === "pending" ? "text-text-faint" : "text-text")}>{STEP_LABELS[key]}</span>
              {p?.detail ? <span className="block text-text-muted">{p.detail}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
