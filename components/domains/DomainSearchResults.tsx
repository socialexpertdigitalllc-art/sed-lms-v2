"use client";

import { useState } from "react";
import { Check, CircleCheck, CircleX, Copy, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { money } from "@/components/domains/DomainBits";
import type { DomainOffer, DomainSearch } from "@/lib/domains/service";

/**
 * A domain search's answer, in three groups that are never mixed: the exact
 * name searched for (first, on its own, available or taken), the same name on
 * other endings, then different names with what differs marked. Shared by the
 * Buy dialog (pick one) and the Check-a-name page (read only: no `onPick`).
 */

/** The part of a suggested name that differs from the searched one:
 *  abc[contractor] vs abc[construction]. PURE. */
export function differingPart(searched: string, candidate: string): { pre: string; mid: string; post: string } {
  let p = 0;
  while (p < searched.length && p < candidate.length && searched[p] === candidate[p]) p++;
  let q = 0;
  while (q < searched.length - p && q < candidate.length - p && searched[searched.length - 1 - q] === candidate[candidate.length - 1 - q]) q++;
  return { pre: candidate.slice(0, p), mid: candidate.slice(p, candidate.length - q), post: candidate.slice(candidate.length - q) };
}

/** A suggested name with what differs from the search marked, so a near-miss can't pass for the real thing. */
function MarkedName({ domain, searched }: { domain: string; searched: string | null }) {
  if (!searched) return <>{domain}</>;
  const d = differingPart(searched, domain);
  if (!d.mid) return <>{domain}</>;
  return (
    <>
      {d.pre}
      <mark className="rounded-sm bg-notready-bg px-px text-notready-fg">{d.mid}</mark>
      {d.post}
    </>
  );
}

/** Copy a name to the clipboard (read-only lists — handy on a call). */
function CopyName({ domain }: { domain: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${domain}`}
      aria-label={`Copy ${domain}`}
      onClick={() => {
        void navigator.clipboard?.writeText(domain).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
      className="shrink-0 rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-ready-fg" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function offerLine(o: DomainOffer): string {
  return o.available ? `${money(o.registrationCents, o.currency)} first year · renews ${money(o.renewalCents, o.currency)}/yr` : (o.reason ?? "Not available");
}

function OfferRow({
  o,
  picked,
  onPick,
  searched,
}: {
  o: DomainOffer;
  picked: DomainOffer | null;
  onPick?: (o: DomainOffer) => void;
  /** The exact name searched for — marks how this one differs. */
  searched?: string | null;
}) {
  const body = (
    <>
      {onPick ? (
        <Globe className="h-4 w-4 shrink-0 text-text-faint" />
      ) : o.available ? (
        <CircleCheck className="h-4 w-4 shrink-0 text-ready-fg" aria-label="Available" />
      ) : (
        <CircleX className="h-4 w-4 shrink-0 text-dropped-fg" aria-label="Not available" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          <MarkedName domain={o.domain} searched={searched ?? null} />
        </span>
        <span className="block text-xs text-text-faint">{offerLine(o)}</span>
      </span>
      {picked?.domain === o.domain ? <Check className="h-4 w-4 text-accent-ink" /> : null}
    </>
  );
  if (!onPick) {
    return (
      <li className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-text">
        {body}
        <CopyName domain={o.domain} />
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        disabled={!o.available}
        onClick={() => onPick(o)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
          !o.available ? "cursor-not-allowed opacity-50" : picked?.domain === o.domain ? "bg-accent-soft text-accent-ink" : "text-text hover:bg-surface-2",
        )}
      >
        {body}
      </button>
    </li>
  );
}

/** The name exactly as searched — first, on its own, available or taken. */
export function ExactMatch({ exact, picked = null, onPick }: { exact: NonNullable<DomainSearch["exact"]>; picked?: DomainOffer | null; onPick?: (o: DomainOffer) => void }) {
  const o = exact.offer;
  const available = Boolean(o?.available);
  const selected = picked?.domain === exact.domain;
  const look = cn(
    "flex w-full items-center gap-3 rounded-lg border-2 px-3.5 py-3 text-left transition-colors",
    available ? (selected ? "border-accent bg-accent-soft" : cn("border-ready-fg/40 bg-ready-bg/40", onPick && "hover:border-ready-fg/70")) : cn("border-dropped-fg/30 bg-dropped-bg/40", onPick && "cursor-not-allowed"),
  );
  const body = (
    <>
      {available ? <CircleCheck className="h-5 w-5 shrink-0 text-ready-fg" aria-hidden /> : <CircleX className="h-5 w-5 shrink-0 text-dropped-fg" aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-text">{exact.domain}</span>
        <span className={cn("block text-xs", available ? "text-ready-fg" : "text-dropped-fg")}>
          {!o
            ? "Couldn't get an answer for this name — search again."
            : available
              ? `Available · ${money(o.registrationCents, o.currency)} first year · renews ${money(o.renewalCents, o.currency)}/yr`
              : o.reason === "Taken"
                ? "Taken — someone already owns this name."
                : `Not available: ${o.reason ?? "can't be bought here"}`}
        </span>
      </span>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase", available ? "bg-ready-bg text-ready-fg" : "bg-dropped-bg text-dropped-fg")}>
        {available ? "Available" : o?.reason === "Taken" ? "Taken" : "Unavailable"}
      </span>
      {selected ? <Check className="h-4 w-4 shrink-0 text-accent-ink" /> : null}
    </>
  );
  return (
    <section aria-label="Exact match" className="p-2">
      <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        Exact match
        {exact.assumedTld ? <span className="font-normal normal-case tracking-normal">no ending typed, so .com was checked</span> : null}
      </p>
      {onPick ? (
        <button type="button" disabled={!available} onClick={() => o && onPick(o)} className={look}>
          {body}
        </button>
      ) : (
        <div className={look}>
          {body}
          <CopyName domain={exact.domain} />
        </div>
      )}
    </section>
  );
}

/** All three groups, or nothing when the search found nothing. */
export function DomainSearchResults({ results, picked = null, onPick }: { results: DomainSearch; picked?: DomainOffer | null; onPick?: (o: DomainOffer) => void }) {
  return (
    <>
      {results.exact ? <ExactMatch exact={results.exact} picked={picked} onPick={onPick} /> : null}
      {results.otherEndings.length ? (
        <section aria-label="Same name, other endings" className="border-t border-border-subtle p-2">
          <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Same name, other endings</p>
          <ul>
            {results.otherEndings.map((o) => (
              <OfferRow key={o.domain} o={o} picked={picked} onPick={onPick} />
            ))}
          </ul>
        </section>
      ) : null}
      {results.similar.length ? (
        <section aria-label="Other suggestions" className="border-t-4 border-double border-border p-2">
          <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Other suggestions — different names</p>
          <p className="mb-1.5 px-1 text-xs text-notready-fg">
            These are not the name you searched for. What differs is <mark className="rounded-sm bg-notready-bg px-px text-notready-fg">marked</mark> — read each one carefully.
          </p>
          <ul>
            {results.similar.map((o) => (
              <OfferRow key={o.domain} o={o} picked={picked} onPick={onPick} searched={results.exact ? results.exact.domain : null} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
