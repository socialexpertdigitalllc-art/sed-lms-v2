"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LEAD_CATEGORIES, SERVICE_OFFERED, SERVICE_TYPE } from "@/lib/preleads/types";
import { formatPhone } from "@/lib/forms/phone";
import {
  emptyPreLead,
  validatePreLead,
  buildPreLeadPayload,
  type PreLeadFormState,
} from "@/lib/preleads/newPreLeadForm";
import { Field, FormSection, inputCls } from "@/components/forms/Field";

/** Module-scope field wrapper (stable identity so inputs don't remount on keystroke). */
function F({ error, ...props }: { error?: string } & React.ComponentProps<typeof Field>) {
  return (
    <div data-error={error ? "true" : undefined}>
      <Field {...props} error={error} />
    </div>
  );
}

export function AddPreLeadForm() {
  const router = useRouter();
  const [f, setF] = useState<PreLeadFormState>(emptyPreLead());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  function set<K extends keyof PreLeadFormState>(k: K, v: PreLeadFormState[K]) {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((p) => {
      if (!(k in p)) return p;
      const n = { ...p };
      delete n[k as string];
      return n;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validatePreLead(f);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      requestAnimationFrame(() =>
        document
          .querySelector("[data-error='true']")
          ?.scrollIntoView({ behavior: "smooth", block: "center" })
      );
      return;
    }
    setBusy(true);
    setApiError(null);
    const res = await fetch("/api/pre-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPreLeadPayload(f)),
    });
    setBusy(false);
    if (!res.ok) {
      setApiError((await res.json().catch(() => ({}))).error ?? "Failed to create pre-lead");
      return;
    }
    router.push("/pre-leads/all");
    router.refresh();
  }

  const websiteSelected = f.service_offered === "Website";

  return (
    <div className="max-w-3xl">
      <Link href="/pre-leads/all" className="text-xs text-text-muted hover:text-text">← Pre-Leads</Link>
      <h1 className="text-xl font-semibold text-text mt-2 mb-5">New pre-lead</h1>

      {apiError && (
        <div className="mb-4 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{apiError}</div>
      )}

      <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-5 divide-y divide-border">
        {/* ① Service Details */}
        <FormSection title="Service Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F error={errors.service_offered} label="Service Offered" required>
              <select
                value={f.service_offered}
                onChange={(e) => {
                  set("service_offered", e.target.value);
                  setErrors((p) => {
                    const n = { ...p };
                    delete n.service_type;
                    return n;
                  });
                }}
                className={inputCls}
              >
                <option value="">Select Service</option>
                {SERVICE_OFFERED.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </F>
            <F error={errors.service_type} label="Service Type" required={websiteSelected}>
              <select value={f.service_type} onChange={(e) => set("service_type", e.target.value)} className={inputCls}>
                <option value="">Select Type</option>
                {SERVICE_TYPE.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </F>
          </div>
        </FormSection>

        {/* ② Business Information */}
        <FormSection title="Business Information">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F error={errors.business_name} label="Business Name" required>
              <input value={f.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="Legal business name" className={inputCls} autoFocus />
            </F>
            <F error={errors.phone_number} label="Phone Number" required hint="Format: (252) 401-2775">
              <input type="tel" value={f.phone_number} onChange={(e) => set("phone_number", formatPhone(e.target.value))} placeholder="(252) 401-2775" maxLength={14} className={inputCls} />
            </F>
            <F error={errors.email} label="Email Address">
              <input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="contact@business.com" className={inputCls} />
            </F>
            <F error={errors.owner_name} label="Owner Name">
              <input value={f.owner_name} onChange={(e) => set("owner_name", e.target.value)} placeholder="Decision maker name" className={inputCls} />
            </F>
            <F error={errors.google_yelp_link} label="Profile Link" required>
              <input type="url" value={f.google_yelp_link} onChange={(e) => set("google_yelp_link", e.target.value)} placeholder="Google Maps or Yelp profile URL" className={inputCls} />
            </F>
            <F error={errors.areas} label="Areas">
              <input value={f.areas} onChange={(e) => set("areas", e.target.value)} placeholder="Primary service areas" className={inputCls} />
            </F>
          </div>
        </FormSection>

        {/* ③ Project Scope & Follow-up */}
        <FormSection title="Project Scope & Follow-up">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F error={errors.services} label="Services (Comma-separated)">
              <input value={f.services} onChange={(e) => set("services", e.target.value)} placeholder="e.g., Social Media, SEO, Analytics" className={inputCls} />
            </F>
            <F error={errors.pricing} label="Target Pricing ($)">
              <input type="number" min={0} step="0.01" value={f.pricing} onChange={(e) => set("pricing", e.target.value)} placeholder="Estimated value" className={inputCls} />
            </F>
            <F error={errors.follow_up_time} label="Follow-up Date & Time" required>
              <input type="datetime-local" value={f.follow_up_time} onChange={(e) => set("follow_up_time", e.target.value)} className={inputCls} />
            </F>
            <F error={errors.lead_category} label="Lead Category" required>
              <select value={f.lead_category} onChange={(e) => set("lead_category", e.target.value)} className={inputCls}>
                <option value="">Select Category</option>
                {LEAD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </F>
          </div>
          <F error={errors.comments} label="Internal Comments / Notes">
            <textarea value={f.comments} onChange={(e) => set("comments", e.target.value)} placeholder="Add any relevant details or initial conversation notes..." rows={3} className={inputCls} />
          </F>
        </FormSection>

        <div className="pt-5">
          <button disabled={busy} className="w-full px-5 py-2.5 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60">
            {busy ? "Submitting…" : "Submit Pre-Lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
