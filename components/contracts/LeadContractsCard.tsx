"use client";

import { useState } from "react";
import { FileText, Download, Plus, Send, FilePlus2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel, EmptyPanel, Pill } from "@/components/common/Panel";
import { btnSecondarySm, btnGhostSm } from "@/components/common/buttons";
import { ContractComposer } from "@/components/contracts/ContractComposer";
import { ContractSentBadge } from "@/components/contracts/ContractSentBadge";
import { formatDate, formatDateTime } from "@/lib/leads/format";
import type { ContractRow } from "@/lib/contracts/types";

type Mailbox = { id: string; email_address: string; display_name: string };

export function LeadContractsCard({
  leadId,
  contracts,
  mailboxes,
  canSend,
  recipientEmail = null,
  leadOneTimePrice = null,
  leadYearlyPrice = null,
}: {
  leadId: string;
  contracts: ContractRow[];
  mailboxes: Mailbox[];
  canSend: boolean;
  /** The lead's email — the composer verifies it before allowing a send. */
  recipientEmail?: string | null;
  /** Lead's quoted prices — composer defaults the agent may discount. */
  leadOneTimePrice?: number | string | null;
  leadYearlyPrice?: number | string | null;
}) {
  const [composing, setComposing] = useState(false);
  const anySent = contracts.some((c) => c.status === "sent");

  return (
    <>
      <Panel
        icon={FileText}
        title="Contracts"
        count={contracts.length}
        action={
          <div className="flex items-center gap-2">
            {anySent && <ContractSentBadge />}
            {canSend && (
              <button type="button" onClick={() => setComposing(true)} className={btnSecondarySm}>
                <Plus className="h-3.5 w-3.5" /> New contract
              </button>
            )}
          </div>
        }
        flush
      >
        {contracts.length === 0 ? (
          <EmptyPanel
            icon={FilePlus2}
            title="No contracts yet"
            hint={
              canSend
                ? "Generate an agreement from a template and email it straight from your mailbox."
                : "Contracts sent to this lead will be listed here."
            }
            action={
              canSend ? (
                <button type="button" onClick={() => setComposing(true)} className={btnSecondarySm}>
                  <Plus className="h-3.5 w-3.5" /> New contract
                </button>
              ) : undefined
            }
            className="py-9"
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {contracts.map((c) => {
              const sent = c.status === "sent";
              return (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-2">
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-md",
                      sent ? "bg-ready-bg text-ready-fg" : "bg-surface-2 text-text-faint ring-1 ring-inset ring-border",
                    )}
                  >
                    {sent ? <Send className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Pill tone={sent ? "ready" : "notready"}>{c.status}</Pill>
                      <span className="tabular font-mono text-xs text-text-muted">{formatDate(c.contract_date)}</span>
                    </div>
                    <p className="tabular mt-0.5 truncate font-mono text-[11px] text-text-faint">
                      {c.sent_at ? `Sent ${formatDateTime(c.sent_at)}` : "Not sent"}
                    </p>
                  </div>

                  <a
                    href={`/api/contracts/${c.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the generated PDF"
                    className={cn(btnGhostSm, "shrink-0")}
                  >
                    <Download className="h-3.5 w-3.5" /> PDF
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {composing && (
        <ContractComposer
          leadId={leadId}
          mailboxes={mailboxes}
          recipientEmail={recipientEmail}
          leadOneTimePrice={leadOneTimePrice}
          leadYearlyPrice={leadYearlyPrice}
          onClose={() => setComposing(false)}
        />
      )}
    </>
  );
}
