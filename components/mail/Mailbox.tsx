"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CornerUpLeft,
  Download,
  Inbox,
  MailOpen,
  Paperclip,
  PenSquare,
  RefreshCw,
  Send as SendIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/common/Toast";
import { ComposeDrawer, type Draft, type OutgoingAttachment } from "@/components/mail/ComposeDrawer";
import {
  Avatar,
  EmptyState,
  ListSkeleton,
  ReaderSkeleton,
  formatBytes,
  fullDate,
  listDate,
  parseAddress,
} from "@/components/mail/MailParts";

type Folder = "INBOX" | "Sent";
type ListItem = { uid: number; from: string; subject: string; date: string; seen: boolean; preview: string; hasAttachments: boolean };
type Attachment = { filename: string; size: number; partId: string };
type FullMessage = { from: string; to: string; subject: string; date: string; html: string | null; text: string | null; attachments: Attachment[] };

const FOLDERS: { id: Folder; label: string; icon: typeof Inbox }[] = [
  { id: "INBOX", label: "Inbox", icon: Inbox },
  { id: "Sent", label: "Sent", icon: SendIcon },
];

export function Mailbox({ address }: { address: string }) {
  const { toast } = useToast();
  const [folder, setFolder] = useState<Folder>("INBOX");
  const [items, setItems] = useState<ListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [openUid, setOpenUid] = useState<number | null>(null);
  const [message, setMessage] = useState<FullMessage | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [composing, setComposing] = useState<null | Draft>(null);
  const [isReply, setIsReply] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async (f: Folder) => {
    setLoading(true);
    setOpenUid(null);
    setMessage(null);
    setReadError(null);
    try {
      const res = await fetch(`/api/mail/messages?folder=${f}&page=1`);
      const data = await res.json();
      if (!res.ok) {
        toast({ kind: "error", title: "Could not load mail", body: data.error });
        setListError(data.error ?? "Could not load mail");
        return;
      }
      setListError(null);
      setItems(data.messages ?? []);
      setTotal(data.total ?? 0);
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(folder); }, [folder, load]);

  async function open(uid: number) {
    setOpenUid(uid);
    setMessage(null);
    setReadError(null);
    const res = await fetch(`/api/mail/messages/${uid}?folder=${folder}`);
    const data = await res.json();
    if (!res.ok) {
      toast({ kind: "error", title: "Could not open message", body: data.error });
      setReadError(data.error ?? "Could not open message");
      return;
    }
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
    setIsReply(true);
    setComposing({ to, subject, body: quoted });
  }

  function startCompose() {
    setIsReply(false);
    setComposing({ to: "", subject: "", body: "" });
  }

  async function send(attachments: OutgoingAttachment[]) {
    if (!composing) return;
    setSending(true);
    try {
      const res = await fetch("/api/mail/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: composing.to, subject: composing.subject, body: composing.body, attachments }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Send failed", body: data.error }); return; }
      toast({ kind: "success", title: "Message sent" });
      setComposing(null);
      if (folder === "Sent") load("Sent");
    } finally { setSending(false); }
  }

  const activeLabel = FOLDERS.find((f) => f.id === folder)?.label ?? folder;
  const readerLoading = openUid !== null && !message && !readError;

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-lg border border-border bg-surface">
      {/* ---------------------------------------------------------------- */}
      {/* Folder rail                                                       */}
      {/* ---------------------------------------------------------------- */}
      <nav className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface-2 lg:flex">
        <div className="p-3">
          <button
            type="button"
            onClick={startCompose}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-accent-ink"
          >
            <PenSquare className="h-4 w-4" /> Compose
          </button>
        </div>
        <div className="px-2 pb-2">
          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-faint">Folders</p>
          <ul className="space-y-0.5">
            {FOLDERS.map(({ id, label, icon: Icon }) => {
              const active = folder === id;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => setFolder(id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150",
                      active
                        ? "bg-accent-soft font-semibold text-accent-ink"
                        : "font-medium text-text-muted hover:bg-surface hover:text-text",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{label}</span>
                    {active && !loading && (
                      <span className="ml-auto font-mono tabular text-[11px] text-accent-ink/70">{total}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="mt-auto border-t border-border px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Account</p>
          <p className="mt-1 truncate font-mono tabular text-[11px] text-text-muted" title={address}>{address}</p>
        </div>
      </nav>

      {/* ---------------------------------------------------------------- */}
      {/* Message list pane                                                 */}
      {/* ---------------------------------------------------------------- */}
      <div
        className={cn(
          "min-h-0 w-full flex-col border-r border-border md:w-[21rem] md:shrink-0 lg:w-[24rem]",
          openUid !== null ? "hidden md:flex" : "flex",
        )}
      >
        <header className="sticky top-0 z-10 shrink-0 border-b border-border bg-surface px-3 py-2.5">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-sm font-semibold text-text">{activeLabel}</h2>
            <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono tabular text-[11px] text-text-faint">
              {loading ? "—" : total}
            </span>
            <button
              type="button"
              onClick={() => load(folder)}
              disabled={loading}
              title="Refresh"
              aria-label="Refresh"
              className="ml-auto rounded-md p-1.5 text-text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-text disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={startCompose}
              title="Compose"
              aria-label="Compose"
              className="rounded-md p-1.5 text-text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-text lg:hidden"
            >
              <PenSquare className="h-4 w-4" />
            </button>
          </div>

          {/* Segmented folder control — replaces the rail below lg */}
          <div className="mt-2.5 inline-flex rounded-md border border-border bg-surface-2 p-0.5 lg:hidden">
            {FOLDERS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setFolder(id)}
                aria-pressed={folder === id}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                  folder === id ? "bg-surface text-accent-ink shadow-sm" : "text-text-muted hover:text-text",
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <ListSkeleton />
          ) : listError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Couldn’t load this folder"
              hint={listError}
              action={
                <button
                  type="button"
                  onClick={() => load(folder)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text transition-colors duration-150 hover:bg-surface-2"
                >
                  <RefreshCw className="h-4 w-4" /> Try again
                </button>
              }
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={folder === "INBOX" ? Inbox : SendIcon}
              title={folder === "INBOX" ? "Inbox is empty" : "Nothing sent yet"}
              hint={
                folder === "INBOX"
                  ? "New mail for this address will show up here. Refresh to check again."
                  : "Messages you send from this mailbox will be listed here."
              }
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {items.map((m) => {
                const selected = openUid === m.uid;
                const { name } = parseAddress(m.from);
                return (
                  <li key={m.uid}>
                    <button
                      type="button"
                      onClick={() => open(m.uid)}
                      aria-current={selected ? "true" : undefined}
                      className={cn(
                        "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors duration-150",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                        selected ? "bg-accent-soft" : "hover:bg-surface-2",
                      )}
                    >
                      {/* fixed-width unread gutter — no shift when state flips */}
                      <span
                        aria-hidden
                        className={cn(
                          "mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full",
                          m.seen ? "bg-transparent" : "bg-accent",
                        )}
                      />
                      <Avatar from={m.from} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span
                            className={cn(
                              "truncate text-sm",
                              m.seen ? "text-text-muted" : "font-semibold text-text",
                            )}
                          >
                            {name || "(unknown sender)"}
                          </span>
                          <span className="ml-auto shrink-0 font-mono tabular text-[11px] text-text-faint">
                            {listDate(m.date)}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          {m.hasAttachments && (
                            <Paperclip className="h-3.5 w-3.5 shrink-0 text-text-faint" aria-label="Has attachments" />
                          )}
                          <span
                            className={cn(
                              "truncate text-[13px]",
                              m.seen ? "text-text-muted" : "font-medium text-text",
                            )}
                          >
                            {m.subject || "(no subject)"}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] leading-4 text-text-faint">
                          {m.preview}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="shrink-0 border-t border-border bg-surface-2 px-3 py-1.5">
          <p className="font-mono tabular text-[11px] text-text-faint">
            {loading ? "Loading…" : `${total} message${total === 1 ? "" : "s"} · ${activeLabel}`}
          </p>
        </footer>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Reading pane                                                      */}
      {/* ---------------------------------------------------------------- */}
      <section
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col bg-surface",
          openUid !== null ? "flex" : "hidden md:flex",
        )}
      >
        {openUid === null ? (
          <EmptyState
            icon={MailOpen}
            title="No message open"
            hint="Pick a message from the list to read it here. Attachments and replies live in this pane."
          />
        ) : readError ? (
          <EmptyState
            icon={AlertTriangle}
            title="Couldn’t open this message"
            hint={readError}
            action={
              <button
                type="button"
                onClick={() => open(openUid)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text transition-colors duration-150 hover:bg-surface-2"
              >
                <RefreshCw className="h-4 w-4" /> Try again
              </button>
            }
          />
        ) : readerLoading || !message ? (
          <ReaderSkeleton />
        ) : (
          <>
            <header className="shrink-0 border-b border-border px-5 py-4">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => { setOpenUid(null); setMessage(null); }}
                  aria-label="Back to list"
                  className="-ml-1.5 mt-0.5 rounded-md p-1.5 text-text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-text md:hidden"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <h1 className="min-w-0 flex-1 font-display text-lg font-semibold leading-snug text-text">
                  {message.subject || "(no subject)"}
                </h1>
              </div>

              <div className="mt-3 flex items-start gap-3">
                <Avatar from={message.from} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">
                    {parseAddress(message.from).name || "(unknown sender)"}
                  </p>
                  <p className="truncate font-mono tabular text-[11px] text-text-muted">
                    {parseAddress(message.from).email}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-text-faint">
                    to <span className="font-mono tabular">{message.to}</span>
                  </p>
                </div>
                <p className="shrink-0 font-mono tabular text-[11px] text-text-faint">{fullDate(message.date)}</p>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={startReply}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text transition-colors duration-150 hover:bg-surface-2"
                >
                  <CornerUpLeft className="h-4 w-4" /> Reply
                </button>
                <button
                  type="button"
                  onClick={() => open(openUid)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text"
                >
                  <RefreshCw className="h-4 w-4" /> Reload
                </button>
              </div>

              {message.attachments.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-faint">
                    {message.attachments.length} attachment{message.attachments.length === 1 ? "" : "s"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {message.attachments.map((a) => (
                      <a
                        key={a.partId}
                        href={`/api/mail/messages/${openUid}/attachment?folder=${folder}&part=${encodeURIComponent(a.partId)}`}
                        className="group inline-flex max-w-[16rem] items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 transition-colors duration-150 hover:border-accent hover:bg-accent-soft"
                      >
                        <Paperclip className="h-4 w-4 shrink-0 text-text-faint transition-colors duration-150 group-hover:text-accent-ink" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-text">{a.filename}</span>
                          <span className="block font-mono tabular text-[10px] text-text-faint">{formatBytes(a.size)}</span>
                        </span>
                        <Download className="h-4 w-4 shrink-0 text-text-faint transition-colors duration-150 group-hover:text-accent-ink" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2">
              {message.html ? (
                /* Received HTML rendered in a script-less, origin-less sandbox — never runs in our origin. */
                <iframe
                  title="Message body"
                  sandbox=""
                  srcDoc={message.html}
                  className="h-full min-h-[24rem] w-full border-0 bg-white"
                />
              ) : (
                <pre className="whitespace-pre-wrap break-words px-5 py-4 font-sans text-sm leading-relaxed text-text">
                  {message.text ?? "(no content)"}
                </pre>
              )}
            </div>
          </>
        )}
      </section>

      {composing && (
        <ComposeDrawer
          draft={composing}
          address={address}
          sending={sending}
          isReply={isReply}
          onChange={setComposing}
          onClose={() => setComposing(null)}
          onSend={send}
        />
      )}
    </div>
  );
}
