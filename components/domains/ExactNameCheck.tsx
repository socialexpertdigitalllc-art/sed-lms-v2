"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { Pill, type PillTone } from "@/components/common/Panel";
import { btnGhostSm } from "@/components/common/buttons";
import { money } from "@/components/domains/DomainBits";
import { formatRelative } from "@/lib/leads/format";
import type { LeadDomainCheck } from "@/lib/domains/leadCheck";

/** A check's answer in one word and a colour. PURE; tested. */
export function exactVerdict(check: Pick<LeadDomainCheck, "available" | "reason"> | null): { label: string; tone: PillTone } {
  if (!check) return { label: "Not checked", tone: "neutral" };
  if (check.available === null) return { label: "Couldn't check", tone: "neutral" };
  if (check.available) return { label: "Available", tone: "ready" };
  if (/premium/i.test(check.reason ?? "")) return { label: "Premium", tone: "notready" };
  if (!check.reason || /taken/i.test(check.reason)) return { label: "Taken", tone: "dropped" };
  return { label: "Not available", tone: "notready" };
}

/** "abcconstruction.com available" — for the collapsed Domain card's summary. PURE; tested. */
export function exactSummary(domain: string | null, check: LeadDomainCheck | null): string | null {
  if (!domain || !check || check.domain !== domain || check.available === null) return null;
  return `${domain} ${exactVerdict(check).label.toLowerCase()}`;
}

const POLL_MS = 4000;
const POLL_TRIES = 8;

/**
 * Is the business's exact name free as a .com? Checked automatically when the
 * lead turns Ready (lib/domains/leadCheck.ts); "Check again" asks now.
 */
export function ExactNameCheck({
  leadId,
  domain,
  initial,
  ready,
  onChange,
}: {
  leadId: string;
  /** The exact-name .com (null when the business name has nothing usable). */
  domain: string | null;
  initial: LeadDomainCheck | null;
  /** The lead is Ready, so a check is on its way if there isn't one yet. */
  ready: boolean;
  onChange?: (check: LeadDomainCheck | null) => void;
}) {
  const [check, setCheck] = useState<LeadDomainCheck | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  const update = useCallback(
    (c: LeadDomainCheck | null) => {
      setCheck(c);
      onChange?.(c);
    },
    [onChange],
  );

  // A check for an older business name doesn't count.
  const current = check && check.domain === domain ? check : null;

  // The check a status change to Ready started a moment ago: wait for it.
  const waiting = ready && Boolean(domain) && !current;
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const t = setInterval(() => {
      if (++tries > POLL_TRIES) {
        clearInterval(t);
        setGaveUp(true);
        return;
      }
      void fetch(`/api/leads/${leadId}/domain-check`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j?.check) update(j.check as LeadDomainCheck);
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, leadId, update]);

  async function recheck() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/domain-check`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(j.error ?? "Couldn't check right now.");
      else update(j.check as LeadDomainCheck);
    } catch {
      setError("Couldn't check right now.");
    } finally {
      setBusy(false);
    }
  }

  if (!domain) return null;
  const verdict = exactVerdict(current);

  return (
    <div className="rounded-lg border border-border-subtle p-3" data-testid="exact-name-check">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-faint">Exact name (.com)</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-text">{domain}</span>
        {current ? <Pill tone={verdict.tone}>{verdict.label}</Pill> : <Pill tone="neutral">{waiting && !gaveUp ? "Checking…" : "Not checked"}</Pill>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
        {current?.available ? (
          <span>
            {money(current.registration_cents, current.currency)} first year
            {current.renewal_cents !== null && current.renewal_cents !== current.registration_cents ? ` · ${money(current.renewal_cents, current.currency)}/yr after` : ""}
          </span>
        ) : current?.available === false && current.reason && verdict.label !== "Taken" ? (
          <span>{current.reason}</span>
        ) : current?.error ? (
          <span>{current.error}</span>
        ) : !current && !ready ? (
          <span>Checked automatically when the lead is Ready.</span>
        ) : null}
        {current ? <span title={new Date(current.checked_at).toLocaleString()}>checked {formatRelative(current.checked_at)}</span> : null}
        <button type="button" className={btnGhostSm} disabled={busy} onClick={() => void recheck()}>
          <RotateCw className={busy ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> {current ? "Check again" : "Check now"}
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-dropped-fg">{error}</p> : null}
    </div>
  );
}
