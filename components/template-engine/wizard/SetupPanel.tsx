"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Images as ImagesIcon, Layers, Loader2, Rocket, Search } from "lucide-react";
import { Select } from "@/components/common/Select";
import { useToast } from "@/components/common/Toast";
import { inputCls } from "@/components/forms/Field";
import { ChipGroup } from "@/components/forms/ChipGroup";
import { cn } from "@/lib/utils";
import type { TemplateManifest } from "@/lib/template-engine/types";

export type LeadOption = {
  id: string;
  business_name: string;
  services: string[] | null;
  service_areas: string[] | null;
  image_links: string[] | null;
  site_type: string | null;
  color_scheme: string | null;
  status: string;
};
export type TemplateOption = { id: string; name: string; manifest: TemplateManifest; page_count: number };

export function SetupPanel({ leads, templates }: { leads: LeadOption[]; templates: TemplateOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const preselect = useSearchParams().get("lead");
  const [leadId, setLeadId] = useState(() => (leads.some((l) => l.id === preselect) ? preselect! : ""));
  const [query, setQuery] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [pages, setPages] = useState<string[]>([]);
  const [excludePeople, setExcludePeople] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const lead = leads.find((l) => l.id === leadId) ?? null;
  const template = templates.find((t) => t.id === templateId) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? leads.filter((l) => l.business_name.toLowerCase().includes(q)) : leads;
  }, [leads, query]);

  const pageFiles = template?.manifest?.pages?.map((p) => p.file) ?? [];
  const selectedPages = pages.length ? pages : pageFiles; // default: all template pages

  async function start() {
    if (!leadId || !templateId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/template-engine/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          templateId,
          pages: selectedPages,
          options: { exclude_people: excludePeople },
        }),
      });
      if (!res.ok) {
        setSubmitting(false);
        toast({ kind: "error", title: "Could not start", body: (await res.json().catch(() => ({}))).error ?? "Generation failed to queue" });
        return;
      }
      const { id } = await res.json();
      // submitting stays true through the navigation — double-submit guard
      router.push(`/ai-tools/template-engine/${id}`);
    } catch {
      setSubmitting(false);
      toast({ kind: "error", title: "Could not start", body: "Network error — try again" });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-5">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">New generation</h2>

      {/* Lead picker with live search + data preview */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-text-faint" />
            <input
              className={cn(inputCls, "pl-8")}
              placeholder="Search leads by business name"
              aria-label="Search leads"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select className={inputCls} aria-label="Lead" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">Select a lead…</option>
            {filtered.map((l) => (
              <option key={l.id} value={l.id}>{l.business_name} — {l.status}</option>
            ))}
          </Select>
        </div>

        {/* What will feed the AI */}
        {lead ? (
          <div className="rounded-md border border-border-subtle bg-surface-2 p-3 text-sm space-y-1.5">
            <p className="font-medium text-text">{lead.business_name}
              {lead.site_type ? <span className="ml-2 text-xs text-text-faint">{lead.site_type}</span> : null}
            </p>
            <p className="text-text-muted"><Layers className="mr-1 inline h-3.5 w-3.5" />{(lead.services ?? []).length} services{lead.services?.length ? `: ${lead.services.slice(0, 6).join(", ")}${lead.services.length > 6 ? "…" : ""}` : ""}</p>
            <p className="text-text-muted">Areas: {(lead.service_areas ?? []).join(", ") || "none"}</p>
            <p className="text-text-muted"><ImagesIcon className="mr-1 inline h-3.5 w-3.5" />{(lead.image_links ?? []).length} client photos{lead.color_scheme ? ` · colors: ${lead.color_scheme}` : ""}</p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-3 text-sm text-text-faint">
            Pick a lead to see exactly what will feed the generator.
          </div>
        )}
      </div>

      {/* Template picker (cards) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setTemplateId(t.id); setPages([]); }}
            className={cn(
              "rounded-md border p-3 text-left transition-colors",
              t.id === templateId ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-accent/50",
            )}
          >
            <p className={cn("text-sm font-medium", t.id === templateId ? "text-accent-ink" : "text-text")}>{t.name}</p>
            <p className="text-xs text-text-muted">{t.page_count} pages</p>
          </button>
        ))}
      </div>

      {/* Page selection */}
      {template ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-text-muted">Pages ({selectedPages.length}/{pageFiles.length} selected — all by default)</p>
          <ChipGroup
            options={pageFiles}
            selected={selectedPages}
            onToggle={(file) =>
              setPages(selectedPages.includes(file) ? selectedPages.filter((f) => f !== file) : [...selectedPages, file])
            }
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={excludePeople} onChange={(e) => setExcludePeople(e.target.checked)} className="accent-accent h-4 w-4" />
          Exclude photos with people
        </label>
        <button
          type="button"
          disabled={!leadId || !templateId || selectedPages.length === 0 || submitting}
          onClick={start}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-ink disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
          Start generation
        </button>
      </div>
    </div>
  );
}
