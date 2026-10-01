"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Globe, Loader2, Search, User } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";
import { DomainStatusPill } from "@/components/domains/DomainBits";
import type { ClientDomainRow } from "@/lib/domains/types";

function Shell({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
        <div className="border-b border-border-subtle p-5">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
        </div>
        {children}
        <div className="flex items-center justify-end gap-2 border-t border-border-subtle p-4">{footer}</div>
      </div>
    </div>
  );
}

async function linkDomain(domainId: string, leadId: string): Promise<{ ok: boolean; error?: string; domain?: ClientDomainRow }> {
  const res = await fetch(`/api/domains/${domainId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId }),
  });
  const j = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, domain: j.domain } : { ok: false, error: j.error ?? "Could not link" };
}

/** From a lead: pick one of OUR domains that no lead uses yet. */
export function PickDomainDialog({
  leadId,
  leadName,
  onClose,
  onLinked,
}: {
  leadId: string;
  leadName: string;
  onClose: () => void;
  onLinked: (row: ClientDomainRow) => void;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<ClientDomainRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ClientDomainRow | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/domains");
      const j = await res.json().catch(() => ({}));
      const all = (j.domains ?? []) as ClientDomainRow[];
      setRows(all.filter((d) => !d.lead_id && (d.status === "unassigned" || d.status === "connected")));
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((d) => !q || d.domain.includes(q));
  }, [rows, query]);

  async function link() {
    if (!picked) return;
    setSaving(true);
    const r = await linkDomain(picked.id, leadId);
    setSaving(false);
    if (!r.ok || !r.domain) {
      toast({ kind: "error", title: "Not linked", body: r.error });
      return;
    }
    toast({
      kind: "success",
      title: `${picked.domain} linked to ${leadName}`,
      body: picked.status === "connected" ? "It was set up by hand already — nothing to change." : "Setting it up now — DNS, hosting, SSL, then the site goes live on it.",
    });
    onLinked(r.domain);
    onClose();
  }

  return (
    <Shell
      title={`Use a domain we own for ${leadName}`}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50">Cancel</button>
          <button type="button" onClick={link} disabled={!picked || saving} className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />} Link{picked ? ` ${picked.domain}` : ""}
          </button>
        </>
      }
    >
      <div className="border-b border-border-subtle p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input className={cn(inputCls, "pl-8")} placeholder="Search our domains…" aria-label="Search domains" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </div>
      </div>
      <div className="min-h-40 flex-1 overflow-y-auto p-1">
        {rows === null ? (
          <div className="grid place-items-center p-8 text-text-faint"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-text-faint">No free domains — import from Cloudflare on the Domains page, or buy one.</p>
        ) : (
          <ul>
            {filtered.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => setPicked(d)} className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm", picked?.id === d.id ? "bg-accent-soft text-accent-ink" : "text-text hover:bg-surface-2")}>
                  <Globe className="h-4 w-4 shrink-0 text-text-faint" />
                  <span className="flex-1 truncate">{d.domain}</span>
                  <DomainStatusPill status={d.status} />
                  {picked?.id === d.id ? <Check className="h-4 w-4 text-accent-ink" /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}

type LeadLite = { id: string; business_name: string; status: string };

/** From the Domains page: pick the lead a domain is for. */
export function PickLeadDialog({
  domain,
  onClose,
  onLinked,
}: {
  domain: ClientDomainRow;
  onClose: () => void;
  onLinked: (row: ClientDomainRow) => void;
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
        setLeads(((j.leads ?? []) as LeadLite[]).map((l) => ({ id: l.id, business_name: l.business_name, status: l.status })));
      } catch {
        setLeads([]);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = leads ?? [];
    return (q ? all.filter((l) => l.business_name.toLowerCase().includes(q)) : all).slice(0, 30);
  }, [leads, query]);

  async function link() {
    if (!picked) return;
    setSaving(true);
    const r = await linkDomain(domain.id, picked.id);
    setSaving(false);
    if (!r.ok || !r.domain) {
      toast({ kind: "error", title: "Not linked", body: r.error });
      return;
    }
    toast({
      kind: "success",
      title: `${domain.domain} linked to ${picked.business_name}`,
      body: domain.status === "connected" ? "It was set up by hand already — nothing to change." : "Setting it up now.",
    });
    onLinked(r.domain);
    onClose();
  }

  return (
    <Shell
      title={`Which lead is ${domain.domain} for?`}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-md border border-border px-3 py-2 text-sm text-text-muted hover:text-text disabled:opacity-50">Cancel</button>
          <button type="button" onClick={link} disabled={!picked || saving} className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <User className="h-4 w-4" />} Link{picked ? ` to ${picked.business_name}` : ""}
          </button>
        </>
      }
    >
      <div className="border-b border-border-subtle p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input className={cn(inputCls, "pl-8")} placeholder="Search leads…" aria-label="Search leads" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </div>
      </div>
      <div className="min-h-40 flex-1 overflow-y-auto p-1">
        {leads === null ? (
          <div className="grid place-items-center p-8 text-text-faint"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-text-faint">No matching leads.</p>
        ) : (
          <ul>
            {filtered.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => setPicked(l)} className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm", picked?.id === l.id ? "bg-accent-soft text-accent-ink" : "text-text hover:bg-surface-2")}>
                  <User className="h-4 w-4 shrink-0 text-text-faint" />
                  <span className="flex-1 truncate">{l.business_name}</span>
                  <span className="text-xs text-text-faint">{l.status}</span>
                  {picked?.id === l.id ? <Check className="h-4 w-4 text-accent-ink" /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}
