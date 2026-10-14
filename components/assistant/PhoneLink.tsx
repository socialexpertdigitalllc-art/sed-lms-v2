"use client";

import { useEffect, useState } from "react";
import { Check, Clock, Copy, ExternalLink, Loader2, MessageCircle, Send, Unlink, X } from "lucide-react";
import { btnGhostSm, btnSecondarySm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import {
  CHANNEL_LABEL,
  CHANNELS,
  LINK_CODE_TTL_MS,
  type Channel,
  type ChannelLinkView,
  type ChannelsResponse,
  type LinkCodeResponse,
} from "@/lib/assistant/channels/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { JSON_HEADERS } from "./useAssistantChat";

/**
 * The phones that can talk to the person's SED AI — Telegram chats and
 * WhatsApp numbers — and linking another: a one-time code to send from the
 * chat. While a code is showing, the list is checked every few seconds so it
 * flips to "Linked" the moment the message arrives.
 */

const POLL_MS = 3_000;

interface Pending extends LinkCodeResponse {
  /** Client-clock deadline (from the server's own expiry, so a skewed clock does not matter). */
  deadline: number;
  /** When the server issued it, on the server's clock — links made since count. */
  issuedAt: number;
}

const ICON: Record<Channel, typeof Send> = { telegram: Send, whatsapp: MessageCircle };

const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

function ago(iso: string | null, now: number): string {
  if (!iso) return "no messages yet";
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (min < 1) return "last message just now";
  if (min < 60) return `last message ${min} min ago`;
  if (min < 24 * 60) return `last message ${Math.floor(min / 60)} h ago`;
  return `last message ${day(iso)}`;
}

/** The person's links and which channels this server has. Throws the server's own words. */
async function fetchChannels(): Promise<ChannelsResponse> {
  const res = await fetch("/api/assistant/channels", { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as Partial<ChannelsResponse> & { error?: string };
  if (!res.ok || !body.links || !body.configured) throw new Error(body.error ?? `HTTP ${res.status}`);
  return { links: body.links, configured: body.configured };
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function PhoneLink() {
  const { toast } = useToast();
  const [data, setData] = useState<ChannelsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<Channel | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [justLinked, setJustLinked] = useState<ChannelLinkView | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<ChannelLinkView | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    fetchChannels()
      .then((next) => {
        if (!alive) return;
        setData(next);
        setLoadError(null);
      })
      .catch((e: Error) => {
        if (alive) setLoadError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const expired = pending ? now >= pending.deadline : false;

  // While a code is showing: tick the countdown, and look for the new link.
  useEffect(() => {
    if (!pending || expired) return;
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    let alive = true;
    const poll = setInterval(() => {
      fetchChannels()
        .then((next) => {
          if (!alive) return;
          setData(next);
          const hit = next.links.find((l) => l.channel === pending.channel && Date.parse(l.linkedAt) >= pending.issuedAt - 1_000);
          if (!hit) return;
          setPending(null);
          setJustLinked(hit);
          toast({ kind: "success", title: `${CHANNEL_LABEL[hit.channel]} linked`, body: `${hit.label ?? "That chat"} can now talk to your SED AI.` });
        })
        .catch(() => {
          // A missed poll is retried on the next tick.
        });
    }, POLL_MS);
    return () => {
      alive = false;
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [pending, expired, toast]);

  async function requestCode(channel: Channel) {
    setRequesting(channel);
    setLinkError(null);
    setJustLinked(null);
    setCopied(false);
    try {
      const res = await fetch("/api/assistant/channels", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ channel }) });
      const body = (await res.json().catch(() => ({}))) as Partial<LinkCodeResponse> & { error?: string };
      if (!res.ok || !body.code || !body.expiresAt) throw new Error(body.error ?? `HTTP ${res.status}`);
      const expiresAt = Date.parse(body.expiresAt);
      const serverNow = Date.parse(res.headers.get("date") ?? "") || expiresAt - LINK_CODE_TTL_MS;
      const left = Math.min(Math.max(expiresAt - serverNow, 0), LINK_CODE_TTL_MS);
      setNow(Date.now());
      setPending({ ...(body as LinkCodeResponse), deadline: Date.now() + left, issuedAt: expiresAt - LINK_CODE_TTL_MS });
    } catch (e) {
      setLinkError((e as Error).message);
    } finally {
      setRequesting(null);
    }
  }

  async function copyCommand() {
    if (!pending) return;
    try {
      await navigator.clipboard.writeText(pending.command);
      setCopied(true);
    } catch {
      toast({ kind: "error", title: "Could not copy", body: `Type it instead: ${pending.command}` });
    }
  }

  async function unlink(link: ChannelLinkView) {
    setConfirmUnlink(null);
    setUnlinking(link.id);
    try {
      const res = await fetch(`/api/assistant/channels/${link.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData((d) => (d ? { ...d, links: d.links.filter((l) => l.id !== link.id) } : d));
      if (justLinked?.id === link.id) setJustLinked(null);
      toast({ kind: "success", title: "Unlinked", body: `${link.label ?? CHANNEL_LABEL[link.channel]} no longer reaches your SED AI.` });
    } catch (e) {
      toast({ kind: "error", title: "Could not unlink", body: (e as Error).message });
    } finally {
      setUnlinking(null);
    }
  }

  if (!data) {
    return loadError ? (
      <p className="text-sm text-dropped-fg">{loadError}</p>
    ) : (
      <p className="flex items-center gap-2 py-2 text-sm text-text-faint">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
      </p>
    );
  }

  const anyConfigured = CHANNELS.some((c) => data.configured[c]);

  return (
    <div className="space-y-3">
      {data.links.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {data.links.map((l) => {
            const Icon = ICON[l.channel];
            return (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text">
                    {l.label ?? CHANNEL_LABEL[l.channel]} <span className="font-normal text-text-faint">· {CHANNEL_LABEL[l.channel]}</span>
                  </span>
                  <span className="block text-xs text-text-muted">
                    Linked {day(l.linkedAt)} · {ago(l.lastSeenAt, now)}
                  </span>
                </span>
                <button type="button" className={btnGhostSm} disabled={unlinking === l.id} onClick={() => setConfirmUnlink(l)}>
                  {unlinking === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Unlink className="h-3.5 w-3.5" aria-hidden />} Unlink
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">No phone is linked yet.</p>
      )}

      {justLinked ? (
        <p className="flex items-center gap-1.5 rounded-lg bg-ready-bg/50 px-3 py-2 text-sm text-ready-fg" role="status">
          <Check className="h-4 w-4 shrink-0" aria-hidden /> Linked {justLinked.label ?? CHANNEL_LABEL[justLinked.channel]}. Send it a message to try it.
        </p>
      ) : null}

      {pending ? (
        <div className="space-y-2.5 rounded-xl border border-accent/40 bg-surface px-3.5 py-3 text-sm">
          {expired ? (
            <p className="text-text-muted" role="status">
              This code has expired.{" "}
              <button type="button" className="font-medium text-accent-ink hover:underline" onClick={() => void requestCode(pending.channel)}>
                Get a new code
              </button>
            </p>
          ) : (
            <>
              <p className="text-text">
                Send this message to <span className="font-medium">{pending.to}</span> on {CHANNEL_LABEL[pending.channel]}:
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md border border-border bg-surface-2 px-2.5 py-1 font-mono text-base tracking-wide text-text">{pending.command}</code>
                <button type="button" className={btnSecondarySm} onClick={() => void copyCommand()}>
                  {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} {copied ? "Copied" : "Copy"}
                </button>
                {pending.url ? (
                  <a href={pending.url} target="_blank" rel="noopener noreferrer" className={btnSecondarySm}>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open {CHANNEL_LABEL[pending.channel]}
                  </a>
                ) : null}
              </div>
              {pending.channel === "telegram" && pending.url ? (
                <p className="text-xs text-text-faint">Or open Telegram from here and press Start — that sends the code for you.</p>
              ) : null}
              <p className="flex items-center gap-1.5 text-xs text-text-muted">
                <Clock className="h-3.5 w-3.5" aria-hidden /> Expires in {clock(pending.deadline - now)}
                <span className="text-text-faint">·</span>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Waiting for your message…
              </p>
            </>
          )}
          <div className="flex justify-end">
            <button type="button" className={btnGhostSm} onClick={() => setPending(null)}>
              <X className="h-3.5 w-3.5" aria-hidden /> {expired ? "Close" : "Cancel"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {CHANNELS.map((c) => {
          const Icon = ICON[c];
          return (
            <button
              key={c}
              type="button"
              className={cn(btnSecondarySm, !data.configured[c] && "opacity-55")}
              disabled={requesting !== null || !data.configured[c]}
              title={data.configured[c] ? undefined : `${CHANNEL_LABEL[c]} is not set up on this server yet`}
              onClick={() => void requestCode(c)}
            >
              {requesting === c ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Icon className="h-3.5 w-3.5" aria-hidden />} Link {CHANNEL_LABEL[c]}
            </button>
          );
        })}
      </div>
      {!anyConfigured ? (
        <p className="text-xs text-text-faint">Telegram and WhatsApp are not set up on this server yet — an admin can turn them on.</p>
      ) : CHANNELS.some((c) => !data.configured[c]) ? (
        <p className="text-xs text-text-faint">
          {CHANNELS.filter((c) => !data.configured[c])
            .map((c) => CHANNEL_LABEL[c])
            .join(" and ")}{" "}
          is not set up on this server yet.
        </p>
      ) : null}
      {linkError ? <p className="text-xs text-dropped-fg">{linkError}</p> : null}

      {confirmUnlink ? (
        <ConfirmDialog
          title={`Unlink ${confirmUnlink.label ?? CHANNEL_LABEL[confirmUnlink.channel]}?`}
          body={`Messages from this ${CHANNEL_LABEL[confirmUnlink.channel]} chat will stop reaching your SED AI. You can link it again any time.`}
          confirmLabel="Unlink"
          onConfirm={() => void unlink(confirmUnlink)}
          onCancel={() => setConfirmUnlink(null)}
        />
      ) : null}
    </div>
  );
}
