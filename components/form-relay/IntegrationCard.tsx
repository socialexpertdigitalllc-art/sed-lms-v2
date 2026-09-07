"use client";

import { useState } from "react";
import { Code2, Copy, Check, Send } from "lucide-react";
import { Panel } from "@/components/common/Panel";
import { btnSecondarySm, btnGhostSm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { htmlSnippet, jsSnippet } from "@/lib/forms/snippet";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={btnGhostSm}
      onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {done ? "Copied" : label}
    </button>
  );
}

export function IntegrationCard({ endpointId, url, accessKey, canManage }: { endpointId: string; url: string; accessKey: string; canManage: boolean }) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"js" | "html">("js");
  const [sending, setSending] = useState(false);
  const code = tab === "js" ? jsSnippet({ url, accessKey }) : htmlSnippet({ url, accessKey });

  async function sendTest() {
    setSending(true);
    const res = await fetch(`/api/forms/endpoints/${endpointId}/test`, { method: "POST" });
    setSending(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ kind: "error", title: "Test failed", body: body.error }); return; }
    if (body.result?.status === "sent") toast({ kind: "success", title: "Test email sent", body: "Check the recipient inbox and the Submissions tab." });
    else toast({ kind: "error", title: "Stored but not delivered", body: body.result?.error ?? "See the submission for details." });
  }

  return (
    <Panel
      icon={Code2}
      title="Integration"
      description="Paste one of these into the client site. Only the URL and key differ from web3forms."
      action={canManage ? (
        <button type="button" className={btnSecondarySm} disabled={sending} onClick={sendTest}>
          <Send className="h-3.5 w-3.5" /> {sending ? "Sending…" : "Send test"}
        </button>
      ) : null}
    >
      <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
        <dt className="text-text-muted">Submit URL</dt><dd className="truncate font-mono text-xs text-text">{url}</dd><dd><CopyButton text={url} label="Copy" /></dd>
        <dt className="text-text-muted">Access key</dt><dd className="truncate font-mono text-xs text-text">{accessKey}</dd><dd><CopyButton text={accessKey} label="Copy" /></dd>
      </dl>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex gap-1">
          <button type="button" className={btnGhostSm + (tab === "js" ? " bg-surface-2 text-text" : "")} onClick={() => setTab("js")}>JavaScript (fetch)</button>
          <button type="button" className={btnGhostSm + (tab === "html" ? " bg-surface-2 text-text" : "")} onClick={() => setTab("html")}>Plain HTML form</button>
        </div>
        <CopyButton text={code} label="Copy snippet" />
      </div>
      <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-text">{code}</pre>
    </Panel>
  );
}
