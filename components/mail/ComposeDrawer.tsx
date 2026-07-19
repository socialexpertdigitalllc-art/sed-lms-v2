"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Paperclip, Send as SendIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { formatBytes } from "@/components/mail/MailParts";

export type Draft = { to: string; subject: string; body: string };

/** Shape accepted by the existing /api/mail/send schema — base64, no data-URI prefix. */
export type OutgoingAttachment = {
  filename: string;
  contentBase64: string;
  contentType: string;
};

/** Mirrors the server: `attachments` is `.max(10)` in lib/mail/sendSchema.ts. */
const MAX_FILES = 10;
/** Single file cap. Base64 inflates ~33%, and Hostinger SMTP rejects oversized mail. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Combined cap — 20 MB raw is ~27 MB encoded, just inside the SMTP ceiling. */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/** ArrayBuffer → base64 without a data-URI prefix (the server does Buffer.from(x, "base64")). */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Right-side compose drawer. Purely presentational: it owns no network calls —
 * `onSend` is supplied by the Mailbox and hits /api/mail/send exactly as before.
 */
export function ComposeDrawer({
  draft,
  address,
  sending,
  isReply,
  onChange,
  onClose,
  onSend,
}: {
  draft: Draft;
  address: string;
  sending: boolean;
  isReply: boolean;
  onChange: (d: Draft) => void;
  onClose: () => void;
  onSend: (attachments: OutgoingAttachment[]) => void | Promise<void>;
}) {
  const toRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    toRef.current?.focus();
  }, []);

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const busy = sending || reading;

  function reset() {
    setFiles([]);
    setFileError(null);
  }

  function close() {
    reset();
    onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, busy]);

  function pickFiles(picked: FileList | null) {
    if (fileRef.current) fileRef.current.value = "";
    if (!picked || picked.length === 0) return;

    const incoming = Array.from(picked);
    const oversized = incoming.find((f) => f.size > MAX_FILE_BYTES);
    if (oversized) {
      setFileError(
        `“${oversized.name}” is ${formatBytes(oversized.size)} — single attachments must be ${formatBytes(MAX_FILE_BYTES)} or smaller.`,
      );
      return;
    }

    // Skip exact duplicates (same name + size) so re-picking a file doesn’t double it.
    const merged = [...files];
    for (const f of incoming) {
      if (!merged.some((e) => e.name === f.name && e.size === f.size)) merged.push(f);
    }

    if (merged.length > MAX_FILES) {
      setFileError(`You can attach up to ${MAX_FILES} files per message — remove one first.`);
      return;
    }
    const nextTotal = merged.reduce((n, f) => n + f.size, 0);
    if (nextTotal > MAX_TOTAL_BYTES) {
      setFileError(
        `Attachments would total ${formatBytes(nextTotal)} — the combined limit is ${formatBytes(MAX_TOTAL_BYTES)}.`,
      );
      return;
    }

    setFileError(null);
    setFiles(merged);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setFileError(null);
  }

  async function handleSend() {
    if (busy || draft.to.trim().length === 0) return;
    if (files.length > MAX_FILES) {
      setFileError(`You can attach up to ${MAX_FILES} files per message — remove one first.`);
      return;
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      setFileError(
        `Attachments total ${formatBytes(totalBytes)} — the combined limit is ${formatBytes(MAX_TOTAL_BYTES)}. Remove a file to send.`,
      );
      return;
    }

    let attachments: OutgoingAttachment[] = [];
    if (files.length > 0) {
      setReading(true);
      try {
        attachments = await Promise.all(
          files.map(async (f) => ({
            filename: f.name.slice(0, 255),
            contentBase64: toBase64(await f.arrayBuffer()),
            contentType: f.type || "application/octet-stream",
          })),
        );
      } catch {
        setFileError("Could not read one of the attached files. Remove it and try again.");
        return;
      } finally {
        setReading(false);
      }
    }
    setFileError(null);
    await onSend(attachments);
  }

  const canSend = !busy && draft.to.trim().length > 0 && totalBytes <= MAX_TOTAL_BYTES;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-text/25"
        onClick={() => !busy && close()}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={isReply ? "Reply" : "New message"}
        className="relative flex h-full w-full max-w-xl flex-col border-l border-border bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-text">
              {isReply ? "Reply" : "New message"}
            </h2>
            <p className="mt-0.5 truncate text-xs text-text-muted">
              From <span className="font-mono tabular">{address}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label="Close compose"
            className="rounded-md p-1.5 text-text-faint transition-colors duration-150 hover:bg-surface-2 hover:text-text disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <Field label="To" required>
            <input
              ref={toRef}
              className={inputCls}
              value={draft.to}
              onChange={(e) => onChange({ ...draft, to: e.target.value })}
              placeholder="recipient@example.com"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Subject">
            <input
              className={inputCls}
              value={draft.subject}
              onChange={(e) => onChange({ ...draft, subject: e.target.value })}
              placeholder="No subject"
            />
          </Field>
          <Field label="Message" className="flex min-h-0 flex-col">
            <textarea
              className={cn(inputCls, "min-h-[18rem] flex-1 resize-y leading-relaxed")}
              value={draft.body}
              onChange={(e) => onChange({ ...draft, body: e.target.value })}
              placeholder="Write your message…"
            />
          </Field>

          {/* ---------------------------------------------------------- */}
          {/* Attachments                                                 */}
          {/* ---------------------------------------------------------- */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-muted transition-colors duration-150",
                  "focus-within:ring-2 focus-within:ring-accent",
                  busy
                    ? "cursor-not-allowed opacity-50"
                    : "hover:border-accent hover:bg-accent-soft hover:text-accent-ink",
                )}
              >
                {/* sr-only (not hidden) so the input keeps its own focus stop for keyboard users */}
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => pickFiles(e.target.files)}
                />
                <Paperclip className="h-4 w-4" />
                Attach files
              </label>
              <span className="font-mono tabular text-[11px] text-text-faint">
                {files.length > 0
                  ? `${files.length}/${MAX_FILES} · ${formatBytes(totalBytes)} of ${formatBytes(MAX_TOTAL_BYTES)}`
                  : `Up to ${MAX_FILES} files, ${formatBytes(MAX_FILE_BYTES)} each`}
              </span>
            </div>

            {fileError && (
              <p
                role="alert"
                className="mt-2 flex items-start gap-1.5 rounded-md bg-dropped-bg px-2.5 py-1.5 text-[11px] leading-relaxed text-dropped-fg"
              >
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{fileError}</span>
              </p>
            )}

            {files.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${f.size}-${i}`}
                    className="inline-flex max-w-[16rem] items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5"
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-text" title={f.name}>
                        {f.name}
                      </span>
                      <span className="block font-mono tabular text-[10px] text-text-faint">
                        {formatBytes(f.size)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      disabled={busy}
                      aria-label={`Remove ${f.name}`}
                      className="shrink-0 rounded-sm p-0.5 text-text-faint transition-colors duration-150 hover:bg-surface hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded-md border border-border px-3.5 py-2 text-sm font-medium text-text-muted transition-colors duration-150 hover:bg-surface hover:text-text disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendIcon className="h-4 w-4" />}
            {reading ? "Attaching…" : sending ? "Sending…" : "Send"}
          </button>
        </footer>
      </aside>
    </div>
  );
}
