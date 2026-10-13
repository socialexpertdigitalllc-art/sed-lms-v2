"use client";

import { useState } from "react";
import { ReceiptText } from "lucide-react";
import { Field, inputCls } from "@/components/forms/Field";
import { btnPrimary } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { BILLING_MAILBOX_ADDRESS } from "@/lib/receipts/company";
import type { ReceiptSettings } from "@/lib/receipts/settings";

type Mailbox = { id: string; email_address: string };

/** Payments page: who signs receipts and which mailbox emails them. */
export function ReceiptSettingsCard({
  initial,
  sender,
  mailboxes,
}: {
  initial: ReceiptSettings;
  sender: string | null;
  mailboxes: Mailbox[];
}) {
  const { toast } = useToast();
  const [saved, setSaved] = useState(initial);
  const [signer, setSigner] = useState(initial.signerName);
  const [mailboxId, setMailboxId] = useState(initial.mailboxId ?? "");
  const [currentSender, setCurrentSender] = useState(sender);
  const [saving, setSaving] = useState(false);
  const dirty = signer.trim() !== saved.signerName || (mailboxId || null) !== saved.mailboxId;

  async function save() {
    setSaving(true);
    const res = await fetch("/api/receipts/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signer_name: signer.trim(), mailbox_id: mailboxId || null }),
    });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({ kind: "error", title: "Receipt settings not saved", body: j.error ?? "Please try again." });
      return;
    }
    setSaved(j.settings as ReceiptSettings);
    setCurrentSender(j.sender ?? null);
    toast({ kind: "success", title: "Receipt settings saved" });
  }

  return (
    <section className="mb-6 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-ink">
          <ReceiptText className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold text-text">Payment receipts</h2>
          <p className="text-sm text-text-muted">
            {currentSender ? (
              <>Receipts are emailed from <span className="font-medium text-text">{currentSender}</span>.</>
            ) : (
              <>No sending mailbox yet. Link {BILLING_MAILBOX_ADDRESS} in Admin → Mail, or pick a mailbox below.</>
            )}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Signature name" hint="Printed in handwriting on every receipt.">
          <input aria-label="Signature name" className={inputCls} value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="e.g. the owner's full name" maxLength={80} />
        </Field>
        <Field label="Send from" hint="Automatic uses the billing mailbox once it's linked.">
          <select aria-label="Send from" className={inputCls} value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
            <option value="">Automatic ({BILLING_MAILBOX_ADDRESS})</option>
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>{m.email_address}</option>
            ))}
          </select>
        </Field>
        <button type="button" className={btnPrimary} onClick={save} disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
