"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Link2, Loader2, Search, User } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";

type LeadLite = { id: string; business_name: string; status: string; website_link: string | null };

/**
 * Attach a deployed site to a lead — sets the lead's website_link and
 * notifies the lead's agent. Works for tracked rows (deploymentId) and
 * untracked hosting subdomains (subdomain), which get adopted server-side.
 */
export function LinkLeadModal({
  deploymentId,
  subdomain,
  siteUrl,
  optional,
  onClose,
  onDone,
}: {
  deploymentId: string | null;
  subdomain: string | null;
  siteUrl: string;
  /** true = post-upload prompt, shows a "Skip" affordance */
  optional?: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [leads, setLeads] = useState<LeadLite[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<LeadLite | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/leads");
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? "Could not load leads");
        setLeads(
          ((j.leads ?? []) as LeadLite[]).map((l) => ({
            id: l.id,
            business_name: l.business_name,
            status: l.status,
            website_link: l.website_link,
          })),
        );
      } catch (e) {
        toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load leads" });
        setLeads([]);
      }
    })();
  }, [toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = leads ?? [];
    const hits = q ? all.filter((l) => l.business_name.toLowerCase().includes(q)) : all;
    return hits.slice(0, 30);
  }, [leads, query]);

  async function link() {
    if (!picked) return;
    setSaving(true);
    try {
      const res = await fetch("/api/site-studio/deployments/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: picked.id, deploymentId, subdomain }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ kind: "error", title: "Link failed", body: j.error ?? "Try again" });
        return;
      }
      toast({ kind: "success", title: `Linked to ${picked.business_name}`, body: "The lead's website link was updated." });
      onDone();
      onClose();
    } catch {
      toast({ kind: "error", title: "Link failed", body: "Network error — try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Link site to a lead">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
        <div className="border-b border-border-subtle p-5">
          <h3 className="text-sm font-semibold text-text">Link {siteUrl.replace(/^https?:\/\//, "")} to a lead</h3>
          <p className="mt-1 text-xs text-text-muted">
            The lead&apos;s website link is set to this site and the lead&apos;s agent is notified.
            {optional ? " You can skip this and link later from the board." : ""}
          </p>
        </div>

        <div className="border-b border-border-subtle p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input className={cn(inputCls, "pl-8")} placeholder="Search leads by business name…" aria-label="Search leads"
              value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </div>
        </div>

        <div className="min-h-40 flex-1 overflow-y-auto p-1">
          {leads === null ? (
            <div className="grid place-items-center p-8 text-sm text-text-faint"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-text-faint">No matching leads.</p>
          ) : (
            <ul>
              {filtered.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => setPicked(l)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                      picked?.id === l.id ? "bg-accent-soft text-accent-ink" : "text-text hover:bg-surface-2")}>
                    <User className="h-4 w-4 shrink-0 text-text-faint" />
                    <span className="flex-1 truncate">{l.business_name}</span>
                    <span className="text-xs text-text-faint">{l.status}</span>
                    {l.website_link ? <span className="text-[10px] text-longterm-fg" title={`Already has a website link: ${l.website_link}`}>has site</span> : null}
                    {picked?.id === l.id ? <Check className="h-4 w-4 text-accent-ink" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle p-4">
          <button type="button" onClick={onClose} disabled={saving}
            className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50">
            {optional ? "Skip for now" : "Cancel"}
          </button>
          <button type="button" onClick={link} disabled={!picked || saving}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            Link{picked ? ` to ${picked.business_name}` : " lead"}
          </button>
        </div>
      </div>
    </div>
  );
}
