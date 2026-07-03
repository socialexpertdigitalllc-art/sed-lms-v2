"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LEAD_STATUSES, SITE_TYPES } from "@/lib/leads/types";

type Agent = { id: string; display_name: string | null };

const nz = (s: string) => (s.trim() === "" ? null : s.trim());

export function NewLeadForm({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  const [f, setF] = useState({
    business_name: "",
    status: "Not Ready",
    agent_id: "",
    site_type: "",
    business_phone: "",
    business_email: "",
    business_profile_link: "",
    price_quoted: "",
    follow_up_time: "",
    comments: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
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
      status: f.status,
      agent_id: f.agent_id || null,
      site_type: f.site_type || null,
      business_phone: nz(f.business_phone),
      business_email: nz(f.business_email),
      business_profile_link: nz(f.business_profile_link),
      price_quoted: f.price_quoted.trim() === "" ? null : Number(f.price_quoted),
      follow_up_time: f.follow_up_time ? new Date(f.follow_up_time).toISOString() : null,
      comments: nz(f.comments),
    };
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Failed to create lead");
      return;
    }
    const { id } = await res.json();
    router.push(`/leads/${id}`);
    router.refresh();
  }

  const cls = "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";

  return (
    <div className="max-w-2xl">
      <Link href="/leads" className="text-xs text-text-muted hover:text-text">← Leads</Link>
      <h1 className="text-xl font-semibold text-text mt-2 mb-5">New lead</h1>

      {error && <div className="mb-4 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{error}</div>}

      <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-text-muted mb-1">Business name *</label>
            <input value={f.business_name} onChange={set("business_name")} className={cls} autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Status</label>
            <select value={f.status} onChange={set("status")} className={cls}>
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Agent</label>
            <select value={f.agent_id} onChange={set("agent_id")} className={cls}>
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.display_name ?? a.id}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Site type</label>
            <select value={f.site_type} onChange={set("site_type")} className={cls}>
              <option value="">—</option>
              {SITE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Price quoted ($)</label>
            <input type="number" value={f.price_quoted} onChange={set("price_quoted")} className={cls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Phone</label>
            <input value={f.business_phone} onChange={set("business_phone")} className={cls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Email</label>
            <input type="email" value={f.business_email} onChange={set("business_email")} className={cls} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-text-muted mb-1">Profile link (Google / Yelp)</label>
            <input value={f.business_profile_link} onChange={set("business_profile_link")} className={cls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Follow-up date & time</label>
            <input type="datetime-local" value={f.follow_up_time} onChange={set("follow_up_time")} className={cls} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-text-muted mb-1">Comments</label>
            <textarea value={f.comments} onChange={set("comments")} rows={3} className={cls} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/leads" className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2">Cancel</Link>
          <button disabled={busy} className="px-5 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60">
            {busy ? "Creating…" : "Create lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
