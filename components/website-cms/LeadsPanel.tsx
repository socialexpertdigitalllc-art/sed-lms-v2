"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail, Phone, Trash2, ShieldAlert, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/common/Panel";
import { Field, inputCls } from "@/components/forms/Field";
import { Select } from "@/components/common/Select";
import { btnPrimary, btnSecondary, btnGhostSm } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";
import { WEBSITE_LEAD_STATUSES, type WebsiteLeadRow, type WebsiteLeadStatus } from "@/lib/website-cms/types";
import { Dialog } from "./shared";

const STATUS_LABEL: Record<WebsiteLeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
};

const STATUS_TONE: Record<WebsiteLeadStatus, string> = {
  new: "bg-accent-soft text-accent-ink",
  contacted: "bg-surface-2 text-text",
  qualified: "bg-surface-2 text-text",
  won: "bg-accent text-white",
  lost: "bg-surface-2 text-text-faint",
};

const FILTERS = [
  { key: "all", label: "All" },
  ...WEBSITE_LEAD_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s] })),
  { key: "spam", label: "Spam" },
];

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function sourceLabel(row: WebsiteLeadRow) {
  const parts = [row.source_page?.split("?")[0], row.utm_source ? `utm: ${row.utm_source}` : null].filter(Boolean);
  return parts.join(" · ") || "—";
}

export function LeadsPanel({
  rows,
  filter,
  counts,
  canManage,
}: {
  rows: WebsiteLeadRow[];
  filter: string;
  counts: Record<string, number>;
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState<WebsiteLeadRow | null>(null);
  const [status, setStatus] = useState<WebsiteLeadStatus>("new");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  function show(row: WebsiteLeadRow) {
    setOpen(row);
    setStatus(row.status);
    setNotes(row.notes);
  }

  async function patch(body: Record<string, unknown>, title: string) {
    if (!open) return;
    setBusy(true);
    const res = await fetch(`/api/website/leads/${open.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) {
      toast({ kind: "success", title });
      setOpen(null);
      router.refresh();
    } else {
      toast({ kind: "error", title: json.error ?? "Update failed" });
    }
  }

  async function remove() {
    if (!open || !window.confirm(`Delete the lead from ${open.name}? This can't be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/website/leads/${open.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      toast({ kind: "success", title: "Lead deleted" });
      setOpen(null);
      router.refresh();
    } else {
      toast({ kind: "error", title: "Delete failed" });
    }
  }

  return (
    <Panel
      flush
      title="Website leads"
      count={rows.length}
      description="Every quote request from socialexpertdigitalllc.com — the agency's own inbound leads, with the page, plan, coupon and campaign they came from."
    >
      <nav className="flex gap-1 overflow-x-auto border-b border-border-subtle px-3 py-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/website/leads" : `/website/leads?status=${f.key}`}
            className={cn(
              "whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium",
              filter === f.key ? "bg-accent-soft text-accent-ink" : "text-text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            {f.label}
            {typeof counts[f.key] === "number" && <span className="ml-1 text-text-faint">{counts[f.key]}</span>}
          </Link>
        ))}
      </nav>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
            <th className="px-4 py-2 font-medium">Received</th>
            <th className="px-4 py-2 font-medium">Lead</th>
            <th className="px-4 py-2 font-medium">Interested in</th>
            <th className="px-4 py-2 font-medium">Coupon</th>
            <th className="px-4 py-2 font-medium">Source</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => show(row)}
              className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-surface-2/50"
            >
              <td className="whitespace-nowrap px-4 py-2.5 text-xs text-text-muted">{when(row.created_at)}</td>
              <td className="px-4 py-2.5">
                <div className="font-medium text-text">{row.name}</div>
                <div className="text-xs text-text-muted">{row.email}</div>
              </td>
              <td className="px-4 py-2.5 text-text-muted">
                {row.service_slug ?? "Not sure yet"}
                {row.tier_name && <span className="block text-xs text-text-faint">plan: {row.tier_name}</span>}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs">
                {row.coupon ? (
                  <span className={row.coupon_valid ? "text-accent-ink" : "text-text-faint line-through"}>{row.coupon}</span>
                ) : (
                  <span className="text-text-faint">—</span>
                )}
              </td>
              <td className="max-w-[14rem] truncate px-4 py-2.5 text-xs text-text-muted">{sourceLabel(row)}</td>
              <td className="px-4 py-2.5">
                {row.is_spam ? (
                  <span className="rounded px-1.5 py-0.5 text-xs text-text-faint">spam · {row.spam_reason}</span>
                ) : (
                  <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", STATUS_TONE[row.status])}>
                    {STATUS_LABEL[row.status]}
                  </span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-sm text-text-muted">
                No leads here yet. Quote requests from the website show up the moment they&apos;re sent.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {open && (
        <Dialog title={`Lead — ${open.name}`} onClose={() => setOpen(null)} wide>
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <a href={`mailto:${open.email}`} className={btnSecondary}>
                <Mail className="h-4 w-4" /> {open.email}
              </a>
              {open.phone && (
                <a href={`tel:${open.phone}`} className={btnSecondary}>
                  <Phone className="h-4 w-4" /> {open.phone}
                </a>
              )}
            </div>

            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {[
                ["Received", new Date(open.submitted_at).toLocaleString()],
                ["Service", open.service_slug ?? "Not sure yet"],
                ["Plan", open.tier_name ?? "—"],
                ["Coupon", open.coupon ? `${open.coupon} (${open.coupon_valid ? "valid" : "not valid"})` : "—"],
                ["Page", open.source_page ?? "—"],
                ["Referrer", open.referrer ?? "—"],
                [
                  "Campaign",
                  [open.utm_source, open.utm_medium, open.utm_campaign, open.utm_term, open.utm_content]
                    .filter(Boolean)
                    .join(" / ") || "—",
                ],
                ["First worked", open.contacted_at ? new Date(open.contacted_at).toLocaleString() : "—"],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-text-muted">{k}</dt>
                  <dd className="truncate text-text" title={v}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>

            <div>
              <div className="text-xs text-text-muted">Message</div>
              <p className="mt-1 whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-2/40 p-3 text-text">
                {open.message || "—"}
              </p>
            </div>

            {canManage && (
              <>
                <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
                  <Field label="Status">
                    <Select
                      className={inputCls}
                      value={status}
                      onChange={(e) => setStatus(e.target.value as WebsiteLeadStatus)}
                    >
                      {WEBSITE_LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Notes">
                    <textarea className={inputCls} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-4">
                  <div className="flex gap-1">
                    {open.is_spam ? (
                      <button
                        type="button"
                        className={btnGhostSm}
                        disabled={busy}
                        onClick={() => patch({ is_spam: false }, "Moved to inbox")}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" /> Not spam
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={btnGhostSm}
                        disabled={busy}
                        onClick={() => patch({ is_spam: true }, "Marked as spam")}
                      >
                        <ShieldAlert className="h-3.5 w-3.5" /> Spam
                      </button>
                    )}
                    <button type="button" className={btnGhostSm} disabled={busy} onClick={remove}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" className={btnSecondary} onClick={() => setOpen(null)}>
                      Close
                    </button>
                    <button
                      type="button"
                      className={btnPrimary}
                      disabled={busy}
                      onClick={() => patch({ status, notes }, "Lead updated")}
                    >
                      {busy ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
