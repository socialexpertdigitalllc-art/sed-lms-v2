"use client";

import { useState } from "react";
import { FileText, Download, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContractComposer } from "@/components/contracts/ContractComposer";
import { ContractSentBadge } from "@/components/contracts/ContractSentBadge";
import type { ContractRow } from "@/lib/contracts/types";

type Mailbox = { id: string; email_address: string; display_name: string };

export function LeadContractsCard({
  leadId,
  contracts,
  mailboxes,
  canSend,
}: {
  leadId: string;
  contracts: ContractRow[];
  mailboxes: Mailbox[];
  canSend: boolean;
}) {
  const [composing, setComposing] = useState(false);
  const anySent = contracts.some((c) => c.status === "sent");

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <FileText className="w-4 h-4" /> Contracts {anySent && <ContractSentBadge />}
        </div>
        {canSend && (
          <button onClick={() => setComposing(true)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text hover:bg-surface-2">
            <Plus className="w-3.5 h-3.5" /> New contract
          </button>
        )}
      </div>

      {contracts.length === 0 ? (
        <p className="text-xs text-text-faint">No contracts yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {contracts.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium mr-2", c.status === "sent" ? "bg-ready-bg text-ready-fg" : "bg-notready-bg text-notready-fg")}>{c.status}</span>
                <span className="text-text-muted">{c.contract_date}</span>
                {c.sent_at && <span className="text-text-faint ml-2">sent {new Date(c.sent_at).toLocaleDateString()}</span>}
              </div>
              <a href={`/api/contracts/${c.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-ink hover:underline">
                <Download className="w-3.5 h-3.5" /> PDF
              </a>
            </li>
          ))}
        </ul>
      )}

      {composing && <ContractComposer leadId={leadId} mailboxes={mailboxes} onClose={() => setComposing(false)} />}
    </div>
  );
}
