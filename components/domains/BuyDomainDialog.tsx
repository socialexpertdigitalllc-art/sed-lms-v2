"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Globe, Loader2, Search, ShoppingCart } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";
import { money } from "@/components/domains/DomainBits";
import type { DomainOffer } from "@/lib/domains/service";
import type { ClientDomainRow, DomainRegistrar } from "@/lib/domains/types";

const REGISTRARS: { id: DomainRegistrar; label: string; hint: string }[] = [
  { id: "cloudflare", label: "Cloudflare", hint: "Default — at-cost price, cheapest renewals" },
  { id: "hostinger", label: "Hostinger", hint: "When the client needs access to the domain" },
];

/**
 * Find and buy a domain (Cloudflare by default, Hostinger optional), for a
 * lead or for stock. Two steps on purpose: pick, then confirm the exact
 * first-year and renewal price — the server refuses if the price moved since.
 */
export function BuyDomainDialog({
  leadId,
  leadName,
  initialQuery,
  sandbox,
  onClose,
  onBought,
}: {
  leadId: string | null;
  leadName: string | null;
  initialQuery: string;
  sandbox: boolean;
  onClose: () => void;
  onBought: (row: ClientDomainRow) => void;
}) {
  const { toast } = useToast();
  const [registrar, setRegistrar] = useState<DomainRegistrar>("cloudflare");
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<DomainOffer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<DomainOffer | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [buying, setBuying] = useState(false);

  const search = useCallback(
    async (q: string, reg: DomainRegistrar) => {
      if (!q.trim()) return;
      setSearching(true);
      setError(null);
      setPicked(null);
      setConfirming(false);
      try {
        const res = await fetch(`/api/domains/search?q=${encodeURIComponent(q.trim())}&registrar=${reg}`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(j.error ?? "Search failed");
          setResults([]);
        } else setResults((j.results ?? []) as DomainOffer[]);
      } catch {
        setError("Search failed — check your connection.");
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!initialQuery.trim()) return;
    const t = setTimeout(() => void search(initialQuery, "cloudflare"), 0);
    return () => clearTimeout(t);
  }, [initialQuery, search]);

  async function buy() {
    if (!picked || picked.registrationCents === null) return;
    setBuying(true);
    try {
      const res = await fetch("/api/domains/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: picked.domain,
          registrar: picked.registrar,
          leadId,
          expectedCents: picked.registrationCents,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Not bought", body: j.error ?? "Try again" });
        if (res.status === 409) void search(query, registrar); // price/availability moved — refresh
        return;
      }
      toast({
        kind: "success",
        title: `${picked.domain} bought`,
        body: leadId
          ? "Setting it up now — DNS, hosting, SSL, then the site goes live on it."
          : "It's in the Domains list — link it to a lead to set it up.",
      });
      onBought(j.domain as ClientDomainRow);
      onClose();
    } catch {
      toast({ kind: "error", title: "Not bought", body: "Network error — check the Domains list before trying again." });
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Buy a domain">
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
        <div className="border-b border-border-subtle p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
            <ShoppingCart className="h-4 w-4" /> Buy a domain{leadName ? ` for ${leadName}` : ""}
            {sandbox ? <span className="rounded bg-notready-bg px-1.5 py-0.5 text-[10px] font-bold uppercase text-notready-fg">Test mode — no charge</span> : null}
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {REGISTRARS.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={confirming}
                onClick={() => {
                  setRegistrar(r.id);
                  void search(query, r.id);
                }}
                className={cn(
                  "rounded-md border px-3 py-2 text-left text-xs",
                  registrar === r.id ? "border-accent bg-accent-soft text-accent-ink" : "border-border text-text-muted hover:bg-surface-2",
                )}
              >
                <span className="block text-sm font-semibold">{r.label}</span>
                {r.hint}
              </button>
            ))}
          </div>
        </div>

        {!confirming ? (
          <>
            <form
              className="flex gap-2 border-b border-border-subtle p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void search(query, registrar);
              }}
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <input
                  className={cn(inputCls, "pl-8")}
                  placeholder="Business name or exact domain…"
                  aria-label="Search domains"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <button type="submit" disabled={searching || !query.trim()} className="rounded-md border border-border px-3 text-sm text-text hover:bg-surface-2 disabled:opacity-50">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
              </button>
            </form>
            <div className="min-h-40 flex-1 overflow-y-auto p-1">
              {searching && !results ? (
                <div className="grid place-items-center p-8 text-text-faint"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : error ? (
                <p className="p-4 text-sm text-dropped-fg">{error}</p>
              ) : !results ? (
                <p className="p-4 text-sm text-text-faint">Search by the business name or type an exact domain.</p>
              ) : results.length === 0 ? (
                <p className="p-4 text-sm text-text-faint">No names found — try a different phrase.</p>
              ) : (
                <ul>
                  {results.map((o) => (
                    <li key={o.domain}>
                      <button
                        type="button"
                        disabled={!o.available}
                        onClick={() => setPicked(o)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                          !o.available ? "cursor-not-allowed opacity-50" : picked?.domain === o.domain ? "bg-accent-soft text-accent-ink" : "text-text hover:bg-surface-2",
                        )}
                      >
                        <Globe className="h-4 w-4 shrink-0 text-text-faint" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{o.domain}</span>
                          <span className="block text-xs text-text-faint">
                            {o.available
                              ? `${money(o.registrationCents, o.currency)} first year · renews ${money(o.renewalCents, o.currency)}/yr`
                              : o.reason}
                          </span>
                        </span>
                        {picked?.domain === o.domain ? <Check className="h-4 w-4 text-accent-ink" /> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border-subtle p-4">
              <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">Cancel</button>
              <button
                type="button"
                disabled={!picked}
                onClick={() => setConfirming(true)}
                className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60"
              >
                Continue{picked ? ` with ${picked.domain}` : ""}
              </button>
            </div>
          </>
        ) : picked ? (
          <>
            <div className="space-y-3 p-5 text-sm">
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5">
                <dt className="text-text-muted">Domain</dt>
                <dd className="font-semibold text-text">{picked.domain}</dd>
                <dt className="text-text-muted">Registrar</dt>
                <dd className="text-text">{picked.registrar === "cloudflare" ? "Cloudflare" : "Hostinger"}</dd>
                <dt className="text-text-muted">First year</dt>
                <dd className="text-text">{money(picked.registrationCents, picked.currency)}</dd>
                <dt className="text-text-muted">Renews at</dt>
                <dd className="text-text">{money(picked.renewalCents, picked.currency)} / year, automatically</dd>
                <dt className="text-text-muted">For</dt>
                <dd className="text-text">{leadName ?? "No lead yet (stock domain)"}</dd>
              </dl>
              <p className="flex items-start gap-2 rounded-md border border-notready-fg/30 bg-notready-bg p-3 text-xs text-notready-fg">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {sandbox
                    ? "Test mode: this simulates the purchase in Cloudflare's sandbox — nothing is charged and the domain won't work on the internet."
                    : `This charges the company's default payment method on ${picked.registrar === "cloudflare" ? "Cloudflare" : "Hostinger"}. Domain purchases can't be refunded.`}
                  {leadId ? " After the purchase the dashboard sets up DNS, hosting and SSL, and puts the lead's site live on it." : ""}
                </span>
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border-subtle p-4">
              <button type="button" onClick={() => setConfirming(false)} disabled={buying} className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50">
                Back
              </button>
              <button type="button" onClick={buy} disabled={buying} className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60">
                {buying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                {buying ? "Buying…" : `Buy for ${money(picked.registrationCents, picked.currency)}`}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
