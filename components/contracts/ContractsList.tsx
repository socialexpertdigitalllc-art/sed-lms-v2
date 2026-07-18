"use client";

import Link from "next/link";
import { Download, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContractListItem } from "@/lib/contracts/types";

export function ContractsList({ contracts }: { contracts: ContractListItem[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-text-muted">
          <tr>
            <th className="text-left font-medium px-3 py-2">Business</th>
            <th className="text-left font-medium px-3 py-2">Status</th>
            <th className="text-left font-medium px-3 py-2">Sent</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {contracts.length === 0 && (
            <tr><td colSpan={4} className="px-3 py-6 text-center text-text-faint">No contracts yet.</td></tr>
          )}
          {contracts.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="px-3 py-2 font-medium text-text">{c.lead_business_name || c.business_name}</td>
              <td className="px-3 py-2">
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", c.status === "sent" ? "bg-ready-bg text-ready-fg" : "bg-notready-bg text-notready-fg")}>{c.status}</span>
              </td>
              <td className="px-3 py-2 text-text-faint">{c.sent_at ? new Date(c.sent_at).toLocaleString() : "—"}</td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-3">
                  <a href={`/api/contracts/${c.id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-ink hover:underline">
                    <Download className="w-3.5 h-3.5" /> PDF
                  </a>
                  {/* Resend = create a NEW record from the lead (sent contracts are immutable). */}
                  <Link href={`/leads/${c.lead_id}`} className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text">
                    <RotateCcw className="w-3.5 h-3.5" /> Resend
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
