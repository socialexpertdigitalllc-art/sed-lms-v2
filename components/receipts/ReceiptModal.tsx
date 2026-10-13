"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, FileImage, Info, Mail, Plus, ReceiptText, RotateCcw, Share2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { btnPrimary, btnSecondary, btnSecondarySm, iconBtnDanger } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import type { Lead } from "@/lib/leads/types";
import {
  billToName,
  computeTotals,
  formatLongDate,
  formatMoney,
  prefillItems,
  suggestNotes,
  todayIso,
} from "@/lib/receipts/compute";
import { SERVICE_PRESETS } from "@/lib/receipts/presets";
import { PAYMENT_METHODS, RECEIPT_TERMS, TERM_LABEL, type ReceiptItem, type ReceiptRow, type ReceiptTerm } from "@/lib/receipts/types";
import { BILLING_MAILBOX_ADDRESS } from "@/lib/receipts/company";
import {
  canShareFiles,
  downloadReceiptPdf,
  downloadReceiptPng,
  prepareReceiptFiles,
  shareReceiptFiles,
  type ReceiptFiles,
} from "@/components/receipts/receiptFiles";

export type ReceiptLead = Pick<
  Lead,
  | "id"
  | "business_name"
  | "owner_name"
  | "business_email"
  | "no_email"
  | "business_phone"
  | "site_type"
  | "num_webpages"
  | "price_quoted"
  | "yearly_price"
  | "add_ons"
>;

/** Form rows keep qty/price as typed text so half-typed numbers don't jump around. */
type DraftItem = { key: number; title: string; description: string; term: ReceiptTerm; qty: string; rate: string };

let nextKey = 1;
const toDraft = (i: ReceiptItem): DraftItem => ({
  key: nextKey++,
  title: i.title,
  description: i.description,
  term: i.term,
  qty: String(i.qty),
  rate: i.rate ? String(i.rate) : "",
});
const blankDraft = (): DraftItem => ({ key: nextKey++, title: "", description: "", term: "one_time", qty: "1", rate: "" });
const toNumber = (v: string) => {
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const toItem = (d: DraftItem): ReceiptItem => ({
  title: d.title.trim(),
  description: d.description.trim(),
  term: d.term,
  qty: Math.max(1, Math.round(toNumber(d.qty)) || 1),
  rate: toNumber(d.rate),
});

export function ReceiptModal({
  lead,
  senderAddress,
  existing = null,
  onClose,
}: {
  lead: ReceiptLead;
  /** The address receipts go out from; null = no billing mailbox linked yet. */
  senderAddress: string | null;
  /** Open an already-issued receipt straight at the send/download step. */
  existing?: ReceiptRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [receipt, setReceipt] = useState<ReceiptRow | null>(existing);

  function close() {
    if (receipt) router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text/40 p-3 sm:p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Payment receipt"
        className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-ink">
              <ReceiptText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold leading-tight text-text">
                {receipt ? `Receipt ${receipt.receipt_no}` : "New payment receipt"}
              </h2>
              <p className="truncate text-xs text-text-muted">
                {receipt
                  ? `${lead.business_name} · ${formatMoney(Number(receipt.total))} paid`
                  : `${lead.business_name} · check the services and payment, then create the receipt`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            title="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {receipt ? (
          <IssuedStep receipt={receipt} lead={lead} senderAddress={senderAddress} onSent={setReceipt} onDone={close} />
        ) : (
          <FormStep lead={lead} onCreated={setReceipt} onCancel={close} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FormStep({
  lead,
  onCreated,
  onCancel,
}: {
  lead: ReceiptLead;
  onCreated: (r: ReceiptRow) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const presetListId = useId();

  const [name, setName] = useState(() => billToName(lead));
  const [business, setBusiness] = useState(lead.business_name);
  const [email, setEmail] = useState(lead.no_email ? "" : (lead.business_email ?? ""));
  const [phone, setPhone] = useState(lead.business_phone ?? "");
  const [projectTitle, setProjectTitle] = useState("Digital Services Package");
  const [drafts, setDrafts] = useState<DraftItem[]>(() => prefillItems(lead).map(toDraft));
  const [method, setMethod] = useState<string>("");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(() => todayIso());
  const [discount, setDiscount] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [notesText, setNotesText] = useState("");
  const [notesTouched, setNotesTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => drafts.map(toItem), [drafts]);
  const totals = computeTotals(items, toNumber(discount), toNumber(taxRate));
  const suggested = useMemo(() => suggestNotes(items, paidOn).join("\n"), [items, paidOn]);
  // Suggested notes track the services until someone edits them by hand.
  const notes = notesTouched ? notesText : suggested;

  function update(key: number, patch: Partial<DraftItem>) {
    setDrafts((ds) =>
      ds.map((d) => {
        if (d.key !== key) return d;
        const next = { ...d, ...patch };
        // Picking a known service fills in its description and usual term.
        if (patch.title !== undefined) {
          const preset = SERVICE_PRESETS.find((p) => p.title.toLowerCase() === patch.title!.trim().toLowerCase());
          if (preset && !d.description.trim()) {
            next.description = preset.description;
            next.term = preset.term;
          }
        }
        return next;
      })
    );
  }

  async function create() {
    setError(null);
    const lines = items.filter((i) => i.title || i.rate);
    if (lines.length === 0) return setError("Add at least one service.");
    if (lines.some((i) => !i.title)) return setError("Every line needs a service name.");
    if (!method) return setError("Pick how the client paid.");
    if (totals.total <= 0) return setError("The total paid must be more than $0.");

    setBusy(true);
    const res = await fetch(`/api/leads/${lead.id}/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bill_to_name: name,
        bill_to_business: business,
        bill_to_email: email.trim(),
        bill_to_phone: phone.trim() || null,
        project_title: projectTitle,
        items: lines,
        discount: totals.discount,
        tax_rate: totals.taxRate,
        paid_on: paidOn,
        payment_method: method,
        payment_reference: reference.trim() || null,
        notes: notes.split("\n").map((l) => l.trim()).filter(Boolean),
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(j.error ?? "Could not create the receipt.");
      return;
    }
    toast({ kind: "success", title: `Receipt ${j.receipt.receipt_no} created` });
    onCreated(j.receipt as ReceiptRow);
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
        {/* Bill to */}
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">Bill to</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Client name">
              <input aria-label="Client name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Business" required>
              <input aria-label="Business" className={inputCls} value={business} onChange={(e) => setBusiness(e.target.value)} />
            </Field>
            <Field label="Email" hint={email ? undefined : "No email: you can download the PNG/PDF to text instead."}>
              <input aria-label="Email" className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@example.com" />
            </Field>
            <Field label="Phone">
              <input aria-label="Phone" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
        </section>

        {/* Services */}
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">Services</p>
            <input
              aria-label="Project title"
              className="w-56 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-muted outline-none focus:ring-2 focus:ring-accent"
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              title="Project title printed on the receipt"
            />
          </div>
          <datalist id={presetListId}>
            {SERVICE_PRESETS.map((p) => (
              <option key={p.title} value={p.title} />
            ))}
          </datalist>

          <ul className="space-y-2.5">
            {drafts.map((d) => (
              <li key={d.key} className="rounded-md border border-border bg-surface-2/50 p-3">
                {/* Phone: service on its own row, then term | price | delete. */}
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_120px_64px_110px_auto]">
                  <input
                    aria-label="Service"
                    list={presetListId}
                    className={cn(inputCls, "col-span-3 sm:col-span-1")}
                    placeholder="Service, e.g. Custom Website Development"
                    value={d.title}
                    onChange={(e) => update(d.key, { title: e.target.value })}
                  />
                  <select
                    aria-label="Term"
                    className={inputCls}
                    value={d.term}
                    onChange={(e) => update(d.key, { term: e.target.value as ReceiptTerm })}
                  >
                    {RECEIPT_TERMS.map((t) => (
                      <option key={t} value={t}>{TERM_LABEL[t]}</option>
                    ))}
                  </select>
                  <input
                    aria-label="Quantity"
                    inputMode="numeric"
                    className={cn(inputCls, "hidden sm:block")}
                    value={d.qty}
                    onChange={(e) => update(d.key, { qty: e.target.value })}
                  />
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-text-faint">$</span>
                    <input
                      aria-label="Price"
                      inputMode="decimal"
                      className={cn(inputCls, "pl-6")}
                      placeholder="0.00"
                      value={d.rate}
                      onChange={(e) => update(d.key, { rate: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    className={iconBtnDanger}
                    aria-label="Remove service"
                    title="Remove service"
                    onClick={() => setDrafts((ds) => (ds.length > 1 ? ds.filter((x) => x.key !== d.key) : [blankDraft()]))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <input
                  aria-label="Description"
                  className={cn(inputCls, "mt-2 text-xs")}
                  placeholder="Short description printed under the service (optional)"
                  value={d.description}
                  onChange={(e) => update(d.key, { description: e.target.value })}
                />
              </li>
            ))}
          </ul>
          <button type="button" className={cn(btnSecondarySm, "mt-2.5")} onClick={() => setDrafts((ds) => [...ds, blankDraft()])}>
            <Plus className="h-3.5 w-3.5" /> Add service
          </button>
        </section>

        {/* Payment */}
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">Payment</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Paid via" required>
              <select aria-label="Paid via" className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Choose…</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Reference / transaction ID">
              <input aria-label="Reference / transaction ID" className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Paid on" required>
              <input aria-label="Paid on" className={inputCls} type="date" value={paidOn} onChange={(e) => e.target.value && setPaidOn(e.target.value)} />
            </Field>
            <Field label="Discount ($)">
              <input aria-label="Discount ($)" className={inputCls} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
            </Field>
            <Field label="Tax (%)">
              <input aria-label="Tax (%)" className={inputCls} inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} placeholder="0" />
            </Field>
          </div>
        </section>

        {/* Notes */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">Payment &amp; coverage notes</p>
            {notesTouched && (
              <button
                type="button"
                className={btnSecondarySm}
                onClick={() => {
                  setNotesTouched(false);
                  setNotesText("");
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Use suggested
              </button>
            )}
          </div>
          <textarea
            aria-label="Notes"
            rows={4}
            className={cn(inputCls, "text-xs leading-relaxed")}
            value={notes}
            onChange={(e) => {
              setNotesTouched(true);
              setNotesText(e.target.value);
            }}
          />
          <p className="mt-1 text-[11px] text-text-faint">
            One note per line. The payment method line is added automatically.
          </p>
        </section>
      </div>

      {/* Totals + actions */}
      <footer className="border-t border-border bg-surface-2/60 px-5 py-3">
        {error && (
          <p className="mb-2 flex items-center gap-1.5 text-sm text-dropped-fg">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-text-muted">
            <div>Subtotal <span className="tabular font-mono text-text">{formatMoney(totals.subtotal)}</span></div>
            {totals.discount > 0 && <div>Discount <span className="tabular font-mono text-text">-{formatMoney(totals.discount)}</span></div>}
            {totals.taxAmount > 0 && <div>Tax <span className="tabular font-mono text-text">{formatMoney(totals.taxAmount)}</span></div>}
            <div className="text-sm font-semibold text-text">
              Total paid <span className="tabular font-mono">{formatMoney(totals.total)}</span>
            </div>
          </dl>
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={create} disabled={busy}>
              {busy ? "Creating…" : "Create receipt"}
            </button>
          </div>
        </div>
      </footer>
    </>
  );
}

/* ------------------------------------------------------------------ */

function IssuedStep({
  receipt,
  lead,
  senderAddress,
  onSent,
  onDone,
}: {
  receipt: ReceiptRow;
  lead: ReceiptLead;
  senderAddress: string | null;
  onSent: (r: ReceiptRow) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [to, setTo] = useState(receipt.sent_to ?? receipt.bill_to_email ?? "");
  const [sending, setSending] = useState(false);
  const [working, setWorking] = useState<"pdf" | "png" | null>(null);
  // This step only ever renders client-side (after a click), so reading
  // navigator in the initializer is safe.
  const [shareable, setShareable] = useState(() => canShareFiles());
  const [files, setFiles] = useState<ReceiptFiles | null>(null);
  const pdfUrl = `/api/receipts/${receipt.id}/pdf`;

  // Phones: build the PNG/PDF now so the Share tap opens the share sheet instantly.
  useEffect(() => {
    if (!shareable) return;
    let live = true;
    prepareReceiptFiles(receipt.id, receipt.receipt_no)
      .then((f) => live && setFiles(f))
      .catch(() => live && setShareable(false));
    return () => {
      live = false;
    };
  }, [shareable, receipt.id, receipt.receipt_no]);

  async function send() {
    setSending(true);
    const res = await fetch(`/api/receipts/${receipt.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: to.trim() }),
    });
    const j = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) {
      toast({ kind: "error", title: "Receipt not sent", body: j.error ?? "Please try again." });
      return;
    }
    toast({ kind: "success", title: "Receipt emailed", body: `Sent to ${to.trim()} from ${senderAddress ?? "the billing mailbox"}` });
    onSent(j.receipt as ReceiptRow);
  }

  async function download(kind: "pdf" | "png") {
    setWorking(kind);
    try {
      if (kind === "pdf") await downloadReceiptPdf(receipt.id, receipt.receipt_no);
      else await downloadReceiptPng(receipt.id, receipt.receipt_no);
    } catch (e) {
      toast({ kind: "error", title: `Could not download the ${kind.toUpperCase()}`, body: (e as Error).message });
    } finally {
      setWorking(null);
    }
  }

  function share() {
    if (!files) return;
    shareReceiptFiles(files, receipt.receipt_no, lead.business_name).catch((e: Error) => {
      if (e.name !== "AbortError") toast({ kind: "error", title: "Could not open sharing", body: e.message });
    });
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {/* Email */}
        <section className="rounded-md border border-border p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <Mail className="h-4 w-4 text-text-muted" /> Email the PDF to the client
          </p>
          {senderAddress ? (
            <p className="mt-0.5 text-xs text-text-muted">Sent from {senderAddress}.</p>
          ) : (
            <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-notready-bg px-2.5 py-1.5 text-xs text-notready-fg">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" />
              No billing mailbox is linked yet. An admin can link {BILLING_MAILBOX_ADDRESS} in Admin → Mail. You can still download the receipt below.
            </p>
          )}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              aria-label="Client email"
              type="email"
              className={inputCls}
              placeholder={receipt.bill_to_email ? undefined : "This lead has no email: add one, or download below"}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <button type="button" className={cn(btnPrimary, "shrink-0")} onClick={send} disabled={sending || !to.trim() || !senderAddress}>
              {sending ? "Sending…" : receipt.sent_at ? "Send again" : "Email receipt"}
            </button>
          </div>
          {receipt.sent_at && (
            <p className="mt-2 text-xs text-ready-fg">
              Sent to {receipt.sent_to} on {formatLongDate(receipt.sent_at.slice(0, 10))}.
            </p>
          )}
        </section>

        {/* Files */}
        <section className="rounded-md border border-border p-4">
          <p className="text-sm font-semibold text-text">Download or text it</p>
          <p className="mt-0.5 text-xs text-text-muted">
            For clients without email: send the PNG or PDF by text message.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btnSecondary} onClick={() => download("pdf")} disabled={working !== null}>
              <Download className="h-4 w-4" /> {working === "pdf" ? "Preparing…" : "Download PDF"}
            </button>
            <button type="button" className={btnSecondary} onClick={() => download("png")} disabled={working !== null}>
              <FileImage className="h-4 w-4" /> {working === "png" ? "Preparing…" : "Download PNG"}
            </button>
            {shareable && (
              <button type="button" className={btnSecondary} onClick={share} disabled={!files}>
                <Share2 className="h-4 w-4" /> {files ? "Share / text" : "Preparing…"}
              </button>
            )}
          </div>
        </section>

        {/* Preview (desktop; phones open the PDF in their own viewer) */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">Preview</p>
            <a href={pdfUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent-ink hover:underline">
              Open PDF in a new tab
            </a>
          </div>
          <iframe
            title={`Receipt ${receipt.receipt_no}`}
            src={pdfUrl}
            className="hidden h-[60vh] w-full rounded-md border border-border bg-white sm:block"
          />
        </section>
      </div>

      <footer className="flex justify-end border-t border-border bg-surface-2/60 px-5 py-3">
        <button type="button" className={btnSecondary} onClick={onDone}>
          Done
        </button>
      </footer>
    </>
  );
}
