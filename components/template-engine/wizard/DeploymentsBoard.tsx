"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Globe, Loader2, RotateCcw, Send, Trash2 } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { CopyButton } from "@/components/common/CopyButton";
import { RelativeTime } from "@/components/common/RelativeTime";
import { EmptyState } from "@/components/common/EmptyState";
import { STATUS_PILL } from "@/lib/leads/types";
import { cn } from "@/lib/utils";
import { TransferToDomainModal } from "./TransferToDomainModal";

export type DeployedRow = {
  id: string;
  lead_id: string;
  business_name: string;
  lead_status: string;
  deployed_url: string | null;
  updated_at: string;
};

export function DeploymentsBoard({ deployed, canDeploy }: { deployed: DeployedRow[]; canDeploy: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null); // generation id with an action in flight
  const [confirming, setConfirming] = useState<DeployedRow | null>(null);
  const [transferRow, setTransferRow] = useState<DeployedRow | null>(null);
  const onStaging = (url: string | null) => !!url && /\.dmviral\.com/i.test(url);

  async function redeploy(row: DeployedRow) {
    setBusy(row.id);
    try {
      const res = await fetch(`/api/template-engine/generations/${row.id}/deploy`, { method: "POST" });
      if (!res.ok) {
        toast({ kind: "error", title: "Redeploy failed", body: (await res.json().catch(() => ({}))).error ?? "Try again" });
        return;
      }
      const { url, provisioning } = await res.json();
      toast({
        kind: "success",
        title: "Redeployed",
        body: provisioning ? `${url} — provisioning, live shortly.` : url,
      });
      router.refresh();
    } catch {
      toast({ kind: "error", title: "Redeploy failed", body: "Network error — try again" });
    } finally {
      setBusy(null);
    }
  }

  async function takedown(row: DeployedRow) {
    setConfirming(null);
    setBusy(row.id);
    try {
      const res = await fetch(`/api/template-engine/generations/${row.id}/takedown`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Take-down failed", body: j.error ?? "Try again" });
        return;
      }
      toast({
        kind: j.warning ? "info" : "success",
        title: "Site taken down",
        body: j.warning ?? `${row.business_name}'s site was removed.`,
      });
      router.refresh();
    } catch {
      toast({ kind: "error", title: "Take-down failed", body: "Network error — try again" });
    } finally {
      setBusy(null);
    }
  }

  if (deployed.length === 0) {
    return <EmptyState icon={Globe} title="No deployed sites yet" hint="Deploy a finished generation from its Review step." />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-[10px] uppercase tracking-wider text-text-faint">
            <th className="px-4 py-2.5 font-semibold">Business</th>
            <th className="px-4 py-2.5 font-semibold">Live URL</th>
            <th className="px-4 py-2.5 font-semibold">Deployed</th>
            <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {deployed.map((row) => (
            <tr key={row.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-2">
              <td className="px-4 py-2.5">
                <Link href={`/ai-tools/template-engine/${row.id}`} className="font-medium text-text hover:text-accent-ink">
                  {row.business_name}
                </Link>
                {row.lead_status ? (
                  <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_PILL[row.lead_status] ?? "bg-surface-2 text-text-muted")}>
                    {row.lead_status}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-2.5">
                {row.deployed_url ? (
                  <span className="inline-flex items-center gap-1">
                    <a href={row.deployed_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-accent-ink hover:underline">
                      {row.deployed_url.replace(/^https?:\/\//, "")}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <CopyButton value={row.deployed_url} title="Copy live URL" />
                  </span>
                ) : (
                  <span className="text-text-faint">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-text-muted"><RelativeTime iso={row.updated_at} /></td>
              <td className="px-4 py-2.5">
                {canDeploy ? (
                  <div className="flex items-center justify-end gap-2">
                    {onStaging(row.deployed_url) ? (
                      <button type="button" disabled={busy !== null} onClick={() => setTransferRow(row)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 px-2.5 py-1.5 text-xs text-accent-ink hover:bg-accent-soft disabled:opacity-50">
                        <Send className="h-3.5 w-3.5" />
                        To custom domain
                      </button>
                    ) : null}
                    <button type="button" disabled={busy !== null} onClick={() => redeploy(row)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted hover:text-text disabled:opacity-50">
                      {busy === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      Redeploy
                    </button>
                    <button type="button" disabled={busy !== null} onClick={() => setConfirming(row)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-dropped-fg/30 px-2.5 py-1.5 text-xs text-dropped-fg hover:bg-dropped-bg disabled:opacity-50">
                      <Trash2 className="h-3.5 w-3.5" />
                      Take down
                    </button>
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {transferRow ? (
        <TransferToDomainModal
          generationId={transferRow.id}
          businessName={transferRow.business_name}
          onClose={() => setTransferRow(null)}
          onDone={() => router.refresh()}
        />
      ) : null}

      {/* Take-down confirm — closes only via its buttons (house rule) */}
      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Take down this site?">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-sm font-semibold text-text">Take down {confirming.business_name}&apos;s site?</h3>
            <p className="mt-2 text-sm text-text-muted">
              {confirming.deployed_url?.replace(/^https?:\/\//, "")} goes offline immediately and the subdomain is
              removed. The generation stays at Review, so you can redeploy it later.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(null)}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text">Cancel</button>
              <button type="button" onClick={() => takedown(confirming)}
                className="rounded-md bg-dropped-fg px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Take down</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
