"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Globe, RotateCw, ShoppingCart, Unlink } from "lucide-react";
import { CollapsibleCard } from "@/components/common/CollapsibleCard";
import { EmptyPanel } from "@/components/common/Panel";
import { btnSecondarySm, btnGhostSm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { DomainStatusPill, DomainSteps, isWorking, money } from "@/components/domains/DomainBits";
import { BuyDomainDialog } from "@/components/domains/BuyDomainDialog";
import { PickDomainDialog } from "@/components/domains/PickDialogs";
import { STATUS_LABELS, type ClientDomainRow } from "@/lib/domains/types";

/**
 * The lead's domain: buy one (Cloudflare by default) or link one we own, then
 * watch the dashboard connect it — DNS, hosting, SSL, and the lead's site
 * going live on it. Polls while the pipeline is working.
 */
export function LeadDomainCard({
  leadId,
  leadName,
  initial,
  suggestedQuery,
  canPurchase,
  canManage,
  sandbox,
}: {
  leadId: string;
  leadName: string;
  initial: ClientDomainRow | null;
  suggestedQuery: string;
  canPurchase: boolean;
  canManage: boolean;
  sandbox: boolean;
}) {
  const { toast } = useToast();
  const [row, setRow] = useState<ClientDomainRow | null>(initial);
  const [buyOpen, setBuyOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/domains?leadId=${leadId}`);
    if (!res.ok) return;
    const j = await res.json().catch(() => ({}));
    setRow(((j.domains ?? [])[0] as ClientDomainRow | undefined) ?? null);
  }, [leadId]);

  // live checklist while the pipeline works; a slow re-check while it waits for the site
  useEffect(() => {
    if (!row) return;
    const every = isWorking(row.status) ? 5000 : row.status === "waiting_for_site" ? 30000 : 0;
    if (!every) return;
    const t = setInterval(() => void refresh(), every);
    return () => clearInterval(t);
  }, [row, refresh]);

  async function act(path: string, init: RequestInit, okTitle: string) {
    if (!row) return;
    setBusy(true);
    try {
      const res = await fetch(path, init);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) toast({ kind: "error", title: j.error ?? "Failed" });
      else {
        toast({ kind: "success", title: okTitle });
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const summary = row ? `${row.domain} · ${STATUS_LABELS[row.status].toLowerCase()}` : "no domain yet";
  const action =
    !row && (canPurchase || canManage) ? (
      <span className="inline-flex gap-1">
        {canPurchase ? (
          <button type="button" className={btnSecondarySm} onClick={() => setBuyOpen(true)}>
            <ShoppingCart className="h-3.5 w-3.5" /> Buy
          </button>
        ) : null}
        {canManage ? (
          <button type="button" className={btnSecondarySm} onClick={() => setPickOpen(true)}>
            <Globe className="h-3.5 w-3.5" /> Ours
          </button>
        ) : null}
      </span>
    ) : null;

  return (
    <>
      <CollapsibleCard icon={Globe} title="Domain" summary={summary} action={action} defaultOpen={Boolean(row && row.status !== "live" && row.status !== "connected")}>
        {!row ? (
          <EmptyPanel
            icon={Globe}
            title="No domain yet"
            hint={
              canPurchase
                ? "Buy one (Cloudflare by default) — the dashboard then connects it and puts the site live on it."
                : canManage
                  ? "Link a domain we already own, or ask an admin to buy one."
                  : "An admin can buy or link a domain for this lead."
            }
          />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <a href={`https://${row.domain}`} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-medium text-accent-ink hover:underline">
                <span className="truncate">{row.domain}</span> <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
              <DomainStatusPill status={row.status} />
            </div>
            <p className="text-xs text-text-muted">
              {row.registrar === "cloudflare" ? "Cloudflare" : "Hostinger"}
              {row.expires_at ? ` · expires ${new Date(row.expires_at).toLocaleDateString()}` : ""}
              {row.auto_renew === false ? " · auto-renew OFF" : row.auto_renew ? " · auto-renews" : ""}
              {row.renewal_cost_cents ? ` · ${money(row.renewal_cost_cents, row.currency ?? "USD")}/yr` : ""}
            </p>
            {row.status === "connected" ? (
              <p className="text-xs text-text-muted">Set up by hand before the dashboard managed domains — nothing for it to do.</p>
            ) : null}
            <DomainSteps row={row} />
            {row.last_error && (row.status === "needs_attention" || row.status === "failed") ? (
              <p className="rounded-md bg-dropped-bg p-2 text-xs text-dropped-fg">{row.last_error}</p>
            ) : null}
            {canManage ? (
              <div className="flex flex-wrap gap-1">
                {row.status === "needs_attention" || row.status === "waiting_for_site" ? (
                  <button type="button" className={btnSecondarySm} disabled={busy} onClick={() => void act(`/api/domains/${row.id}/retry`, { method: "POST" }, "Retrying")}>
                    <RotateCw className="h-3.5 w-3.5" /> {row.status === "waiting_for_site" ? "Check again" : "Retry"}
                  </button>
                ) : null}
                {row.status !== "purchasing" ? (
                  <button
                    type="button"
                    className={btnGhostSm}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        `/api/domains/${row.id}`,
                        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: null }) },
                        "Domain unlinked from this lead",
                      )
                    }
                  >
                    <Unlink className="h-3.5 w-3.5" /> Unlink
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </CollapsibleCard>

      {buyOpen ? (
        <BuyDomainDialog
          leadId={leadId}
          leadName={leadName}
          initialQuery={suggestedQuery}
          sandbox={sandbox}
          onClose={() => setBuyOpen(false)}
          onBought={(r) => setRow(r)}
        />
      ) : null}
      {pickOpen ? <PickDomainDialog leadId={leadId} leadName={leadName} onClose={() => setPickOpen(false)} onLinked={(r) => setRow(r)} /> : null}
    </>
  );
}
