"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Loader2, MailCheck, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEmailVerify } from "@/hooks/useEmailVerify";
import { reasonTexts, VERDICT_LABEL } from "@/lib/email-verify/labels";
import {
  CopyButton,
  DeepVerifyButton,
  ResultFootnotes,
  SuggestionChip,
  VERDICT_STYLE,
} from "@/components/email-verify/VerifyParts";

/**
 * The standalone verifier — deliberately one address at a time so the whole
 * thing is usable in a ~400×600 installed window. Local checks are free and run
 * as you type; the provider is only touched when you press "Deep verify".
 */
export function VerifyApp() {
  const [email, setEmail] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced so typing never fires a request per keystroke; Enter skips the wait.
  const { phase, result, error, deepBusy, checkNow, deepVerify } = useEmailVerify(email, { debounceMs: 450 });

  function accept(suggestion: string) {
    setEmail(suggestion);
    inputRef.current?.focus();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    checkNow();
  }

  const style = result ? VERDICT_STYLE[result.verdict] : null;
  const VerdictIcon = style?.icon;
  const reasons = result ? reasonTexts(result.reasons) : [];
  const busy = phase === "checking";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent text-white">
          <MailCheck className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-base font-semibold leading-tight text-text">Email Verifier</h1>
          <p className="text-[11px] leading-tight text-text-muted">Free checks run instantly. Deep verify costs a credit.</p>
        </div>
      </header>

      <form onSubmit={submit} className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
          <input
            ref={inputRef}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            aria-label="Email address to verify"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className={cn(
              "tabular w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 font-mono text-sm text-text",
              "outline-none transition-colors duration-150 focus:ring-2 focus:ring-accent",
            )}
          />
        </div>
        <button
          type="submit"
          title="Run the free checks"
          aria-label="Run the free checks"
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-white",
            "transition-colors duration-150 hover:bg-accent-ink",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </button>
      </form>

      {/* ---------------- result surface ---------------- */}
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-dropped-fg/20 bg-dropped-bg px-3 py-2.5 text-xs leading-relaxed text-dropped-fg"
        >
          <AlertTriangle className="mt-px h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : result && style && VerdictIcon ? (
        <section aria-live="polite" className="flex min-w-0 flex-col gap-3">
          {/* Big verdict */}
          <div className={cn("flex items-center gap-3 rounded-lg px-3.5 py-3 ring-1 ring-inset", style.bg, style.ring)}>
            <VerdictIcon className={cn("h-7 w-7 shrink-0", style.fg)} aria-hidden />
            <div className="min-w-0">
              <p className={cn("font-display text-lg font-semibold leading-tight", style.fg)}>{result.verdict}</p>
              <p className={cn("text-xs leading-tight", style.fg)}>{VERDICT_LABEL[result.verdict]}</p>
            </div>
          </div>

          {/* Normalised address + copy */}
          {result.normalized ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 py-1.5 pl-3 pr-1.5">
              <span className="tabular min-w-0 flex-1 truncate font-mono text-xs text-text" title={result.normalized}>
                {result.normalized}
              </span>
              <CopyButton value={result.normalized} />
            </div>
          ) : null}

          {result.suggestion ? <SuggestionChip suggestion={result.suggestion} onAccept={accept} /> : null}

          {/* Reasons */}
          {reasons.length > 0 ? (
            <ul className="space-y-1.5">
              {reasons.map((r, i) => (
                <li key={`${r}-${i}`} className="flex items-start gap-2 text-xs leading-relaxed text-text-muted">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-text-faint" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <ResultFootnotes provider={result.provider} cached={result.cached} verifiedAt={result.verifiedAt} />

          {/* The one paid action, kept away from the free path. */}
          <DeepVerifyButton
            onClick={deepVerify}
            busy={deepBusy}
            done={!result.localOnly}
            disabled={!result.normalized}
            className="w-full"
          />
          <p className="text-[11px] leading-relaxed text-text-faint">
            Deep verify asks a mail-verification provider directly and uses one credit from the daily allowance.
          </p>
        </section>
      ) : busy ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-3 text-xs text-text-muted">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden />
          Running the free checks…
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-accent-soft text-accent-ink">
            <MailCheck className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-text">Check an address</p>
          <p className="max-w-[16rem] text-xs leading-relaxed text-text-muted">
            Type an email and press Enter. Syntax, typo, disposable and DNS checks are free and instant.
          </p>
        </div>
      )}
    </div>
  );
}
