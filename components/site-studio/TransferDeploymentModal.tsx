"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Globe, Loader2, Search } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";

type Domain = { domain: string; expires_at: string | null };

/**
 * Pick a registered Hostinger domain and transfer a live staged deployment
 * onto it — the v2 wizard's `TransferToDomainModal` carried over as is, but
 * keyed by `studio_deployments` row (POST /api/site-studio/deployments/[id]/
 * transfer) so it serves Site Studio and Site Builder deploys alike. The
 * domain list comes from the same Hostinger endpoint v2 used.
 */
export function TransferDeploymentModal({
  deploymentId,
  businessName,
  onClose,
  onDone,
}: {
  deploymentId: string;
  businessName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // seed the search with the business name so the likely domain floats up
  const [query, setQuery] = useState(businessName.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const [picked, setPicked] = useState("");
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/template-engine/hostinger/domains");
      if (!res.ok) {
        setLoadErr((await res.json().catch(() => ({}))).error ?? "Could not load domains");
        setDomains([]);
        return;
      }
      const j = await res.json();
      if (!j.configured) setLoadErr("Hostinger is not configured (HOSTINGER_API_TOKEN missing).");
      setDomains(j.domains ?? []);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = domains ?? [];
    if (!q) return all;
    return all.filter((d) => d.domain.toLowerCase().includes(q));
  }, [domains, query]);

  async function transfer() {
    if (!picked) return;
    setTransferring(true);
    try {
      const res = await fetch(`/api/site-studio/deployments/${deploymentId}/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: picked }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Transfer failed", body: j.error ?? "Try again" });
        return;
      }
      toast({
        kind: "success",
        title: "Transferred to custom domain",
        body:
          (j.provisioning ? `${j.url} — provisioning, live shortly.` : `${j.url}`) +
          (j.subdomainDeleted ? " Staging subdomain removed." : " (staging subdomain not removed — check manually)"),
      });
      onDone();
      onClose();
    } catch {
      toast({ kind: "error", title: "Transfer failed", body: "Network error — try again" });
    } finally {
      setTransferring(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Transfer to a custom domain">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
        <div className="border-b border-border-subtle p-5">
          <h3 className="text-sm font-semibold text-text">Transfer {businessName} to a custom domain</h3>
          <p className="mt-1 text-xs text-text-muted">
            The subdomain&apos;s current files (including any manual edits) are copied to the domain you pick, then the
            staging subdomain is deleted.
          </p>
        </div>

        <div className="border-b border-border-subtle p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input className={cn(inputCls, "pl-8")} placeholder="Search your registered domains…" aria-label="Search domains"
              value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </div>
        </div>

        <div className="min-h-40 flex-1 overflow-y-auto p-1">
          {domains === null ? (
            <div className="grid place-items-center p-8 text-sm text-text-faint"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : loadErr ? (
            <p className="p-4 text-sm text-dropped-fg">{loadErr}</p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-text-faint">No matching registered domains.</p>
          ) : (
            <ul>
              {filtered.map((d) => (
                <li key={d.domain}>
                  <button type="button" onClick={() => setPicked(d.domain)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                      picked === d.domain ? "bg-accent-soft text-accent-ink" : "text-text hover:bg-surface-2")}>
                    <Globe className="h-4 w-4 shrink-0 text-text-faint" />
                    <span className="flex-1 truncate">{d.domain}</span>
                    {picked === d.domain ? <Check className="h-4 w-4 text-accent-ink" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle p-4">
          <button type="button" onClick={onClose} disabled={transferring}
            className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50">Cancel</button>
          <button type="button" onClick={transfer} disabled={!picked || transferring}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60">
            {transferring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            Transfer{picked ? ` to ${picked}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
