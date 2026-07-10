"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, Building2, CalendarClock, ArrowLeft, Check, AlertTriangle } from "lucide-react";
import {
  LEAD_CATEGORIES,
  SERVICE_OFFERED,
  SERVICE_TYPE,
  CATEGORY_PILL,
} from "@/lib/preleads/types";
import { formatPhone } from "@/lib/forms/phone";
import { useDuplicateCheck } from "@/hooks/useDuplicateCheck";
import {
  emptyPreLead,
  validatePreLead,
  buildPreLeadPayload,
  type PreLeadFormState,
} from "@/lib/preleads/newPreLeadForm";
import { inputCls } from "@/components/forms/Field";
import { SectionCard, FieldBlock as F, SummaryRow } from "@/components/forms/formShell";

export function AddPreLeadForm({ canOverrideDuplicate }: { canOverrideDuplicate: boolean }) {
  const router = useRouter();
  const [f, setF] = useState<PreLeadFormState>(emptyPreLead());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const collisions = useDuplicateCheck("/api/pre-leads/check-duplicate", {
    business_name: f.business_name,
    phone: f.phone_number,
    email: f.email,
  });
  const dupBy = (field: string) => collisions.find((c) => c.field === field);
  const hasDup = collisions.length > 0;
  const [overrideDup, setOverrideDup] = useState(false);

  function set<K extends keyof PreLeadFormState>(k: K, v: PreLeadFormState[K]) {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((p) => {
      if (!(k in p)) return p;
      const n = { ...p };
      delete n[k as string];
      return n;
    });
  }

  const liveErrors = useMemo(() => validatePreLead(f), [f]);
  const sectionErrs: Record<string, string[]> = {
    service: ["service_offered", "service_type"],
    business: ["business_name", "phone_number", "email", "google_yelp_link"],
    scope: ["follow_up_time", "lead_category"],
  };
  const sectionDone = (key: keyof typeof sectionErrs) =>
    sectionErrs[key].every((k) => !(k in liveErrors));
  const totalSections = Object.keys(sectionErrs).length;
  const completed = Object.keys(sectionErrs).filter((k) =>
    sectionDone(k as keyof typeof sectionErrs)
  ).length;
  const remaining = Object.keys(liveErrors).length;

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
    if (hasDup && !(canOverrideDuplicate && overrideDup)) {
      setApiError("Resolve the highlighted duplicate before submitting.");
      return;
    }
    setBusy(true);
    setApiError(null);
    const res = await fetch("/api/pre-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...buildPreLeadPayload(f), override: overrideDup }),
    });
    setBusy(false);
    if (!res.ok) {
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        const fields: string[] = (body.collisions ?? []).map((c: { field: string }) => c.field);
        setApiError(
          fields.length
            ? `This business is already in the system (matching ${fields.join(", ")}).`
            : "This business is already in the system."
        );
        return;
      }
      setApiError((await res.json().catch(() => ({}))).error ?? "Failed to create pre-lead");
      return;
    }
    router.push("/pre-leads/all");
    router.refresh();
  }

  const websiteSelected = f.service_offered === "Website";
  const serviceDisplay = f.service_offered
    ? f.service_offered + (f.service_type ? ` · ${f.service_type}` : "")
    : "—";

  const submitBtn = (
    <button
      disabled={busy || (hasDup && !(canOverrideDuplicate && overrideDup))}
      className="w-full rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-ink disabled:opacity-60"
    >
      {busy ? "Submitting…" : "Submit Pre-Lead"}
    </button>
  );

  const dupBanner = hasDup && (
    <div className="mb-3 rounded-lg border border-dropped-fg/20 bg-dropped-bg px-3 py-2.5 text-xs text-dropped-fg">
      <p>
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 inline" /> Possible duplicate — matching{" "}
        {collisions.map((c) => c.field.replace("_", " ")).join(", ")} found in the system.
      </p>
      {canOverrideDuplicate && (
        <label className="mt-2 flex items-center gap-1.5 font-medium">
          <input
            type="checkbox"
            checked={overrideDup}
            onChange={(e) => setOverrideDup(e.target.checked)}
            className="accent-accent"
          />
          Submit anyway
        </label>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header band */}
      <div className="reveal relative mb-6 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="bg-grid absolute inset-0 opacity-60" />
        <div className="glow-teal absolute -right-16 -top-24 h-64 w-64" />
        <div className="relative flex flex-wrap items-end justify-between gap-4 p-6">
          <div className="min-w-0">
            <Link
              href="/pre-leads/all"
              className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text"
            >
              <ArrowLeft size={13} /> Pre-Leads
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-ink">
              New Pre-Lead
            </p>
            <h1 className="font-display text-2xl font-semibold leading-tight text-text">
              {f.business_name.trim() || "Untitled pre-lead"}
            </h1>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-semibold text-text">
              {completed}
              <span className="text-text-faint">/{totalSections}</span>
            </div>
            <p className="text-[11px] uppercase tracking-wide text-text-faint">sections ready</p>
            <div className="mt-2 h-1.5 w-36 overflow-hidden rounded-full bg-border-subtle">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${(completed / totalSections) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {apiError && (
        <div className="mb-4 rounded-lg border border-dropped-fg/20 bg-dropped-bg px-4 py-2.5 text-sm text-dropped-fg">
          {apiError}
        </div>
      )}

      <form onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <SectionCard n={1} icon={Briefcase} title="Service Details" subtitle="What they're after" done={sectionDone("service")} delay={0}>
            <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
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
                  {SERVICE_OFFERED.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </F>
              <F error={errors.service_type} label="Service Type" required={websiteSelected}>
                <select value={f.service_type} onChange={(e) => set("service_type", e.target.value)} className={inputCls}>
                  <option value="">Select Type</option>
                  {SERVICE_TYPE.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </F>
            </div>
          </SectionCard>

          <SectionCard n={2} icon={Building2} title="Business Information" subtitle="Who to reach" done={sectionDone("business")} delay={60}>
            <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
              <F error={errors.business_name} label="Business Name" required>
                <input value={f.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="Legal business name" className={inputCls} autoFocus />
                {dupBy("business_name") && (
                  <p className="mt-1 text-[11px] text-dropped-fg">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 inline" />{" "}
                    {dupBy("business_name")!.isOwn
                      ? "You already have a pre-lead with this business name."
                      : `This business name belongs to a pre-lead owned by ${dupBy("business_name")!.ownerDisplayName ?? "another agent"}.`}
                  </p>
                )}
              </F>
              <F error={errors.phone_number} label="Phone Number" required hint="Format: (252) 401-2775">
                <input type="tel" value={f.phone_number} onChange={(e) => set("phone_number", formatPhone(e.target.value))} placeholder="(252) 401-2775" maxLength={14} className={inputCls} />
                {dupBy("phone") && (
                  <p className="mt-1 text-[11px] text-dropped-fg">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 inline" />{" "}
                    {dupBy("phone")!.isOwn
                      ? "You already have a pre-lead with this phone number."
                      : `This phone number belongs to a pre-lead owned by ${dupBy("phone")!.ownerDisplayName ?? "another agent"}.`}
                  </p>
                )}
              </F>
              <F error={errors.email} label="Email Address">
                <input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="contact@business.com" className={inputCls} />
                {dupBy("email") && (
                  <p className="mt-1 text-[11px] text-dropped-fg">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 inline" />{" "}
                    {dupBy("email")!.isOwn
                      ? "You already have a pre-lead with this email."
                      : `This email belongs to a pre-lead owned by ${dupBy("email")!.ownerDisplayName ?? "another agent"}.`}
                  </p>
                )}
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
          </SectionCard>

          <SectionCard n={3} icon={CalendarClock} title="Project Scope & Follow-up" subtitle="Value & next touch" done={sectionDone("scope")} delay={120}>
            <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
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
                  {LEAD_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </F>
            </div>
            <F error={errors.comments} label="Internal Comments / Notes">
              <textarea value={f.comments} onChange={(e) => set("comments", e.target.value)} placeholder="Add any relevant details or initial conversation notes..." rows={3} className={inputCls} />
            </F>
          </SectionCard>

          <div className="lg:hidden">
            {dupBanner}
            <div className="flex items-center gap-3">
              <Link href="/pre-leads/all" className="rounded-lg border border-border px-4 py-2.5 text-sm text-text-muted hover:bg-surface-2">
                Cancel
              </Link>
              <div className="flex-1">{submitBtn}</div>
            </div>
          </div>
        </div>

        {/* Sticky summary */}
        <aside className="hidden lg:block">
          <div className="reveal sticky top-6 rounded-2xl border border-border bg-surface shadow-sm" style={{ animationDelay: "120ms" }}>
            <div className="border-b border-border-subtle px-5 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-faint">Summary</p>
              <p className="font-display text-base font-semibold text-text">Pre-lead dossier</p>
            </div>
            <div className="px-5 py-3">
              <SummaryRow label="Business">{f.business_name.trim() || "—"}</SummaryRow>
              <SummaryRow label="Category">
                {f.lead_category ? (
                  <span className={"rounded-md px-2 py-0.5 text-xs font-medium " + (CATEGORY_PILL[f.lead_category] ?? "bg-surface-2 text-text-muted")}>
                    {f.lead_category}
                  </span>
                ) : (
                  "—"
                )}
              </SummaryRow>
              <SummaryRow label="Service">{serviceDisplay}</SummaryRow>
              <SummaryRow label="Phone">
                <span className="font-mono">{f.phone_number || "—"}</span>
              </SummaryRow>
              <SummaryRow label="Pricing">
                <span className="font-mono">{f.pricing ? `$${f.pricing}` : "—"}</span>
              </SummaryRow>
              <SummaryRow label="Follow-up">
                <span className="font-mono">
                  {f.follow_up_time ? f.follow_up_time.replace("T", " ") : "—"}
                </span>
              </SummaryRow>
            </div>
            <div className="border-t border-border-subtle px-5 py-4">
              <p className="mb-3 text-xs text-text-muted">
                {remaining === 0 ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-ready-fg">
                    <Check size={14} /> All required fields complete
                  </span>
                ) : (
                  <>
                    <span className="font-mono font-semibold text-text">{remaining}</span> required{" "}
                    {remaining === 1 ? "field" : "fields"} remaining
                  </>
                )}
              </p>
              {dupBanner}
              {submitBtn}
              <Link
                href="/pre-leads/all"
                className="mt-2 block rounded-lg border border-border px-4 py-2 text-center text-sm text-text-muted transition-colors hover:bg-surface-2"
              >
                Cancel
              </Link>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
