"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Check } from "lucide-react";
import { PAYMENT_CATEGORIES, type PaymentCategory, type PaymentLink } from "@/lib/payments/types";
import { groupLinks } from "@/lib/payments/board";
import { RadioPillGroup } from "@/components/forms/RadioPillGroup";
import { inputCls } from "@/components/forms/Field";
import { PaymentLinkModal } from "./PaymentLinkModal";

const CATEGORY_FILTER_OPTIONS = ["All", ...PAYMENT_CATEGORIES] as const;

type ModalState = "new" | PaymentLink | null;

/** Cents-aware currency formatting (Stripe amounts commonly carry cents) —
 * same Intl.NumberFormat approach as lib/leads/format.ts's formatCurrency,
 * just without rounding to whole dollars. */
function formatAmount(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function PaymentLinksBoard({
  links,
  canManage,
}: {
  links: PaymentLink[];
  canManage: boolean;
}) {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PaymentCategory | "">("");
  const [showArchived, setShowArchived] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const sections = useMemo(
    () => groupLinks(links, { query, category, includeArchived: canManage && showArchived }),
    [links, query, category, canManage, showArchived]
  );
  const totalVisible = sections.reduce((sum, s) => sum + s.links.length, 0);

  async function doCopy(link: PaymentLink) {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((cur) => (cur === link.id ? null : cur)), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  async function toggleActive(l: PaymentLink) {
    setBusyId(l.id);
    setRowError(null);
    const res = await fetch(`/api/payments/links/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !l.is_active }),
    });
    setBusyId(null);
    if (!res.ok) {
      setRowError((await res.json().catch(() => ({}))).error ?? "Failed to update payment link");
      return;
    }
    router.refresh();
  }

  async function remove(l: PaymentLink) {
    if (!confirm(`Delete "${l.label}"? This cannot be undone.`)) return;
    setBusyId(l.id);
    setRowError(null);
    const res = await fetch(`/api/payments/links/${l.id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) {
      setRowError((await res.json().catch(() => ({}))).error ?? "Failed to delete payment link");
      return;
    }
    router.refresh();
  }

  function closeModal() {
    setModal(null);
  }

  const row = (l: PaymentLink) => (
    <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className={"font-semibold text-text truncate" + (!l.is_active ? " opacity-60" : "")}>
            {l.label}
          </span>
          {!l.is_active && (
            <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-surface-2 text-text-faint">
              Archived
            </span>
          )}
        </div>
        {l.notes && <p className="text-xs text-text-muted truncate mt-0.5">{l.notes}</p>}
      </div>

      <div className="font-mono text-lg font-semibold text-text shrink-0 whitespace-nowrap">
        {formatAmount(l.amount)}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => doCopy(l)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-ink whitespace-nowrap min-w-[84px] text-center"
        >
          {copiedId === l.id ? (
            <span className="inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Copied
            </span>
          ) : (
            "Copy"
          )}
        </button>
        <a
          href={l.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${l.label} in a new tab`}
          title="Open in new tab"
          className="grid h-8 w-8 place-items-center rounded text-text-faint hover:bg-surface-2 hover:text-accent-ink"
        >
          <ExternalLink size={14} />
        </a>
        {canManage && (
          <>
            <button
              type="button"
              onClick={() => setModal(l)}
              className="text-xs font-medium text-text-muted px-2 py-1.5 rounded hover:bg-surface-2 hover:text-text whitespace-nowrap"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => toggleActive(l)}
              disabled={busyId === l.id}
              className="text-xs font-medium text-text-muted px-2 py-1.5 rounded hover:bg-surface-2 hover:text-text disabled:opacity-60 whitespace-nowrap"
            >
              {l.is_active ? "Archive" : "Restore"}
            </button>
            <button
              type="button"
              onClick={() => remove(l)}
              disabled={busyId === l.id}
              className="text-xs font-medium text-dropped-fg px-2 py-1.5 rounded hover:bg-dropped-bg disabled:opacity-60 whitespace-nowrap"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Payment Links</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {totalVisible} link{totalVisible === 1 ? "" : "s"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            className={inputCls + " w-56"}
            placeholder="Search label or amount…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <RadioPillGroup
            options={CATEGORY_FILTER_OPTIONS}
            value={category === "" ? "All" : category}
            onChange={(v) => setCategory(v === "All" ? "" : (v as PaymentCategory))}
          />
          {canManage && (
            <>
              <label className="flex items-center gap-1.5 text-sm text-text-muted whitespace-nowrap">
                <input
                  type="checkbox"
                  className="accent-accent w-4 h-4"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                Show archived
              </label>
              <button
                type="button"
                onClick={() => setModal("new")}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-ink whitespace-nowrap"
              >
                + Add link
              </button>
            </>
          )}
        </div>
      </div>

      {rowError && (
        <div className="mb-4 text-sm rounded-md px-3 py-2 bg-dropped-bg text-dropped-fg">{rowError}</div>
      )}

      {links.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center text-text-faint">
          <p>No payment links yet.</p>
          {canManage && (
            <button
              type="button"
              onClick={() => setModal("new")}
              className="mt-3 text-sm font-medium text-accent-ink hover:underline"
            >
              + Add your first link
            </button>
          )}
        </div>
      ) : sections.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg px-4 py-12 text-center text-text-faint">
          No links match.
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.category} className="mb-6">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-text-faint">
              {section.category}
            </div>
            <div className="bg-surface border border-border rounded-lg divide-y divide-border">
              {section.links.map(row)}
            </div>
          </section>
        ))
      )}

      {modal !== null && (
        <PaymentLinkModal initial={modal === "new" ? null : modal} onClose={closeModal} />
      )}
    </div>
  );
}
