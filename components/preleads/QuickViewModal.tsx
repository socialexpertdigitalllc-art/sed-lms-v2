"use client";

import { PreLead } from "@/lib/preleads/types";
import { CategoryPill, PreLeadStatusPill } from "@/components/preleads/CategoryPill";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/leads/format";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-text-faint">{label}</div>
      <div className="text-sm text-text mt-0.5">{children}</div>
    </div>
  );
}

export function QuickViewModal({
  preLead,
  open,
  onClose,
}: {
  preLead: PreLead;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  const areas = preLead.areas?.length ? preLead.areas.join(", ") : "—";
  const services = preLead.services?.length ? preLead.services.join(", ") : "—";

  return (
    <div className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-lg p-6 w-[560px] max-w-full"
      >
        <h2 className="font-semibold text-text">Lead details</h2>
        <p className="text-sm text-text-muted mt-1 mb-5 truncate">{preLead.business_name}</p>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Field label="Business name">{preLead.business_name || "—"}</Field>
          <Field label="Owner">{preLead.owner_name || "—"}</Field>
          <Field label="Phone">{preLead.phone_number || "—"}</Field>
          <Field label="Email">{preLead.email || "—"}</Field>
          <Field label="Category">
            <CategoryPill category={preLead.lead_category} />
          </Field>
          <Field label="Status">
            <PreLeadStatusPill status={preLead.status} />
          </Field>
          <Field label="Service offered">{preLead.service_offered || "—"}</Field>
          <Field label="Service type">{preLead.service_type || "—"}</Field>
          <Field label="Pricing">{formatCurrency(preLead.pricing)}</Field>
          <Field label="Profile link">
            {preLead.google_yelp_link ? (
              <a
                href={preLead.google_yelp_link}
                target="_blank"
                rel="noreferrer"
                className="text-accent-ink hover:underline"
              >
                Open
              </a>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Areas">{areas}</Field>
          <Field label="Services">{services}</Field>
          <Field label="Follow-up time">{formatDateTime(preLead.follow_up_time)}</Field>
          <Field label="Created">{formatDate(preLead.created_at)}</Field>
          <div className="col-span-2">
            <div className="text-[10px] uppercase tracking-wide text-text-faint">Comments</div>
            <div className="text-sm text-text mt-0.5 whitespace-pre-wrap">{preLead.comments || "—"}</div>
          </div>
        </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
