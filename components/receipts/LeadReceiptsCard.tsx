"use client";

import { useState } from "react";
import { FileImage, Plus, ReceiptText, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyPanel, Pill } from "@/components/common/Panel";
import { CollapsibleCard } from "@/components/common/CollapsibleCard";
import { btnGhostSm, btnSecondarySm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { formatMoney, formatShortDate } from "@/lib/receipts/compute";
import type { ReceiptRow } from "@/lib/receipts/types";
import { downloadReceiptPng } from "@/components/receipts/receiptFiles";

/** The lead's receipts. Opening one jumps straight to its email/download step. */
export function LeadReceiptsCard({
  receipts,
  onNew,
  onOpen,
}: {
  receipts: ReceiptRow[];
  onNew: () => void;
  onOpen: (r: ReceiptRow) => void;
}) {
  const { toast } = useToast();
  const [pngFor, setPngFor] = useState<string | null>(null);
  const latest = receipts[0] ?? null;

  async function png(r: ReceiptRow) {
    setPngFor(r.id);
    try {
      await downloadReceiptPng(r.id, r.receipt_no);
    } catch (e) {
      toast({ kind: "error", title: "Could not create the PNG", body: (e as Error).message });
    } finally {
      setPngFor(null);
    }
  }

  return (
    <CollapsibleCard
      icon={ReceiptText}
      title="Receipts"
      count={receipts.length}
      summary={latest ? `${formatMoney(Number(latest.total))} · ${latest.sent_at ? "sent" : "not emailed"}` : "none yet"}
      action={
        <button type="button" onClick={onNew} className={btnSecondarySm}>
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      }
      flush
    >
      {receipts.length === 0 ? (
        <EmptyPanel
          icon={ReceiptText}
          title="No receipts yet"
          hint="Create a payment receipt from this lead's services and email it from the billing mailbox."
          action={
            <button type="button" onClick={onNew} className={btnSecondarySm}>
              <Plus className="h-3.5 w-3.5" /> New receipt
            </button>
          }
          className="py-9"
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {receipts.map((r) => {
            const sent = Boolean(r.sent_at);
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-2">
                <button
                  type="button"
                  onClick={() => onOpen(r)}
                  title="Email, download or share this receipt"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    className={cn(
                      "grid h-8 w-8 shrink-0 place-items-center rounded-md",
                      sent ? "bg-ready-bg text-ready-fg" : "bg-surface-2 text-text-faint ring-1 ring-inset ring-border",
                    )}
                  >
                    {sent ? <Send className="h-3.5 w-3.5" /> : <ReceiptText className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="tabular font-mono text-xs font-semibold text-text">{formatMoney(Number(r.total))}</span>
                      <Pill tone={sent ? "ready" : "notready"}>{sent ? "emailed" : "not emailed"}</Pill>
                    </span>
                    <span className="tabular mt-0.5 block truncate font-mono text-[11px] text-text-faint">
                      {r.receipt_no} · {formatShortDate(r.paid_on)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => png(r)}
                  disabled={pngFor !== null}
                  title="Download as an image to text the client"
                  className={cn(btnGhostSm, "shrink-0")}
                >
                  <FileImage className="h-3.5 w-3.5" /> {pngFor === r.id ? "…" : "PNG"}
                </button>
                <a
                  href={`/api/receipts/${r.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the PDF"
                  className={cn(btnGhostSm, "shrink-0")}
                >
                  PDF
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </CollapsibleCard>
  );
}
