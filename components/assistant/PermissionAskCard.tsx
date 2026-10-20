"use client";

import { useState } from "react";
import { Check, Loader2, ShieldQuestion } from "lucide-react";
import { MODE_RANK, modeInfo, type PermissionMode } from "@/lib/assistant/actions/permissions";
import { btnPrimary, btnSecondarySm } from "@/components/common/buttons";
import { cn } from "@/lib/utils";
import { MODE_ICON } from "./PermissionModePicker";

/**
 * SED AI asked — once — for a higher permission mode so a big job can run
 * without a card per change. One click switches and carries the job on.
 */
export function PermissionAskCard({
  mode,
  reason,
  current,
  canDecide,
  onDecide,
  compact,
}: {
  /** What it asked for. */
  mode: PermissionMode;
  reason: string | null;
  /** The person's mode now (null while loading). */
  current: PermissionMode | null;
  /** The newest turn and nothing running: the buttons are live. */
  canDecide: boolean;
  /** A mode to switch to and carry on, or null to keep asking. */
  onDecide?: (mode: PermissionMode | null) => Promise<void> | void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<"switch" | "keep" | null>(null);
  const info = modeInfo(mode);
  const Icon = MODE_ICON[mode];
  const granted = current !== null && MODE_RANK[current] >= MODE_RANK[mode];
  const live = canDecide && !granted && Boolean(onDecide);

  async function decide(which: "switch" | "keep") {
    setBusy(which);
    try {
      await onDecide?.(which === "switch" ? mode : null);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="Permission request"
      className={cn("rounded-xl border px-3.5 py-3", granted ? "border-border bg-surface-2/60" : "border-accent/40 bg-accent-soft/40", compact ? "text-[13px]" : "text-sm")}
    >
      <p className="flex items-start gap-2 font-medium text-text">
        <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <span>
          Switch to <span className="whitespace-nowrap">“{info.label}”</span> for this job?
        </span>
      </p>
      {reason ? <p className="mt-1 pl-6 text-text-muted">{reason}</p> : null}
      <p className="mt-1 pl-6 text-xs text-text-faint">{info.description} You can switch back any time from the chip next to Act.</p>
      {granted ? (
        <p className="mt-2 flex items-center gap-1.5 pl-6 text-xs font-medium text-ready-fg">
          <Check className="h-3.5 w-3.5" aria-hidden /> Switched — the job carries on.
        </p>
      ) : live ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-6">
          <button type="button" className={cn(btnPrimary, "px-3 py-1.5 text-[13px]")} onClick={() => void decide("switch")} disabled={busy !== null}>
            {busy === "switch" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Icon className="h-3.5 w-3.5" aria-hidden />}
            Switch and continue
          </button>
          <button type="button" className={btnSecondarySm} onClick={() => void decide("keep")} disabled={busy !== null}>
            {busy === "keep" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Keep asking me
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** The permission request in a turn, from its request_permission_mode call. */
export function permissionAskOf(segments: { kind: string; name?: string; status?: string; summary?: string | null; args?: Record<string, unknown> | null }[]):
  | { mode: PermissionMode; reason: string | null }
  | null {
  for (const s of segments) {
    if (s.kind !== "tool" || s.name !== "request_permission_mode" || s.status !== "ok") continue;
    if (!(s.summary ?? "").startsWith("Asked")) continue;
    const mode = s.args?.mode;
    if (mode !== "auto_safe" && mode !== "auto") continue;
    return { mode, reason: typeof s.args?.reason === "string" ? s.args.reason : null };
  }
  return null;
}
