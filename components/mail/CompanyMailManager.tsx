"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  MailPlus,
  RefreshCw,
  Trash2,
  ChevronDown,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  AlertTriangle,
  Loader2,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { Panel, EmptyPanel, Pill, type PillTone } from "@/components/common/Panel";
import { btnPrimary, iconBtn, iconBtnDanger } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { formatDateTime } from "@/lib/leads/format";
import { MAILBOX_DEFAULTS } from "@/lib/mail/types";

export type MailboxListItem = {
  id: string; user_id: string; email_address: string; display_name: string;
  imap_host: string | null; imap_port: number | null; smtp_host: string | null; smtp_port: number | null;
  status: "unverified" | "verified" | "error"; last_verified_at: string | null; last_error: string | null;
  created_at: string; owner_name: string;
};
type Owner = { id: string; name: string };

const STATUS_TONE: Record<MailboxListItem["status"], PillTone> = {
  verified: "ready",
  error: "dropped",
  unverified: "notready",
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
    <div className="space-y-5">
      {/* ── Link form ────────────────────────────────────────────── */}
      <form id="link-mailbox" onSubmit={link} className="scroll-mt-6">
        <Panel
          icon={MailPlus}
          title="Link a mailbox"
          description="Credentials are encrypted at rest and only ever used server-side."
          footer={
            <>
              <p className="mr-auto hidden text-[11px] text-text-faint sm:block">
                Linking runs an IMAP + SMTP check immediately.
              </p>
              <button type="submit" disabled={submitting || !address || !password} className={btnPrimary}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {submitting ? "Linking…" : "Link & verify"}
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

          {/* Advanced host / port override */}
          <div className="mt-4 rounded-md border border-border-subtle bg-surface-2">
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              aria-expanded={advanced}
              className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-xs font-medium text-text-muted transition-colors duration-150 hover:text-text"
            >
              <span>Advanced — host / port override</span>
              <span className="flex items-center gap-2">
                {!advanced && <span className="tabular font-mono text-[11px] text-text-faint">defaults</span>}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-150", advanced && "rotate-180")} />
              </span>
            </button>
            {advanced && (
              <div className="grid grid-cols-2 gap-4 border-t border-border-subtle bg-surface p-3 sm:grid-cols-4">
                <Field label="IMAP host"><input className={inputCls} value={imapHost} onChange={(e) => setImapHost(e.target.value)} /></Field>
                <Field label="IMAP port"><input className={cn(inputCls, "font-mono")} inputMode="numeric" value={imapPort} onChange={(e) => setImapPort(e.target.value)} /></Field>
                <Field label="SMTP host"><input className={inputCls} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} /></Field>
                <Field label="SMTP port"><input className={cn(inputCls, "font-mono")} inputMode="numeric" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} /></Field>
              </div>
            )}
          </div>
        </Panel>
      </form>

      {/* ── Linked mailboxes ─────────────────────────────────────── */}
      <Panel icon={Inbox} title="Linked mailboxes" description="One mailbox per agent." count={rows.length} flush>
        {rows.length === 0 ? (
          <EmptyPanel
            icon={Mail}
            title="No mailboxes linked"
            hint="Create the mailbox in Hostinger first, then link it above so the agent can send and read mail here."
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {rows.map((r) => {
              const Icon = STATUS_ICON[r.status];
              const busy = busyId === r.id;
              return (
                <li key={r.id} className="px-4 py-3 transition-colors duration-150 hover:bg-surface-2">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent-ink">
                      <Mail className="h-4 w-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-sm font-medium text-text" title={r.email_address}>{r.email_address}</p>
                        <Pill tone={STATUS_TONE[r.status]} icon={Icon}>{r.status}</Pill>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-text-muted">
                        {r.owner_name}
                        {r.display_name ? <span className="text-text-faint"> · {r.display_name}</span> : null}
                      </p>
                    </div>

                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-[10px] uppercase tracking-wide text-text-faint">Last verified</p>
                      <p className="tabular font-mono text-xs text-text-muted">
                        {r.last_verified_at ? formatDateTime(r.last_verified_at) : "—"}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => reverify(r.id)}
                        disabled={busy}
                        title="Re-verify IMAP + SMTP"
                        aria-label="Re-verify mailbox"
                        className={iconBtn}
                      >
                        <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
                      </button>
                      <button
                        type="button"
                        onClick={() => unlink(r.id)}
                        disabled={busy}
                        title="Unlink and delete the stored credential"
                        aria-label="Unlink mailbox"
                        className={iconBtnDanger}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {r.status === "error" && r.last_error && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md bg-dropped-bg px-2.5 py-1.5 text-[11px] leading-relaxed text-dropped-fg sm:ml-12">
                      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span className="line-clamp-2 min-w-0" title={r.last_error}>{r.last_error}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
