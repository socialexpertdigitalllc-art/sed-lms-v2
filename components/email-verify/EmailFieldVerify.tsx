"use client";

import { AlertTriangle, Check, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEmailVerify } from "@/hooks/useEmailVerify";
import { primaryReason } from "@/lib/email-verify/labels";
import { DeepVerifyButton, SuggestionChip } from "@/components/email-verify/VerifyParts";

/**
 * Advisory verification for an email field on a form.
 *
 * Free local checks run automatically, debounced — never per keystroke and
 * never a provider call. The paid check is a deliberate button press. Nothing
 * here can stop a form being submitted: an agent who has the customer on the
 * phone is a better authority than a DNS lookup.
 */
export function EmailFieldVerify({
  email,
  onAccept,
  disabled,
  className,
}: {
  email: string;
  /** Called when the user clicks the typo suggestion. Never fired automatically. */
  onAccept: (value: string) => void;
  /** Skip verification entirely (e.g. the "no email" checkbox is ticked). */
  disabled?: boolean;
  className?: string;
}) {
  const { phase, result, error, deepBusy, deepVerify } = useEmailVerify(email, { enabled: !disabled });

  if (disabled || phase === "idle") return null;

  const reason = result ? primaryReason(result.reasons) : null;

  return (
    <div className={cn("mt-1.5 space-y-1.5", className)} aria-live="polite">
      {phase === "checking" && !result ? (
        <p className="flex items-center gap-1.5 text-[11px] text-text-faint">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          Checking address…
        </p>
      ) : null}

      {error ? (
        <p className="flex items-center gap-1.5 text-[11px] text-text-faint">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {result ? (
        <>
          {result.verdict === "OK" ? (
            <p className="flex items-center gap-1.5 text-[11px] text-ready-fg">
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {result.localOnly ? "Address checks out" : "Mailbox confirmed"}
            </p>
          ) : (
            <p
              className={cn(
                "flex items-start gap-1.5 text-[11px] leading-relaxed",
                result.verdict === "BLOCK" ? "text-dropped-fg" : "text-notready-fg",
              )}
            >
              {result.verdict === "BLOCK" ? (
                <XCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              <span>{reason ?? "This address may not deliver."}</span>
            </p>
          )}

          {result.suggestion ? <SuggestionChip suggestion={result.suggestion} onAccept={onAccept} /> : null}

          {/* Deep verify stays available even on OK — an agent may want certainty. */}
          {result.normalized ? (
            <DeepVerifyButton onClick={deepVerify} busy={deepBusy} done={!result.localOnly} compact />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
