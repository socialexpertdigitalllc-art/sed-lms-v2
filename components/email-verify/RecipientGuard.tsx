"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEmailVerify } from "@/hooks/useEmailVerify";
import { primaryReason, reasonTexts } from "@/lib/email-verify/labels";

/**
 * Recipient check for a send surface.
 *
 * Policy, deliberately asymmetric:
 *  - WARN never blocks. It is a note next to the send button; the user proceeds.
 *  - BLOCK disables send — but only ever for deterministic failures (malformed
 *    address, NXDOMAIN, RFC 7505 null MX, no MX and no A/AAAA), which is all the
 *    engine will ever return BLOCK for — and always offers "Send anyway".
 *
 * A send is never silently dropped: either it goes, or the user is looking at
 * the reason it didn't.
 */
export function useRecipientGuard(email: string, { enabled = true }: { enabled?: boolean } = {}) {
  const verify = useEmailVerify(email, { enabled });
  const key = email.trim().toLowerCase();

  // The override is stored WITH the address it was granted for, so a different
  // recipient can never inherit it — no reset effect, no window where send is
  // wrongly enabled.
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const overridden = overrideFor !== null && overrideFor === key;

  const allowAnyway = useCallback(() => setOverrideFor(key), [key]);

  const verdict = verify.result?.verdict ?? null;
  return {
    ...verify,
    verdict,
    overridden,
    allowAnyway,
    /** True while send must stay disabled. */
    blocked: verdict === "BLOCK" && !overridden,
  };
}

export type RecipientGuard = ReturnType<typeof useRecipientGuard>;

/**
 * Inline strip above a send action. Renders nothing when there is nothing worth
 * saying (idle, still checking with no prior answer, or an OK verdict).
 */
export function RecipientGuardStrip({ guard, className }: { guard: RecipientGuard; className?: string }) {
  const { result, phase, deepBusy, overridden, allowAnyway } = guard;

  if (phase === "checking" && !result) {
    return (
      <p className={cn("flex items-center gap-1.5 text-[11px] text-text-faint", className)}>
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        Checking the recipient…
      </p>
    );
  }

  // Errors stay silent: a failed check must never imply a bad address.
  if (!result || result.verdict === "OK") return null;

  const block = result.verdict === "BLOCK";
  const reasons = block ? reasonTexts(result.reasons) : [primaryReason(result.reasons) ?? "This address may not deliver."];

  return (
    <div
      role={block ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md px-2.5 py-2 text-[11px] leading-relaxed ring-1 ring-inset",
        block ? "bg-dropped-bg text-dropped-fg ring-dropped-fg/20" : "bg-notready-bg text-notready-fg ring-notready-fg/20",
        className,
      )}
    >
      {block ? (
        <XCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p>
          <span className="font-medium">{block ? "This address cannot receive mail." : "Heads up —"}</span>{" "}
          {reasons.join(" ")}
        </p>
        <p className="tabular truncate font-mono text-[10px] opacity-80" title={result.email}>
          {result.normalized || result.email}
        </p>
        {block ? (
          overridden ? (
            <p className="font-medium">Override on — sending anyway.</p>
          ) : (
            <button
              type="button"
              onClick={allowAnyway}
              className={cn(
                "rounded-md border border-current px-2 py-1 text-[11px] font-medium transition-colors duration-150",
                "hover:bg-danger hover:text-white",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              )}
            >
              Send anyway
            </button>
          )
        ) : null}
      </div>
      {deepBusy ? <Loader2 className="mt-px h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden /> : null}
    </div>
  );
}
