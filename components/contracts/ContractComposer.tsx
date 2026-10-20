"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Send, FileText, Check, Loader2, FileSignature, Info, PencilLine, Upload, ExternalLink, RefreshCw, FileUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { Skeleton } from "@/components/common/Skeleton";
import { btnPrimary, btnSecondary, btnSecondarySm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { RecipientGuardStrip, useRecipientGuard } from "@/components/email-verify/RecipientGuard";
import { formatCurrency, formatDate } from "@/lib/leads/format";
import { parsePrice, formatUsd } from "@/lib/contracts/merge";
import { isPaidInFull, scheduleLines, type PaymentPlan } from "@/lib/contracts/payments";
import { MAX_CONTRACT_PDF_BYTES } from "@/lib/contracts/upload";
import { PaymentPlanEditor } from "@/components/contracts/PaymentPlanEditor";
import { ContractContentEditor } from "@/components/contracts/ContractContentEditor";
import type { ContractRow } from "@/lib/contracts/types";

type Mailbox = { id: string; email_address: string; display_name: string };
type Template = { id: string; name: string; placeholders: string[] };

const BUILTIN_VALUE = "builtin:standard";
const UPLOAD_VALUE = "upload";

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;

/** Read a chosen file as a PDF the server will accept, or say why not. */
function pdfProblem(f: File): string | null {
  if (f.size > MAX_CONTRACT_PDF_BYTES) return `That file is ${mb(f.size)} — the limit is ${mb(MAX_CONTRACT_PDF_BYTES)}.`;
  if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") return "Choose a PDF file.";
  return null;
}

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

/** One selectable template (or "upload your own") card. */
function TemplateCard({
  value,
  name,
  sub,
  selection,
  locked,
  onSelect,
}: {
  value: string;
  name: string;
  sub: string;
  selection: string;
  locked: boolean;
  onSelect: (v: string) => void;
}) {
  const selected = selection === value;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
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

export function ContractComposer({
  leadId,
  mailboxes,
  onClose,
  recipientEmail = null,
  leadOneTimePrice = null,
  leadYearlyPrice = null,
  existing = null,
}: {
  leadId: string;
  mailboxes: Mailbox[];
  onClose: () => void;
  /** Reopen a draft made earlier (edit it, replace its PDF, send it). */
  existing?: ContractRow | null;
  /** The lead's email — checked as soon as the composer opens. */
  recipientEmail?: string | null;
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
  const [mailboxId, setMailboxId] = useState(existing?.mailbox_id ?? mailboxes[0]?.id ?? "");
  const [message, setMessage] = useState(
    existing?.message_body ?? "Hi,\n\nPlease find your website services agreement attached. Let me know if you have any questions.\n\nThank you.",
  );
  const [oneTime, setOneTime] = useState(() => priceInputValue(existing ? existing.one_time_price : leadOneTimePrice));
  const [yearly, setYearly] = useState(() => priceInputValue(existing ? existing.yearly_price : leadYearlyPrice));
  const [contractId, setContractId] = useState<string | null>(existing?.id ?? null);
  const [draft, setDraft] = useState<ContractRow | null>(existing);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PaymentPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState<null | "upload" | "refresh">(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const isUpload = selection === UPLOAD_VALUE;

  // Checked as soon as the composer opens (from the lead's address), then against
  // the address the generated contract is actually addressed to.
  const recipient = draft?.recipient_email || draft?.business_email || recipientEmail || "";
  const guard = useRecipientGuard(recipient);

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
      const payload = {
        lead_id: leadId,
        mailbox_id: mailboxId,
        template_key: "standard",
        google_template_id: isUpload ? null : google_template_id,
        message_body: message,
        // Sent every time so an agent's discount (or a cleared yearly) always wins.
        one_time_price: parsePrice(oneTime),
        yearly_price: parsePrice(yearly),
        source: isUpload ? "upload" : "template",
        payment_plan: isUpload ? null : plan,
      };
      let init: RequestInit;
      if (isUpload && file) {
        const form = new FormData();
        form.set("data", JSON.stringify(payload));
        form.set("file", file);
        init = { method: "POST", body: form };
      } else {
        init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
      }
      const res = await fetch("/api/contracts", init);
      const data = await res.json();
      if (!res.ok) {
        const detail = data.missing ? `Missing: ${data.missing.join(", ")}` : data.error;
        toast({ kind: "error", title: "Cannot create contract", body: detail });
        return;
      }
      setContractId(data.contract.id);
      setDraft(data.contract as ContractRow);
      setNotice(data.notice ?? null);
      toast({ kind: "success", title: "Draft ready — review the preview below" });
      router.refresh();
    } finally { setBusy(false); }
  }

  async function replacePdf(f: File) {
    if (!contractId) return;
    const problem = pdfProblem(f);
    if (problem) { toast({ kind: "error", title: "Can't use that file", body: problem }); return; }
    setWorking("upload");
    try {
      const form = new FormData();
      form.set("file", f);
      const res = await fetch(`/api/contracts/${contractId}/pdf`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Upload failed", body: data.error }); return; }
      setDraft(data.contract as ContractRow);
      setEditing(false);
      toast({ kind: "success", title: "Your PDF will be sent instead" });
      router.refresh();
    } finally { setWorking(null); }
  }

  async function refreshPdf() {
    if (!contractId) return;
    setWorking("refresh");
    try {
      const res = await fetch(`/api/contracts/${contractId}/refresh-pdf`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Couldn't refresh the PDF", body: data.error }); return; }
      setDraft(data.contract as ContractRow);
      toast({ kind: "success", title: "PDF re-made from the Google Doc" });
      router.refresh();
    } finally { setWorking(null); }
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
  const cardProps = { selection, locked, onSelect: setSelection };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={existing ? "Contract draft" : "New contract"}
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
              <h2 className="font-display text-base font-semibold leading-tight text-text">{existing ? "Contract draft" : "New contract"}</h2>
              <p className="text-xs text-text-muted">
                {locked
                  ? "Review the PDF — edit the wording or swap in your own file if needed — then send it."
                  : "Pick a template (or upload your own PDF), set the price and payment terms, then preview."}
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
          {!existing && (
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
                      {...cardProps}
                      key={t.id}
                      value={`google:${t.id}`}
                      name={t.name}
                      sub={`Google Doc · ${t.placeholders.length} placeholder${t.placeholders.length === 1 ? "" : "s"}`}
                    />
                  ))}
                  <TemplateCard
                    {...cardProps}
                    value={BUILTIN_VALUE}
                    name="Website Development Agreement"
                    sub="Built in — no Google required"
                  />
                  <TemplateCard {...cardProps} value={UPLOAD_VALUE} name="Upload your own PDF" sub="Send a contract you prepared yourself" />
                </div>
              )}

              {isUpload && (
                <label
                  className={cn(
                    "mt-2 flex cursor-pointer items-center gap-3 rounded-md border border-dashed p-3 transition-colors duration-150",
                    file ? "border-accent bg-accent-soft/40" : "border-border hover:bg-surface-2",
                    locked && "pointer-events-none opacity-60",
                  )}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (!f) return;
                    const problem = pdfProblem(f);
                    if (problem) toast({ kind: "error", title: "Can't use that file", body: problem });
                    else setFile(f);
                  }}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-2 text-text-muted ring-1 ring-inset ring-border">
                    <FileUp className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{file ? file.name : "Choose the contract PDF"}</span>
                    <span className="block text-[11px] text-text-muted">
                      {file ? `${mb(file.size)} · click to pick a different file` : `Drop it here or click to browse · PDF up to ${mb(MAX_CONTRACT_PDF_BYTES)}`}
                    </span>
                  </span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    disabled={locked}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      const problem = pdfProblem(f);
                      if (problem) toast({ kind: "error", title: "Can't use that file", body: problem });
                      else setFile(f);
                    }}
                  />
                </label>
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
          )}

          <Field label="Send from" required>
            <select className={inputCls} value={mailboxId} onChange={(e) => setMailboxId(e.target.value)} disabled={locked}>
              {mailboxes.length === 0 && <option value="">No verified mailbox</option>}
              {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email_address}</option>)}
            </select>
          </Field>

          {/* Pricing — editable before the draft exists, since the PDF is
              generated at creation time. Afterwards the summary shows it. */}
          {!locked && (
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
          )}

          {/* Payment terms — merged into the template ({{payment_terms}}), so
              chosen before the draft exists. An uploaded PDF has its own. */}
          {!locked && !isUpload && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-text-muted">Payment terms</p>
              <PaymentPlanEditor
                total={parsePrice(oneTime)}
                onChange={(p, err) => {
                  setPlan(p);
                  setPlanError(err);
                }}
              />
            </div>
          )}

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
              {draft.template_key !== "upload" && (
                <div className="mt-2.5 border-t border-border-subtle pt-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-faint">Payments</p>
                  {isPaidInFull(draft.payment_plan) ? (
                    <p className="text-sm text-text">In full upon signing</p>
                  ) : (
                    <ul className="tabular space-y-0.5 font-mono text-xs text-text">
                      {scheduleLines(draft.payment_plan!).map((l) => <li key={l}>{l}</li>)}
                    </ul>
                  )}
                </div>
              )}
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

          {/* Recipient check. WARN is advisory; BLOCK disables Send until overridden. */}
          <RecipientGuardStrip guard={guard} />

          {/* PDF preview, and what can still change before sending */}
          {locked && draft && (
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-text-muted">{editing ? "Edit the wording" : "PDF preview"}</p>
                {!editing && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {draft.generated_doc_id && (
                      <button type="button" className={btnSecondarySm} onClick={() => setEditing(true)} disabled={!!working}>
                        <PencilLine className="h-3.5 w-3.5" /> Edit contract
                      </button>
                    )}
                    <button
                      type="button"
                      className={btnSecondarySm}
                      onClick={() => replaceInput.current?.click()}
                      disabled={!!working}
                      title="Send a PDF of your own instead of this one"
                    >
                      {working === "upload" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                      {draft.template_key === "upload" ? "Replace PDF" : "Replace with my PDF"}
                    </button>
                    {draft.generated_doc_url && (
                      <a
                        href={draft.generated_doc_url}
                        target="_blank"
                        rel="noreferrer"
                        className={btnSecondarySm}
                        title="Open the contract's Google Doc (needs access to the company Google account) — then use Refresh PDF"
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> Google Docs
                      </a>
                    )}
                    {draft.generated_doc_id && (
                      <button
                        type="button"
                        className={btnSecondarySm}
                        onClick={refreshPdf}
                        disabled={!!working}
                        title="Re-make the PDF from the Google Doc"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", working === "refresh" && "animate-spin")} /> Refresh PDF
                      </button>
                    )}
                    <input
                      ref={replaceInput}
                      type="file"
                      accept="application/pdf,.pdf"
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void replacePdf(f);
                      }}
                    />
                  </div>
                )}
              </div>

              {notice && !editing && (
                <p className="mb-2 flex items-start gap-1.5 rounded-md bg-notready-bg px-2.5 py-1.5 text-[11px] leading-relaxed text-notready-fg">
                  <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>{notice}</span>
                </p>
              )}
              {draft.pdf_uploaded_name && !editing && (
                <p className="mb-2 flex items-start gap-1.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-[11px] leading-relaxed text-text-muted">
                  <FileUp className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>
                    Sending your file <span className="font-medium text-text">{draft.pdf_uploaded_name}</span>.
                    {draft.generated_doc_id ? " Refresh PDF goes back to the generated contract." : ""}
                  </span>
                </p>
              )}

              <div className="overflow-hidden rounded-md border border-border bg-surface-2" style={{ height: editing ? 560 : 480 }}>
                {editing ? (
                  <ContractContentEditor
                    contract={draft}
                    onSaved={(c) => {
                      setDraft(c);
                      setNotice(null);
                      toast({ kind: "success", title: "Contract updated" });
                      router.refresh();
                    }}
                    onClose={() => setEditing(false)}
                  />
                ) : (
                  <iframe
                    key={draft.edited_at ?? "first"}
                    title="Contract preview"
                    src={`/api/contracts/${contractId}/pdf${draft.edited_at ? `?v=${encodeURIComponent(draft.edited_at)}` : ""}`}
                    className="h-full w-full"
                  />
                )}
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
              <button
                type="button"
                onClick={createDraft}
                disabled={busy || !mailboxId || (isUpload ? !file : !!planError)}
                title={isUpload && !file ? "Choose the PDF to send first" : planError ?? undefined}
                className={btnPrimary}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                {busy ? "Preparing…" : "Create & preview"}
              </button>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={busy || guard.blocked || editing || !!working}
                title={guard.blocked ? "This recipient address cannot receive mail — use “Send anyway” to override." : undefined}
                className={btnPrimary}
              >
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
