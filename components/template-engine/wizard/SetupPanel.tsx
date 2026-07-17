"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2, Check, ChevronDown, FileText, Image as ImageIcon, Layers, Loader2,
  Mail, MapPin, Palette, Phone, Rocket, Search, Link2, Award,
} from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";
import type { TemplateManifest } from "@/lib/template-engine/types";
import { resolveLeadPages } from "@/lib/template-engine/leadPages";

export type LeadOption = {
  id: string;
  business_name: string;
  status: string;
  business_phone: string | null;
  business_email: string | null;
  no_email: boolean | null;
  business_profile_link: string | null;
  logo_link: string | null;
  map_embed_link: string | null;
  site_type: string | null;
  services: string[] | null;
  service_areas: string[] | null;
  num_webpages: number | null;
  specify_pages: string[] | null;
  client_experience: number | null;
  color_scheme: string | null;
  color_same_as_logo: boolean | null;
  image_links: string[] | null;
};
export type TemplateOption = { id: string; name: string; manifest: TemplateManifest; page_count: number };

const list = (v: string[] | null): string[] => (Array.isArray(v) ? v.filter(Boolean) : []);

export function SetupPanel({ leads, templates }: { leads: LeadOption[]; templates: TemplateOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const preselect = useSearchParams().get("lead");
  const [leadId, setLeadId] = useState(() => (leads.some((l) => l.id === preselect) ? preselect! : ""));
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [excludePeople, setExcludePeople] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const lead = leads.find((l) => l.id === leadId) ?? null;
  const template = templates.find((t) => t.id === templateId) ?? null;

  // Pages come straight from the lead's specified pages, mapped onto the chosen
  // template's files by kind — the operator never hand-picks them.
  const derivedPages = useMemo(() => {
    if (!lead || !template) return [];
    const manifestPages = Array.isArray(template.manifest?.pages) ? template.manifest.pages : [];
    return resolveLeadPages(list(lead.specify_pages), manifestPages);
  }, [lead, template]);

  async function start() {
    if (!leadId || !templateId || derivedPages.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/template-engine/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, templateId, pages: derivedPages, options: { exclude_people: excludePeople } }),
      });
      if (!res.ok) {
        setSubmitting(false);
        toast({ kind: "error", title: "Could not start", body: (await res.json().catch(() => ({}))).error ?? "Generation failed to queue" });
        return;
      }
      const { id } = await res.json();
      router.push(`/ai-tools/template-engine/${id}`);
    } catch {
      setSubmitting(false);
      toast({ kind: "error", title: "Could not start", body: "Network error — try again" });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-5">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">New generation</h2>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Left: lead picker + template + options */}
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">Lead <span className="text-text-faint">(Not Ready only)</span></label>
            <LeadPicker leads={leads} value={leadId} onChange={setLeadId} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-muted">Template</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <button key={t.id} type="button" onClick={() => setTemplateId(t.id)}
                  className={cn(
                    "rounded-md border p-3 text-left transition-colors",
                    t.id === templateId ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-accent/50",
                  )}>
                  <p className={cn("text-sm font-medium", t.id === templateId ? "text-accent-ink" : "text-text")}>{t.name}</p>
                  <p className="text-xs text-text-muted">{t.page_count} template pages</p>
                </button>
              ))}
            </div>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={excludePeople} onChange={(e) => setExcludePeople(e.target.checked)} className="accent-accent h-4 w-4" />
            Exclude photos with people
          </label>
        </div>

        {/* Right: the lead dossier — exactly what will feed the generator */}
        <LeadDossier lead={lead} derivedPages={derivedPages} />
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border-subtle pt-4">
        <p className="text-xs text-text-faint">
          {lead && template
            ? derivedPages.length > 0
              ? `Will build ${derivedPages.length} page${derivedPages.length === 1 ? "" : "s"} from ${lead.business_name}'s details.`
              : "This template has no pages matching the lead's requested pages."
            : "Pick a lead and template to begin."}
        </p>
        <button type="button" disabled={!leadId || !templateId || derivedPages.length === 0 || submitting} onClick={start}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Start generation
        </button>
      </div>
    </div>
  );
}

/** Searchable, keyboard-navigable lead picker with rich rows (far better than a native select). */
function LeadPicker({ leads, value, onChange }: { leads: LeadOption[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = leads.find((l) => l.id === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) => l.business_name.toLowerCase().includes(q));
  }, [leads, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function openPicker() {
    setActive(0);
    setOpen((o) => !o);
  }
  function onQuery(v: string) {
    setQuery(v);
    setActive(0);
  }
  function choose(l: LeadOption) {
    onChange(l.id);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) choose(filtered[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button type="button" onClick={openPicker} aria-haspopup="listbox" aria-expanded={open}
        className={cn(inputCls, "flex items-center justify-between gap-2 text-left")}>
        <span className={cn("truncate", selected ? "text-text" : "text-text-faint")}>
          {selected ? selected.business_name : "Select a lead…"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-faint" />
      </button>

      {open ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-lg">
          <div className="relative border-b border-border-subtle p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-faint" />
            <input ref={inputRef} value={query} onChange={(e) => onQuery(e.target.value)} onKeyDown={onKeyDown}
              aria-label="Search leads" placeholder="Search by business name…"
              className={cn(inputCls, "pl-8")} />
          </div>
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-text-faint">No Not-Ready leads match.</li>
            ) : filtered.map((l, i) => {
              const svc = list(l.services).length;
              const areas = list(l.service_areas).length;
              return (
                <li key={l.id} role="option" aria-selected={l.id === value}>
                  <button type="button" onMouseEnter={() => setActive(i)} onClick={() => choose(l)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left",
                      i === active ? "bg-accent-soft" : "hover:bg-surface-2",
                    )}>
                    <Building2 className="h-4 w-4 shrink-0 text-text-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-text">{l.business_name}</span>
                      <span className="block truncate text-xs text-text-muted">
                        {svc} service{svc === 1 ? "" : "s"}{areas ? ` · ${areas} area${areas === 1 ? "" : "s"}` : ""}{l.site_type ? ` · ${l.site_type}` : ""}
                      </span>
                    </span>
                    {l.id === value ? <Check className="h-4 w-4 shrink-0 text-accent-ink" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** The incoming-lead dossier: every field that will feed the generator, at a glance. */
function LeadDossier({ lead, derivedPages }: { lead: LeadOption | null; derivedPages: string[] }) {
  if (!lead) {
    return (
      <div className="grid place-items-center rounded-md border border-dashed border-border p-6 text-center text-sm text-text-faint">
        Pick a lead to see exactly what will feed the generator.
      </div>
    );
  }
  const services = list(lead.services);
  const areas = list(lead.service_areas);
  const photos = list(lead.image_links);
  const colors = lead.color_same_as_logo ? "Match the logo" : lead.color_scheme || null;

  return (
    <div className="rounded-md border border-border-subtle bg-surface-2 p-4 space-y-3">
      <div className="flex items-center gap-2">
        {lead.logo_link ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lead.logo_link} alt="" className="h-9 w-9 rounded object-cover border border-border"
            onError={(e) => { e.currentTarget.style.display = "none"; }} />
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-text">{lead.business_name}</p>
          <p className="text-xs text-text-faint">{lead.site_type ?? "Website"} · from lead details</p>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
        <Row icon={Phone} label="Phone">{lead.business_phone ?? <Muted>not set</Muted>}</Row>
        <Row icon={Mail} label="Email">{lead.no_email ? <Muted>no email (phone CTAs)</Muted> : lead.business_email ?? <Muted>not set</Muted>}</Row>
        <Row icon={Link2} label="Profile">{lead.business_profile_link ? <Ext href={lead.business_profile_link} /> : <Muted>not set</Muted>}</Row>
        <Row icon={MapPin} label="Map embed">{lead.map_embed_link ? "Provided" : <Muted>none</Muted>}</Row>
        <Row icon={Award} label="Experience">{typeof lead.client_experience === "number" ? `${lead.client_experience} years` : <Muted>not set</Muted>}</Row>
        <Row icon={Palette} label="Colors">{colors ?? <Muted>up to us</Muted>}</Row>
        <Row icon={ImageIcon} label="Client photos">{photos.length ? `${photos.length} image${photos.length === 1 ? "" : "s"}` : <Muted>none</Muted>}</Row>
        <Row icon={FileText} label="Requested">{lead.num_webpages ? `${lead.num_webpages} pages` : <Muted>—</Muted>}</Row>
      </dl>

      <Block icon={Layers} label={`Services (${services.length})`}>
        {services.length ? services.slice(0, 12).join(", ") + (services.length > 12 ? " …" : "") : <Muted>none listed</Muted>}
      </Block>
      {areas.length ? (
        <Block icon={MapPin} label={`Service areas (${areas.length})`}>
          {areas.slice(0, 12).join(", ") + (areas.length > 12 ? " …" : "")}
        </Block>
      ) : null}

      <Block icon={FileText} label={`Pages to build (${derivedPages.length})`}>
        {derivedPages.length ? (
          <span className="flex flex-wrap gap-1">
            {derivedPages.map((p) => (
              <span key={p} className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-text-muted border border-border-subtle">{p}</span>
            ))}
          </span>
        ) : <Muted>no template pages match the lead&apos;s requested pages</Muted>}
      </Block>
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" />
      <dt className="shrink-0 text-text-faint">{label}:</dt>
      <dd className="min-w-0 truncate text-text">{children}</dd>
    </div>
  );
}
function Block({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border-subtle pt-2 text-xs">
      <p className="mb-1 flex items-center gap-1.5 font-medium text-text-muted"><Icon className="h-3.5 w-3.5 text-text-faint" />{label}</p>
      <div className="text-text">{children}</div>
    </div>
  );
}
const Muted = ({ children }: { children: React.ReactNode }) => <span className="text-text-faint">{children}</span>;
function Ext({ href }: { href: string }) {
  let label = href;
  try { label = new URL(href).hostname.replace(/^www\./, ""); } catch { /* keep raw href */ }
  return <a href={href} target="_blank" rel="noreferrer" className="truncate text-accent-ink underline">{label}</a>;
}
