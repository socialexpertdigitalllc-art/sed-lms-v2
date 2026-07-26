"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { btnPrimary, btnSecondary } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { cn } from "@/lib/utils";

/** Only the fields the launch dialog actually reads off a lead row — the
 *  leads API returns every column, but a generation launcher has no business
 *  looking at commercial fields (see dossier.ts's own rule). */
interface LeadOption {
  id: string;
  business_name: string;
  status: string;
  deleted_at: string | null;
  business_phone: string | null;
  business_email: string | null;
  services: string[] | null;
  service_areas: string[] | null;
  specify_pages: string[] | null;
}

interface TemplateOption {
  id: string;
  name: string;
  status: string;
}

/**
 * Lead + certified-template picker that starts a generation run. Neither the
 * leads route nor the templates route filters server-side (both return
 * everything a caller can see), so the "Not Ready, not deleted" and
 * "certified only" rules are applied here, client-side, matching the exact
 * idiom the rest of the app already uses for these two endpoints.
 */
export function RunLaunch({
  onClose,
  onCreated,
  initialLeadId,
}: {
  onClose: () => void;
  onCreated: (runId: string) => void;
  /** Preselects this lead once the leads list loads — e.g. arriving here via
   *  `?lead=<id>` from a lead's own page. Silently ignored if the lead isn't
   *  in the "Not Ready" eligible list (same rule as picking one by hand). */
  initialLeadId?: string | null;
}) {
  const { toast } = useToast();

  const [leads, setLeads] = useState<LeadOption[] | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[] | null>(null);
  const [leadQuery, setLeadQuery] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");

  const [checkedPages, setCheckedPages] = useState<Record<string, boolean>>({});
  const [fanOutServices, setFanOutServices] = useState(false);
  const [fanOutAreas, setFanOutAreas] = useState(false);
  const [auto, setAuto] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadLeads = useCallback(async () => {
    try {
      const res = await fetch("/api/leads");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load leads");
      setLeads((body.leads ?? []) as LeadOption[]);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load leads" });
      setLeads([]);
    }
  }, [toast]);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/site-studio/templates");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load templates");
      setTemplates((body.templates ?? []) as TemplateOption[]);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not load templates" });
      setTemplates([]);
    }
  }, [toast]);

  useEffect(() => { void loadLeads(); void loadTemplates(); }, [loadLeads, loadTemplates]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const eligibleLeads = useMemo(() => (leads ?? []).filter((l) => l.status === "Not Ready" && !l.deleted_at), [leads]);
  const shownLeads = useMemo(() => {
    const q = leadQuery.trim().toLowerCase();
    if (!q) return eligibleLeads;
    return eligibleLeads.filter((l) => l.business_name.toLowerCase().includes(q));
  }, [eligibleLeads, leadQuery]);
  const certifiedTemplates = useMemo(() => (templates ?? []).filter((t) => t.status === "certified"), [templates]);

  const selectedLead = useMemo(() => eligibleLeads.find((l) => l.id === selectedLeadId) ?? null, [eligibleLeads, selectedLeadId]);

  function selectLead(lead: LeadOption) {
    setSelectedLeadId(lead.id);
    const pages = lead.specify_pages ?? [];
    setCheckedPages(Object.fromEntries(pages.map((p) => [p, true])));
  }

  // Preselect the lead passed in via ?lead=<id> once the eligible list is in —
  // runs once per dialog open (bails out as soon as something is selected).
  // If the lead loaded but isn't eligible (wrong status, or deleted), the
  // operator arrived here by clicking a button on that lead's own page, so
  // silence would read as "the app is broken" — tell them once, by name, and
  // leave the picker open so they can choose someone else.
  const notifiedIneligibleRef = useRef(false);
  useEffect(() => {
    if (!initialLeadId || selectedLeadId || leads === null) return;
    const match = eligibleLeads.find((l) => l.id === initialLeadId);
    if (match) {
      selectLead(match);
      return;
    }
    if (!notifiedIneligibleRef.current) {
      notifiedIneligibleRef.current = true;
      toast({
        kind: "error",
        title: "This lead isn't eligible for a run — its status must be 'Not Ready'.",
      });
    }
  }, [initialLeadId, eligibleLeads, selectedLeadId, leads, toast]);

  async function submit() {
    if (!selectedLead) {
      toast({ kind: "error", title: "Pick a lead first" });
      return;
    }
    if (!templateId) {
      toast({ kind: "error", title: "Pick a certified template first" });
      return;
    }
    setSubmitting(true);
    try {
      const pageIds = Object.entries(checkedPages).filter(([, v]) => v).map(([k]) => k);
      const res = await fetch("/api/site-studio/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: selectedLead.id,
          template_id: templateId,
          options: {
            ...(pageIds.length ? { page_ids: pageIds } : {}),
            fan_out_services: fanOutServices,
            fan_out_areas: fanOutAreas,
            auto,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409s (active run exists / not certified) — surfaced verbatim.
        toast({ kind: "error", title: body.error ?? "Could not start the run" });
        return;
      }
      toast({ kind: "success", title: "Run started" });
      onCreated(body.run.id as string);
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not start the run" });
    } finally {
      setSubmitting(false);
    }
  }

  const servicesCount = selectedLead?.services?.length ?? 0;
  const areasCount = selectedLead?.service_areas?.length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[720px] flex-col border-l border-border bg-surface"
        role="dialog"
        aria-label="New generation run"
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-3">
          <h2 className="flex-1 font-display text-lg font-semibold text-text">New generation run</h2>
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-auto p-5">
          {/* 1. Lead */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">1. Lead (Not Ready)</h3>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              <input
                className={cn(inputCls, "pl-8")}
                value={leadQuery}
                onChange={(e) => setLeadQuery(e.target.value)}
                placeholder="Search leads by business name"
                aria-label="Search leads"
              />
            </div>
            {leads === null ? (
              <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading leads…</p>
            ) : shownLeads.length === 0 ? (
              <p className="text-sm text-text-muted">No "Not Ready" leads match.</p>
            ) : (
              <ul className="max-h-52 divide-y divide-border overflow-auto rounded-md border border-border">
                {shownLeads.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      onClick={() => selectLead(l)}
                      aria-pressed={selectedLeadId === l.id}
                      className={cn(
                        "block w-full px-3 py-2 text-left text-sm",
                        selectedLeadId === l.id ? "bg-accent-soft text-accent-ink" : "hover:bg-surface-2 text-text",
                      )}
                    >
                      {l.business_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selectedLead ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-surface-2 p-3 text-xs text-text-muted">
                <dt className="font-medium text-text">Phone</dt><dd>{selectedLead.business_phone ?? "—"}</dd>
                <dt className="font-medium text-text">Email</dt><dd>{selectedLead.business_email ?? "—"}</dd>
                <dt className="font-medium text-text">Services</dt><dd>{(selectedLead.services ?? []).join(", ") || "—"}</dd>
                <dt className="font-medium text-text">Areas</dt><dd>{(selectedLead.service_areas ?? []).join(", ") || "—"}</dd>
              </dl>
            ) : null}
          </section>

          {/* 2. Template */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">2. Certified template</h3>
            {templates === null ? (
              <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading templates…</p>
            ) : certifiedTemplates.length === 0 ? (
              <p className="text-sm text-text-muted">No certified templates yet — certify one first.</p>
            ) : (
              <select
                className={inputCls}
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                aria-label="Template"
              >
                <option value="">Choose a template…</option>
                {certifiedTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </section>

          {/* 3. Pages */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">3. Pages</h3>
            {!selectedLead ? (
              <p className="text-sm text-text-muted">Pick a lead first.</p>
            ) : (selectedLead.specify_pages ?? []).length === 0 ? (
              <p className="text-sm text-text-muted">
                No specific pages requested — every page in the template will be generated.
              </p>
            ) : (
              <ul className="space-y-1">
                {(selectedLead.specify_pages ?? []).map((p) => (
                  <li key={p}>
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={checkedPages[p] ?? false}
                        onChange={(e) => setCheckedPages((prev) => ({ ...prev, [p]: e.target.checked }))}
                      />
                      {p}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-text-faint">The home page is always included. Skipped requests show up honestly after preparing.</p>
          </section>

          {/* 4. Fan-out */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-faint">4. Fan-out</h3>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={fanOutServices} onChange={(e) => setFanOutServices(e.target.checked)} />
              Service pages: {servicesCount}
            </label>
            <label className="mt-1 flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={fanOutAreas} onChange={(e) => setFanOutAreas(e.target.checked)} />
              Area pages: {areasCount}
            </label>
          </section>

          {/* 5. Auto */}
          <section>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Skip content review — everything stays editable at the preview
            </label>
          </section>
        </div>

        <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button className={btnSecondary} onClick={onClose} disabled={submitting}>Cancel</button>
          <button className={btnPrimary} onClick={() => void submit()} disabled={submitting || !selectedLead || !templateId}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Start run
          </button>
        </footer>
      </aside>
    </div>
  );
}
