"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LEAD_CATEGORIES,
  PRELEAD_STATUSES,
  SERVICE_OFFERED,
  SERVICE_TYPE,
} from "@/lib/preleads/types";

const nz = (s: string) => (s.trim() === "" ? null : s.trim());
const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function AddPreLeadForm() {
  const router = useRouter();
  const [f, setF] = useState({
    business_name: "",
    lead_category: "Strong Lead",
    status: "Next follow up",
    service_offered: "",
    service_type: "",
    phone_number: "",
    email: "",
    owner_name: "",
    google_yelp_link: "",
    pricing: "",
    areas: "",
    services: "",
    follow_up_time: "",
    comments: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set =
    (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.business_name.trim()) {
      setError("Business name is required");
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      business_name: f.business_name.trim(),
      lead_category: f.lead_category,
      status: f.status,
      service_offered: f.service_offered || null,
      service_type: f.service_type || null,
      phone_number: nz(f.phone_number),
      email: nz(f.email),
      owner_name: nz(f.owner_name),
      google_yelp_link: nz(f.google_yelp_link),
      pricing: f.pricing.trim() === "" ? null : Number(f.pricing),
      areas: csv(f.areas),
      services: csv(f.services),
      follow_up_time: f.follow_up_time ? new Date(f.follow_up_time).toISOString() : null,
      comments: nz(f.comments),
    };
    const res = await fetch("/api/pre-leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Failed to create pre-lead");
      return;
    }
    const { id } = await res.json();
    router.push("/pre-leads/all");
    router.refresh();
  }

  const cls =
    "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";

  return (
    <div className="max-w-2xl">
      <Link href="/pre-leads/all" className="text-xs text-text-muted hover:text-text">
        ← Pre-Leads
      </Link>
      <h1 className="text-xl font-semibold text-text mt-2 mb-5">New pre-lead</h1>

      {error && (
        <div className="mb-4 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{error}</div>
      )}

      <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-text-muted mb-1">Business name *</label>
            <input value={f.business_name} onChange={set("business_name")} className={cls} autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Category</label>
            <select value={f.lead_category} onChange={set("lead_category")} className={cls}>
              {LEAD_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Status</label>
            <select value={f.status} onChange={set("status")} className={cls}>
              {PRELEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Service offered</label>
            <select value={f.service_offered} onChange={set("service_offered")} className={cls}>
              <option value="">—</option>
              {SERVICE_OFFERED.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Service type</label>
            <select value={f.service_type} onChange={set("service_type")} className={cls}>
              <option value="">—</option>
              {SERVICE_TYPE.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Phone</label>
            <input value={f.phone_number} onChange={set("phone_number")} className={cls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Email</label>
            <input type="email" value={f.email} onChange={set("email")} className={cls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Owner name</label>
            <input value={f.owner_name} onChange={set("owner_name")} className={cls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Pricing ($)</label>
            <input type="number" value={f.pricing} onChange={set("pricing")} className={cls} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-text-muted mb-1">
              Profile link (Google / Yelp)
            </label>
            <input value={f.google_yelp_link} onChange={set("google_yelp_link")} className={cls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Areas (comma-separated)</label>
            <input value={f.areas} onChange={set("areas")} className={cls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">
              Services (comma-separated)
            </label>
            <input value={f.services} onChange={set("services")} className={cls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Follow-up date & time</label>
            <input
              type="datetime-local"
              value={f.follow_up_time}
              onChange={set("follow_up_time")}
              className={cls}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-text-muted mb-1">Comments</label>
            <textarea value={f.comments} onChange={set("comments")} rows={3} className={cls} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href="/pre-leads/all"
            className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2"
          >
            Cancel
          </Link>
          <button
            disabled={busy}
            className="px-5 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create pre-lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
