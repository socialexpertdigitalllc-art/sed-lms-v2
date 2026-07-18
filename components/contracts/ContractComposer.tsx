"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Send, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";

type Mailbox = { id: string; email_address: string; display_name: string };

export function ContractComposer({
  leadId,
  mailboxes,
  onClose,
}: {
  leadId: string;
  mailboxes: Mailbox[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [templateKey, setTemplateKey] = useState<string>(CONTRACT_TEMPLATES[0].key);
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? "");
  const [message, setMessage] = useState("Hi,\n\nPlease find your website services agreement attached. Let me know if you have any questions.\n\nThank you.");
  const [contractId, setContractId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createDraft() {
    setBusy(true);
    try {
      const res = await fetch("/api/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, mailbox_id: mailboxId, template_key: templateKey, message_body: message }),
      });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.missing ? `Missing: ${data.missing.join(", ")}` : data.error;
        toast({ kind: "error", title: "Cannot create contract", body: detail });
        return;
      }
      setContractId(data.contract.id);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-surface p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-text"><FileText className="w-4 h-4" /> New contract</div>
          <button onClick={onClose} className="p-1 rounded text-text-faint hover:text-text"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Template">
            <select className={inputCls} value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} disabled={!!contractId}>
              {CONTRACT_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Send from" required>
            <select className={inputCls} value={mailboxId} onChange={(e) => setMailboxId(e.target.value)} disabled={!!contractId}>
              {mailboxes.length === 0 && <option value="">No verified mailbox</option>}
              {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.email_address}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Cover message">
          <textarea className={cn(inputCls, "min-h-[120px]")} value={message} onChange={(e) => setMessage(e.target.value)} disabled={!!contractId} />
        </Field>

        {!contractId ? (
          <div className="flex justify-end">
            <button onClick={createDraft} disabled={busy || !mailboxId} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
              {busy ? "Preparing…" : "Create & preview"}
            </button>
          </div>
        ) : (
          <>
            <div className="rounded-md border border-border overflow-hidden" style={{ height: 480 }}>
              <iframe title="Contract preview" src={`/api/contracts/${contractId}/pdf`} className="w-full h-full" />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-faint">Review carefully. Sending emails the PDF from the selected mailbox.</p>
              <button onClick={send} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
                <Send className="w-4 h-4" /> {busy ? "Sending…" : "Send contract"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
