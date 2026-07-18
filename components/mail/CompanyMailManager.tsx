"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, RefreshCw, Trash2, ChevronDown, ChevronUp, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, FormSection, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { MAILBOX_DEFAULTS } from "@/lib/mail/types";

export type MailboxListItem = {
  id: string; user_id: string; email_address: string; display_name: string;
  imap_host: string | null; imap_port: number | null; smtp_host: string | null; smtp_port: number | null;
  status: "unverified" | "verified" | "error"; last_verified_at: string | null; last_error: string | null;
  created_at: string; owner_name: string;
};
type Owner = { id: string; name: string };

const STATUS_PILL: Record<MailboxListItem["status"], string> = {
  verified: "bg-ready-bg text-ready-fg",
  error: "bg-dropped-bg text-dropped-fg",
  unverified: "bg-notready-bg text-notready-fg",
};
const STATUS_ICON = { verified: ShieldCheck, error: ShieldAlert, unverified: ShieldQuestion };

export function CompanyMailManager({ initial, owners }: { initial: MailboxListItem[]; owners: Owner[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState<MailboxListItem[]>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [userId, setUserId] = useState(owners[0]?.id ?? "");
  const [address, setAddress] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [imapHost, setImapHost] = useState<string>(MAILBOX_DEFAULTS.imap_host);
  const [imapPort, setImapPort] = useState(String(MAILBOX_DEFAULTS.imap_port));
  const [smtpHost, setSmtpHost] = useState<string>(MAILBOX_DEFAULTS.smtp_host);
  const [smtpPort, setSmtpPort] = useState(String(MAILBOX_DEFAULTS.smtp_port));
  const [submitting, setSubmitting] = useState(false);

  async function link(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = { user_id: userId, email_address: address, display_name: displayName, password };
      if (advanced) {
        body.imap_host = imapHost; body.imap_port = Number(imapPort);
        body.smtp_host = smtpHost; body.smtp_port = Number(smtpPort);
      }
      const res = await fetch("/api/admin/mail/mailboxes", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Link failed", body: data.error }); return; }
      setRows((prev) => [{ ...data.mailbox, owner_name: owners.find((o) => o.id === userId)?.name ?? "—" }, ...prev]);
      setPassword(""); setAddress(""); setDisplayName("");
      toast({
        kind: data.mailbox.status === "verified" ? "success" : "error",
        title: data.mailbox.status === "verified" ? "Mailbox verified" : "Linked, but verification failed",
        body: data.mailbox.last_error ?? undefined,
      });
      router.refresh();
    } finally { setSubmitting(false); }
  }

  async function reverify(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/mail/mailboxes/${id}/verify`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Verify failed", body: data.error }); return; }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...data.mailbox, owner_name: r.owner_name } : r)));
      toast({ kind: data.mailbox.status === "verified" ? "success" : "error", title: `Status: ${data.mailbox.status}`, body: data.mailbox.last_error ?? undefined });
    } finally { setBusyId(null); }
  }

  async function unlink(id: string) {
    if (!confirm("Unlink this mailbox? The stored credential is deleted.")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/mail/mailboxes/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); toast({ kind: "error", title: "Unlink failed", body: d.error }); return; }
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast({ kind: "success", title: "Mailbox unlinked" });
    } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={link} className="rounded-lg border border-border bg-surface p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text"><Mail className="w-4 h-4" /> Link a mailbox</div>
        <FormSection title="Mailbox">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Owner" required>
              <select className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <Field label="Display name">
              <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Agent One" />
            </Field>
            <Field label="Email address" required>
              <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="agent@socialexpertdigitalllc.com" />
            </Field>
            <Field label="Password" required hint="Stored encrypted; never shown again.">
              <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
        </FormSection>

        <button type="button" onClick={() => setAdvanced((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text">
          {advanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />} Advanced (host / port override)
        </button>
        {advanced && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="IMAP host"><input className={inputCls} value={imapHost} onChange={(e) => setImapHost(e.target.value)} /></Field>
            <Field label="IMAP port"><input className={inputCls} inputMode="numeric" value={imapPort} onChange={(e) => setImapPort(e.target.value)} /></Field>
            <Field label="SMTP host"><input className={inputCls} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} /></Field>
            <Field label="SMTP port"><input className={inputCls} inputMode="numeric" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} /></Field>
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={submitting || !address || !password} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
            {submitting ? "Linking…" : "Link & verify"}
          </button>
        </div>
      </form>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-text-muted">
            <tr>
              <th className="text-left font-medium px-3 py-2">Address</th>
              <th className="text-left font-medium px-3 py-2">Owner</th>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="text-left font-medium px-3 py-2">Last verified</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-text-faint">No mailboxes linked yet.</td></tr>
            )}
            {rows.map((r) => {
              const Icon = STATUS_ICON[r.status];
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium text-text">{r.email_address}</div>
                    {r.status === "error" && r.last_error && <div className="text-[11px] text-dropped-fg truncate max-w-xs">{r.last_error}</div>}
                  </td>
                  <td className="px-3 py-2 text-text-muted">{r.owner_name}</td>
                  <td className="px-3 py-2">
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_PILL[r.status])}>
                      <Icon className="w-3 h-3" /> {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text-faint">{r.last_verified_at ? new Date(r.last_verified_at).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => reverify(r.id)} disabled={busyId === r.id} title="Re-verify" className="p-1.5 rounded text-text-muted hover:text-text hover:bg-surface-2 disabled:opacity-50">
                        <RefreshCw className={cn("w-4 h-4", busyId === r.id && "animate-spin")} />
                      </button>
                      <button onClick={() => unlink(r.id)} disabled={busyId === r.id} title="Unlink" className="p-1.5 rounded text-text-muted hover:text-dropped-fg hover:bg-surface-2 disabled:opacity-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
