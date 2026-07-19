"use client";

import Link from "next/link";
import { Download, RotateCcw, FileSignature } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyPanel, Pill } from "@/components/common/Panel";
import { btnGhostSm } from "@/components/common/buttons";
import { formatDateTime } from "@/lib/leads/format";
import type { ContractListItem } from "@/lib/contracts/types";

const th = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-faint";

export function ContractsList({ contracts }: { contracts: ContractListItem[] }) {
  if (contracts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyPanel
          icon={FileSignature}
          title="No contracts yet"
          hint="Open a lead and use “New contract” to generate an agreement and email it from your mailbox."
          action={
            <Link href="/leads" className={btnGhostSm}>
              Go to leads
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2">
            <tr>
              <th scope="col" className={th}>Business</th>
              <th scope="col" className={cn(th, "w-28")}>Status</th>
              <th scope="col" className={cn(th, "w-56")}>Sent</th>
              <th scope="col" className={cn(th, "w-44 text-right")}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {contracts.map((c) => (
              <tr key={c.id} className="transition-colors duration-150 hover:bg-surface-2">
                <td className="max-w-0 px-4 py-2.5">
                  <p className="truncate font-medium text-text" title={c.lead_business_name || c.business_name}>
                    {c.lead_business_name || c.business_name}
                  </p>
                  {c.recipient_email ? (
                    <p className="truncate text-[11px] text-text-faint" title={c.recipient_email}>{c.recipient_email}</p>
                  ) : null}
                </td>
                <td className="px-4 py-2.5">
                  <Pill tone={c.status === "sent" ? "ready" : "notready"}>{c.status}</Pill>
                </td>
                <td className="tabular whitespace-nowrap px-4 py-2.5 font-mono text-xs text-text-muted">
                  {c.sent_at ? formatDateTime(c.sent_at) : "—"}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <a
                      href={`/api/contracts/${c.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      title="Open the generated PDF"
                      className={btnGhostSm}
                    >
                      <Download className="h-3.5 w-3.5" /> PDF
                    </a>
                    {/* Resend = create a NEW record from the lead (sent contracts are immutable). */}
                    <Link href={`/leads/${c.lead_id}`} title="Open the lead to send a fresh contract" className={btnGhostSm}>
                      <RotateCcw className="h-3.5 w-3.5" /> Resend
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
