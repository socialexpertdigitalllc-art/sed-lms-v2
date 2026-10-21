"use client";

import { useEffect, useState } from "react";
import { History, Loader2, Search, SearchCheck } from "lucide-react";
import { PageHeader } from "@/components/common/Panel";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";
import { DomainSearchResults } from "@/components/domains/DomainSearchResults";
import type { DomainOffer, DomainSearch } from "@/lib/domains/service";
import type { DomainRegistrar } from "@/lib/domains/types";

const REGISTRARS: { id: DomainRegistrar; label: string }[] = [
  { id: "cloudflare", label: "Cloudflare" },
  { id: "hostinger", label: "Hostinger" },
];

/** This person's last few searches, on this device (a convenience only). */
const RECENT_KEY = "sed.domainCheck.recent";
const RECENT_MAX = 8;

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // private window / storage off: recent searches just aren't kept
  }
}

/**
 * Check a name — for sales on a call: type the business name or a domain and
 * see at once whether that exact name is free (.com when no ending is typed),
 * the same name on other endings, then different names with what differs
 * marked. Checked live with the registrar; read only (buying happens from the
 * lead's Domain card).
 */
export function DomainChecker({ canPurchase }: { canPurchase: boolean }) {
  const [query, setQuery] = useState("");
  const [registrar, setRegistrar] = useState<DomainRegistrar>("cloudflare");
  const [results, setResults] = useState<DomainSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  // localStorage only exists in the browser: read it after mounting.
  useEffect(() => {
    const t = setTimeout(() => setRecent(readRecent()), 0);
    return () => clearTimeout(t);
  }, []);

  async function search(q: string, reg: DomainRegistrar) {
    const text = q.trim();
    if (!text) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/domains/check?q=${encodeURIComponent(text)}&registrar=${reg}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "Check failed — try again.");
        setResults(null);
        return;
      }
      setResults({
        query: text,
        exact: (j.exact ?? null) as DomainSearch["exact"],
        otherEndings: (j.otherEndings ?? []) as DomainOffer[],
        similar: (j.similar ?? []) as DomainOffer[],
      });
      const next = [text, ...recent.filter((r) => r.toLowerCase() !== text.toLowerCase())].slice(0, RECENT_MAX);
      setRecent(next);
      saveRecent(next);
    } catch {
      setError("Check failed — check your connection.");
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  const nothing = results && !results.exact && !results.otherEndings.length && !results.similar.length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Check a name"
        description="Is the customer's name free as a domain? Type the business name or a domain — no ending means .com. The exact name comes first, on its own; anything else is a different name."
      />
      <div className="mx-auto max-w-2xl space-y-3">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void search(query, registrar);
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input
              className={cn(inputCls, "h-11 pl-9 text-base")}
              placeholder="e.g. ABC Construction or abcconstruction.net"
              aria-label="Name or domain to check"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />} Check
          </button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Registrar">
            {REGISTRARS.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={registrar === r.id}
                onClick={() => {
                  setRegistrar(r.id);
                  if (results) void search(query || results.query, r.id);
                }}
                className={cn("rounded px-2.5 py-1 text-xs font-medium", registrar === r.id ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:text-text")}
              >
                {r.label}
              </button>
            ))}
          </div>
          {recent.length ? (
            <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
              <History className="h-3.5 w-3.5 text-text-faint" aria-label="Recent" />
              {recent.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setQuery(r);
                    void search(r, registrar);
                  }}
                  className="max-w-[12rem] truncate rounded-full border border-border px-2 py-0.5 text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  {r}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="min-h-32 rounded-lg border border-border bg-surface p-1">
          {searching && !results ? (
            <div className="grid place-items-center p-8 text-text-faint">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : error ? (
            <p className="p-4 text-sm text-dropped-fg">{error}</p>
          ) : !results ? (
            <p className="p-4 text-sm text-text-faint">Checked live with {registrar === "cloudflare" ? "Cloudflare" : "Hostinger"} — taken means someone already owns it.</p>
          ) : nothing ? (
            <p className="p-4 text-sm text-text-faint">That can&apos;t be a domain name — try the business name or a domain.</p>
          ) : (
            <div className={cn(searching && "opacity-60")}>
              <DomainSearchResults results={results} />
            </div>
          )}
        </div>
        <p className="text-xs text-text-faint">
          {canPurchase ? "To buy one, open the lead and use Buy on its Domain card." : "Domains are bought from the lead's Domain card by an admin."} Prices are for one year, in USD.
        </p>
      </div>
    </div>
  );
}
