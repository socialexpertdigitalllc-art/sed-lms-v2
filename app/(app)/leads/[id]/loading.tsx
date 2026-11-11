"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLiveLeads } from "@/hooks/useLiveLeads";
import { StatusPill } from "@/components/leads/StatusPill";
import { Skeleton } from "@/components/common/Skeleton";
import { formatCurrency, formatDateTime } from "@/lib/leads/format";
import type { Lead } from "@/lib/leads/types";

/**
 * Shown the instant a lead is clicked, while the full page is still on its way
 * from the server: the lead's REAL details, read from the browser's live copy
 * of the leads (hooks/useLiveLeads.ts) — not a grey placeholder. The full page
 * (history, tickets, contracts, actions) replaces it as soon as it arrives.
 * Laid out like the top of LeadDetail so nothing jumps when it does.
 */
export default function LeadLoading() {
  const params = useParams<{ id: string }>();
  const { leads } = useLiveLeads();
  const lead = leads.find((l) => l.id === params?.id) ?? null;
  return <LeadPreview lead={lead} />;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="py-2 border-b border-border-subtle last:border-0">
      <div className="text-[11px] uppercase tracking-wide text-text-faint">{label}</div>
      <div className="mt-0.5 text-sm text-text break-words">{value && String(value).trim() ? value : "—"}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-2 text-sm font-semibold text-text">{title}</div>
      {children}
    </div>
  );
}

export function LeadPreview({ lead }: { lead: Lead | null }) {
  return (
    <div className="mx-auto max-w-6xl" aria-busy="true" data-testid="lead-preview">
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="bg-grid absolute inset-0 opacity-60" />
        <div className="relative p-6">
          <Link href="/leads" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text">
            <ArrowLeft size={13} /> Leads
          </Link>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-ink">Lead</p>
          {lead ? (
            <>
              <h1 className="font-display text-2xl font-semibold leading-tight text-text">{lead.business_name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StatusPill status={lead.status} />
                <span className="font-mono text-xs text-text-faint">#{lead.id.slice(0, 8)}</span>
              </div>
            </>
          ) : (
            <>
              <Skeleton className="h-7 w-64" />
              <Skeleton className="h-5 w-40 mt-2" />
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Business info">
          {lead ? (
            <>
              <Field label="Owner" value={lead.owner_name} />
              <Field label="Phone" value={lead.business_phone} />
              <Field label="Email" value={lead.business_email} />
              <Field label="Website" value={lead.website_link} />
            </>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </Card>
        <Card title="Lead info">
          {lead ? (
            <>
              <Field label="Price quoted" value={lead.price_quoted == null ? null : formatCurrency(lead.price_quoted)} />
              <Field label="Follow-up" value={lead.follow_up_time ? formatDateTime(lead.follow_up_time) : null} />
              <Field label="Site type" value={lead.site_type} />
              <Field label="Rating" value={lead.rating == null ? null : `${lead.rating}/10`} />
            </>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </Card>
        <div className="lg:col-span-2">
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
