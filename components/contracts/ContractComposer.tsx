"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Send, FileText, Check, Loader2, FileSignature, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { Skeleton } from "@/components/common/Skeleton";
import { btnPrimary, btnSecondary } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { formatCurrency, formatDate } from "@/lib/leads/format";
import { parsePrice, formatUsd } from "@/lib/contracts/merge";
import type { ContractRow } from "@/lib/contracts/types";

type Mailbox = { id: string; email_address: string; display_name: string };
type Template = { id: string; name: string; placeholders: string[] };

const BUILTIN_VALUE = "builtin:standard";

/** One label/value cell in the merged-field summary. */
function SummaryCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-text-faint">{label}</dt>
      <dd className={cn("truncate text-sm text-text", mono && "tabular font-mono")} title={value}>{value}</dd>
    </div>
  );
}

/** Money as a plain editable string ("1200", "1200.5") — empty when unset. */
function priceInputValue(v: number | string | null | undefined): string {
  const n = parsePrice(v);
  return n === null ? "" : String(n);
}

/** Muted note whenever the agent's typed price differs from the lead's own. */
function PriceDelta({ original, current }: { original: number | string | null | undefined; current: string }) {
  const was = parsePrice(original);
  const now = parsePrice(current);
  if (was === now) return null;
  const text =
    was === null
      ? "Not quoted on the lead"
      : now === null
        ? `Removed — lead has ${formatUsd(was)}`
        : now < was
          ? `Discounted from ${formatUsd(was)}`
          : `Increased from ${formatUsd(was)}`;
  return <p className="tabular mt-1 text-[11px] text-text-faint">{text}</p>;
}

export function ContractComposer({
  leadId,
  mailboxes,
  onClose,
  leadOneTimePrice = null,
  leadYearlyPrice = null,
}: {
  leadId: string;
  mailboxes: Mailbox[];
  onClose: () => void;
  /** The lead's quoted one-time price — the default the agent may discount. */
  leadOneTimePrice?: number | string | null;
  /** The lead's yearly price — blank means none. */
  leadYearlyPrice?: number | string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [connected, setConnected] = useState(false);
  const [selection, setSelection] = useState<string>(BUILTIN_VALUE);
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? "");
  const [message, setMessage] = useState("Hi,\n\nPlease find your website services agreement attached. Let me know if you have any questions.\n\nThank you.");
  const [oneTime, setOneTime] = useState(() => priceInputValue(leadOneTimePrice));
  const [yearly, setYearly] = useState(() => priceInputValue(leadYearlyPrice));
  const [contractId, setContractId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContractRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/contract-templates")
      .then((r) => r.json())
      .then((d: { connected: boolean; templates: Template[] }) => {
        setConnected(!!d.connected);
        setTemplates(d.templates ?? []);
        if ((d.templates ?? []).length > 0) setSelection(`google:${d.templates[0].id}`);
      })
      .catch(() => {})
      .finally(() => setLoadingTemplates(false));
  }, []);

  async function createDraft() {
    setBusy(true);
    try {
      const google_template_id = selection.startsWith("google:") ? selection.slice("google:".length) : null;
      const res = await fetch("/api/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          mailbox_id: mailboxId,
          template_key: "standard",
          google_template_id,
          message_body: message,
          // Sent every time so an agent's discount (or a cleared yearly) always wins.
          one_time_price: parsePrice(oneTime),
          yearly_price: parsePrice(yearly),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.missing ? `Missing: ${data.missing.join(", ")}` : data.error;
        toast({ kind: "error", title: "Cannot create contract", body: detail });
        return;
      }
      setContractId(data.contract.id);
      setDraft(data.contract as ContractRow);
      toast({ kind: "success", title: "Draft ready — review the preview below" });
    } finally { setBusy(false); }
  }

  async function send() {
    if (!contractId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Send failed", body: data.error }); return; }
      toast({ kind: "success", title: "Contract sent" });
      onClose();
      router.refresh();
    } finally { setBusy(false); }
  }

  const locked = !!contractId;

  function TemplateCard({ value, name, sub }: { value: string; name: string; sub: string }) {
    const selected = selection === value;
    return (
      <button
        type="button"
        onClick={() => setSelection(value)}
        disabled={locked}
        aria-pressed={selected}
        className={cn(
          "flex items-start gap-2.5 rounded-md border p-3 text-left transition-colors duration-150",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          "disabled:cursor-not-allowed disabled:opacity-60",
          selected ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-2",
        )}
      >
        <span
          className={cn(
            "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors duration-150",
            selected ? "border-accent bg-accent text-white" : "border-border bg-surface",
          )}
        >
          {selected ? <Check className="h-2.5 w-2.5" /> : null}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-text" title={name}>{name}</span>
          <span className="block truncate text-[11px] text-text-muted">{sub}</span>
        </span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New contract"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-ink">
              <FileSignature className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold leading-tight text-text">New contract</h2>
              <p className="text-xs text-text-muted">
                {locked ? "Review the generated PDF, then send it from the selected mailbox." : "Pick a template, check the merge fields, then generate a preview."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {/* Template */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-text-muted">Template</p>
            {loadingTemplates ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-[62px]" />
                <Skeleton className="h-[62px]" />
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {templates.map((t) => (
                  <TemplateCard
                    key={t.id}
                    value={`google:${t.id}`}
                    name={t.name}
                    sub={`Google Doc · ${t.placeholders.length} placeholder${t.placeholders.length === 1 ? "" : "s"}`}
                  />
                ))}
                <TemplateCard
                  value={BUILTIN_VALUE}
                  name="Website Development Agreement"
                  sub="Built in — no Google required"
                />
              </div>
            )}

            {!loadingTemplates && templates.length === 0 && (
              <p className="mt-2 flex items-start gap-1.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-[11px] leading-relaxed text-text-muted">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  {connected
                    ? "No Google templates registered yet. An admin can add them in Admin → Contract Templates. Using the built-in template."
                    : "Google is not connected. An admin can connect it in Admin → Contract Templates. Using the built-in template."}
                </span>
              </p>
            )}
          </div>

          <Field label="Send from" required>
            <select className={inputCls} value={mailboxId} onChange={(e) => setMailboxId(e.target.value)} disabled={locked}>
              {mailboxes.length === 0 && <option value="">No verified mailbox</option>}
              {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email_address}</option>)}
            </select>
          </Field>

          {/* Pricing — editable before the draft exists, since the PDF is
              generated at creation time. */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-text-muted">Pricing</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="One-time price" required>
                <input
                  className={cn(inputCls, "tabular font-mono")}
                  value={oneTime}
                  onChange={(e) => setOneTime(e.target.value)}
                  disabled={locked}
                  inputMode="decimal"
                  placeholder="1200"
                  aria-label="One-time price"
                />
                <PriceDelta original={leadOneTimePrice} current={oneTime} />
              </Field>
              <Field label="Yearly price">
                <input
                  className={cn(inputCls, "tabular font-mono")}
                  value={yearly}
                  onChange={(e) => setYearly(e.target.value)}
                  disabled={locked}
                  inputMode="decimal"
                  placeholder="None"
                  aria-label="Yearly price"
                />
                <PriceDelta original={leadYearlyPrice} current={yearly} />
              </Field>
            </div>
          </div>

          {/* Merged-field summary — what the PDF was actually filled with. */}
          {draft && (
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-faint">
                <FileText className="h-3.5 w-3.5" /> Merged into this contract
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
                <SummaryCell label="Business" value={draft.business_name || "—"} />
                <SummaryCell label="Recipient" value={draft.recipient_email || draft.business_email || "—"} />
                <SummaryCell label="Phone" value={draft.business_phone || "—"} mono />
                <SummaryCell label="One-time" value={formatCurrency(draft.one_time_price)} mono />
                <SummaryCell label="Yearly" value={formatCurrency(draft.yearly_price)} mono />
                <SummaryCell label="Dated" value={formatDate(draft.contract_date)} mono />
              </dl>
            </div>
          )}

          <Field label="Cover message">
            <textarea
              className={cn(inputCls, "min-h-[120px] leading-relaxed")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={locked}
            />
          </Field>

          {/* PDF preview */}
          {locked && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-text-muted">PDF preview</p>
              <div className="overflow-hidden rounded-md border border-border bg-surface-2" style={{ height: 480 }}>
                <iframe title="Contract preview" src={`/api/contracts/${contractId}/pdf`} className="h-full w-full" />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 border-t border-border bg-surface-2 px-5 py-3">
          <p className="hidden min-w-0 truncate text-[11px] text-text-faint sm:block">
            {locked ? "Sending emails the PDF from the selected mailbox." : "Nothing is emailed until you send."}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
            {!locked ? (
              <button type="button" onClick={createDraft} disabled={busy || !mailboxId} className={btnPrimary}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                {busy ? "Preparing…" : "Create & preview"}
              </button>
            ) : (
              <button type="button" onClick={send} disabled={busy} className={btnPrimary}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {busy ? "Sending…" : "Send contract"}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
