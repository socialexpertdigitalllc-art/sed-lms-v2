"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox, Send as SendIcon, RefreshCw, Paperclip, X, CornerUpLeft, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";

type Folder = "INBOX" | "Sent";
type ListItem = { uid: number; from: string; subject: string; date: string; seen: boolean; preview: string; hasAttachments: boolean };
type Attachment = { filename: string; size: number; partId: string };
type FullMessage = { from: string; to: string; subject: string; date: string; html: string | null; text: string | null; attachments: Attachment[] };

export function Mailbox({ address }: { address: string }) {
  const { toast } = useToast();
  const [folder, setFolder] = useState<Folder>("INBOX");
  const [items, setItems] = useState<ListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [openUid, setOpenUid] = useState<number | null>(null);
  const [message, setMessage] = useState<FullMessage | null>(null);
  const [composing, setComposing] = useState<null | { to: string; subject: string; body: string }>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async (f: Folder) => {
    setLoading(true);
    setOpenUid(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/mail/messages?folder=${f}&page=1`);
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Could not load mail", body: data.error }); return; }
      setItems(data.messages ?? []);
      setTotal(data.total ?? 0);
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(folder); }, [folder, load]);

  async function open(uid: number) {
    setOpenUid(uid);
    setMessage(null);
    const res = await fetch(`/api/mail/messages/${uid}?folder=${folder}`);
    const data = await res.json();
    if (!res.ok) { toast({ kind: "error", title: "Could not open message", body: data.error }); return; }
    setMessage(data.message);
    if (folder === "INBOX") {
      fetch(`/api/mail/messages/${uid}/seen?folder=${folder}`, { method: "POST" }).catch(() => {});
      setItems((prev) => prev.map((m) => (m.uid === uid ? { ...m, seen: true } : m)));
    }
  }

  function startReply() {
    if (!message) return;
    const subject = message.subject.startsWith("Re:") ? message.subject : `Re: ${message.subject}`;
    const quoted = `\n\n----- Original message -----\nFrom: ${message.from}\nDate: ${new Date(message.date).toLocaleString()}\nSubject: ${message.subject}\n\n${message.text ?? ""}`;
    // reply-to address is the sender's bare address portion
    const to = message.from.match(/<([^>]+)>/)?.[1] ?? message.from;
    setComposing({ to, subject, body: quoted });
  }

  async function send() {
    if (!composing) return;
    setSending(true);
    try {
      const res = await fetch("/api/mail/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: composing.to, subject: composing.subject, body: composing.body }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Send failed", body: data.error }); return; }
      toast({ kind: "success", title: "Message sent" });
      setComposing(null);
      if (folder === "Sent") load("Sent");
    } finally { setSending(false); }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
      {/* Left: folders + list */}
      <div className="space-y-3">
        <div className="flex items-center gap-1">
          <button onClick={() => setFolder("INBOX")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", folder === "INBOX" ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")}>
            <Inbox className="w-4 h-4" /> Inbox
          </button>
          <button onClick={() => setFolder("Sent")} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", folder === "Sent" ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2")}>
            <SendIcon className="w-4 h-4" /> Sent
          </button>
          <button onClick={() => load(folder)} title="Refresh" className="ml-auto p-1.5 rounded text-text-muted hover:text-text hover:bg-surface-2">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
        <button onClick={() => setComposing({ to: "", subject: "", body: "" })} className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink">Compose</button>

        <div className="rounded-lg border border-border bg-surface divide-y divide-border max-h-[70vh] overflow-y-auto">
          {items.length === 0 && !loading && <p className="px-3 py-6 text-center text-sm text-text-faint">No messages.</p>}
          {items.map((m) => (
            <button key={m.uid} onClick={() => open(m.uid)} className={cn("w-full text-left px-3 py-2.5", openUid === m.uid ? "bg-surface-2" : "hover:bg-surface-2")}>
              <div className="flex items-center justify-between gap-2">
                <span className={cn("truncate text-sm", m.seen ? "text-text-muted" : "font-semibold text-text")}>{m.from || "(unknown)"}</span>
                <span className="shrink-0 text-[11px] text-text-faint">{new Date(m.date).toLocaleDateString()}</span>
              </div>
              <div className={cn("truncate text-sm flex items-center gap-1", m.seen ? "text-text-muted" : "text-text")}>
                {m.hasAttachments && <Paperclip className="w-3 h-3 shrink-0" />} {m.subject}
              </div>
              <div className="truncate text-[11px] text-text-faint">{m.preview}</div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-faint">{total} message{total === 1 ? "" : "s"} in {folder}</p>
      </div>

      {/* Right: reading pane */}
      <div className="rounded-lg border border-border bg-surface p-4 min-h-[300px]">
        {!message ? (
          <div className="h-full flex items-center justify-center text-sm text-text-faint">Select a message to read.</div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-text">{message.subject}</h2>
                <p className="text-xs text-text-muted mt-0.5">From {message.from}</p>
                <p className="text-xs text-text-muted">To {message.to}</p>
                <p className="text-[11px] text-text-faint">{new Date(message.date).toLocaleString()}</p>
              </div>
              <button onClick={startReply} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text hover:bg-surface-2">
                <CornerUpLeft className="w-3.5 h-3.5" /> Reply
              </button>
            </div>

            {message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {message.attachments.map((a) => (
                  <a key={a.partId} href={`/api/mail/messages/${openUid}/attachment?folder=${folder}&part=${encodeURIComponent(a.partId)}`} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text hover:bg-surface-2">
                    <Paperclip className="w-3 h-3" /> {a.filename}
                  </a>
                ))}
              </div>
            )}

            {/* Received HTML rendered in a script-less, origin-less sandbox — never runs in our origin. */}
            {message.html ? (
              <iframe
                title="Message body"
                sandbox=""
                srcDoc={message.html}
                className="w-full rounded-md border border-border bg-white"
                style={{ height: 480 }}
              />
            ) : (
              <pre className="whitespace-pre-wrap text-sm text-text">{message.text ?? "(no content)"}</pre>
            )}
          </div>
        )}
      </div>

      {/* Compose / Reply modal */}
      {composing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setComposing(null)}>
          <div className="w-full max-w-2xl rounded-lg border border-border bg-surface p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-text"><Mail className="w-4 h-4" /> New message · from {address}</div>
              <button onClick={() => setComposing(null)} className="p-1 rounded text-text-faint hover:text-text"><X className="w-4 h-4" /></button>
            </div>
            <Field label="To" required>
              <input className={inputCls} value={composing.to} onChange={(e) => setComposing({ ...composing, to: e.target.value })} placeholder="recipient@example.com" />
            </Field>
            <Field label="Subject">
              <input className={inputCls} value={composing.subject} onChange={(e) => setComposing({ ...composing, subject: e.target.value })} />
            </Field>
            <Field label="Message">
              <textarea className={cn(inputCls, "min-h-[200px]")} value={composing.body} onChange={(e) => setComposing({ ...composing, body: e.target.value })} />
            </Field>
            <div className="flex justify-end">
              <button onClick={send} disabled={sending || !composing.to} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">
                <SendIcon className="w-4 h-4" /> {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
