"use client";

import { Check, CircleDashed, Clock, Loader2, X } from "lucide-react";
import { Pill, type PillTone } from "@/components/common/Panel";
import { cn } from "@/lib/utils";
import {
  HEALTH_LABELS,
  STATUS_LABELS,
  STEP_LABELS,
  stepsFor,
  type ClientDomainRow,
  type DomainStatus,
  type HealthState,
  type StepKey,
} from "@/lib/domains/types";

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

const DAY_MS = 86_400_000;

/** Whole days until the date (negative once past), or null when unknown. */
export function daysLeft(iso: string | null | undefined, now: number): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : Math.ceil((t - now) / DAY_MS);
}

const HEALTH_TONE: Record<HealthState, PillTone> = {
  up: "ready",
  down: "dropped",
  ssl_error: "dropped",
  parked: "neutral",
  no_dns: "neutral",
};

const HEALTH_DOT: Record<HealthState, string> = {
  up: "bg-ready-fg",
  down: "bg-dropped-fg",
  ssl_error: "bg-notready-fg",
  parked: "bg-text-faint",
  no_dns: "bg-text-faint",
};

export function HealthPill({ state }: { state: HealthState | null }) {
  if (!state) return <Pill tone="neutral">Not checked</Pill>;
  return <Pill tone={HEALTH_TONE[state]}>{HEALTH_LABELS[state]}</Pill>;
}

/** Compact site-health marker for table rows; the summary shows on hover. */
export function HealthDot({ state, summary }: { state: HealthState | null; summary?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted" title={summary ?? undefined}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", state ? HEALTH_DOT[state] : "bg-border")} aria-hidden />
      {state ? HEALTH_LABELS[state] : "—"}
    </span>
  );
}

/** The registration's own state, when it isn't simply active. */
export function RegistrationPill({ status }: { status: string | null }) {
  if (status === "expired") return <Pill tone="dropped">Expired</Pill>;
  if (status === "missing") return <Pill tone="neutral">Left account</Pill>;
  if (status === "pending") return <Pill tone="accent">Registering</Pill>;
  return null;
}

export function AutoRenewLabel({ value }: { value: boolean | null }) {
  if (value === true) return <span className="text-xs font-medium text-ready-fg">On</span>;
  if (value === false) return <span className="text-xs font-semibold text-notready-fg">Off</span>;
  return <span className="text-xs text-text-faint">—</span>;
}

/** Expiry date with what it means: "in 6d" when close and not renewing, "expired 9d ago". */
export function ExpiryLabel({
  row,
  now,
}: {
  row: Pick<ClientDomainRow, "expires_at" | "auto_renew" | "registrar_status">;
  now: number;
}) {
  if (!row.expires_at) return <span className="text-text-faint">—</span>;
  const d = daysLeft(row.expires_at, now);
  const date = new Date(row.expires_at).toLocaleDateString();
  if (row.registrar_status === "expired" || (d !== null && d < 0)) {
    const ago = d === null ? null : Math.abs(d);
    return (
      <span>
        {date} <span className="text-xs font-semibold text-dropped-fg">{ago === null ? "expired" : `expired ${ago}d ago`}</span>
      </span>
    );
  }
  const risky = d !== null && d <= 30 && row.auto_renew !== true;
  return (
    <span>
      {date} {risky ? <span className="text-xs font-semibold text-notready-fg">in {d}d</span> : null}
    </span>
  );
}
