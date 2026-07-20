"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Settings2, FileText, Images, Hammer, MonitorCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/common/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import type { GenStep } from "@/lib/template-engine/types";
import type { ImageSlot } from "@/lib/template-engine/imageSlots";
import type { ContentModel } from "@/lib/template-engine/contentModel";
import {
  WIZARD_STEPS, activeWizardStep, maxReachedStep, statusPill, type WizardStepN,
} from "@/lib/template-engine/wizard";
import { ContentEditor } from "./ContentEditor";
import { ImageCuration } from "./ImageCuration";
import { BuildTracker } from "./BuildTracker";
import { ReviewPanel } from "./ReviewPanel";

// The detail route returns select("*") + template_name/business_name; this is
// the subset the wizard reads. v2 jsonb columns come through as-is.
export type GenerationDetail = {
  id: string;
  lead_id: string;
  template_id: string;
  requested_pages: string[];
  status: string;
  current_step: string | null;
  steps: GenStep[];
  estimate_ms: number | null;
  total_ms: number | null;
  pages_built: number;
  images_used: number;
  site_slug: string | null;
  zip_path: string | null;
  deployed_url: string | null;
  error: string | null;
  // Cooperative run controls (migration 0044). `control` is the flag the runner
  // polls; `paused_at` is when it actually came to rest at a checkpoint.
  control?: string | null;
  paused_at?: string | null;
  // Per-step redo (migration 0045): which of "content" | "images" | "build"
  // have an output that predates a newer upstream redo. Absent on every row
  // written before the migration, which reads as "nothing stale".
  stale_steps?: string[] | null;
  created_at: string;
  brief: Record<string, unknown> | null;
  content_model: ContentModel | null;
  image_slots: ImageSlot[] | null;
  options: { exclude_people?: boolean } | null;
  gate_results: { ok: boolean; leaks: unknown[]; structure: { file: string; ok: boolean; detail?: string }[] } | null;
  template_name: string | null;
  business_name: string | null;
};

const STEP_ICONS = [Settings2, FileText, Images, Hammer, MonitorCheck];

export function GenerationWizard({ genId, canDeploy }: { genId: string; canDeploy: boolean }) {
  const [gen, setGen] = useState<GenerationDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState<WizardStepN | null>(null); // null = follow status
  const [rtTick, setRtTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/template-engine/generations/${genId}`);
      if (!res.ok) {
        setLoadErr((await res.json().catch(() => ({}))).error ?? "Failed to load generation");
        return;
      }
      const { generation } = await res.json();
      setGen(generation);
      setLoadErr(null);
    } catch {
      setLoadErr("Failed to load generation");
    }
  }, [genId]);

  useEffect(() => { load(); }, [load, rtTick]);

  // Realtime is only a poke — data always re-fetches through the REST route.
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const channel = supabase.channel(`rt-tge-wizard-${genId}`);
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "template_generations", filter: `id=eq.${genId}` }, () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => setRtTick((n) => n + 1), 400);
        })
        .subscribe();
    })();
    return () => { cancelled = true; if (t) clearTimeout(t); supabase.removeChannel(channel); };
  }, [genId]);

  const active: WizardStepN = step ?? (gen ? activeWizardStep(gen.status) : 4);
  const maxStep: WizardStepN = gen ? maxReachedStep(gen.status) : 1;

  // Status changes own the rail: when the pipeline advances (curating→building
  // →review), drop any manual back-navigation and follow it forward again.
  useEffect(() => { setStep(null); }, [gen?.status]);

  if (loadErr && !gen) return <EmptyState icon={Hammer} title="Generation unavailable" hint={loadErr} />;
  if (!gen) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  const pill = statusPill(gen.status);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/ai-tools/template-engine"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" /> Template Engine
        </Link>
        <h1 className="font-display text-xl font-semibold text-text">
          {gen.business_name ?? "Generation"}
          <span className="ml-2 text-sm font-normal text-text-faint">{gen.template_name}</span>
        </h1>
        <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", pill.cls)}>{pill.label}</span>
      </div>

      {/* Step rail */}
      <ol className="flex flex-wrap gap-2">
        {WIZARD_STEPS.map((s, i) => {
          const Icon = STEP_ICONS[i];
          const reachable = s.n <= maxStep;
          const current = s.n === active;
          return (
            <li key={s.key}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => setStep(s.n as WizardStepN)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  current
                    ? "border-accent bg-accent-soft font-medium text-accent-ink"
                    : reachable
                      ? "border-border bg-surface text-text-muted hover:text-text"
                      : "border-border-subtle bg-surface-2 text-text-faint cursor-not-allowed",
                )}
              >
                <span className={cn(
                  "grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold",
                  current ? "bg-accent text-white" : "bg-surface-2 text-text-faint",
                )}>
                  {s.n}
                </span>
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      {active === 1 && <SetupSummary gen={gen} />}
      {active === 2 && <ContentEditor gen={gen} onSaved={load} />}
      {active === 3 && <ImageCuration gen={gen} onChanged={load} />}
      {active === 4 && <BuildTracker gen={gen} onChanged={load} />}
      {active === 5 && <ReviewPanel gen={gen} canDeploy={canDeploy} onChanged={load} />}
    </div>
  );
}

/** Step 1 inside the wizard is a read-only recap — the run was configured on
 *  the launcher and the brief is frozen. */
function SetupSummary({ gen }: { gen: GenerationDetail }) {
  const brief = (gen.brief ?? {}) as Record<string, unknown>;
  const rows: [string, string][] = [
    ["Business", String(brief.business_name ?? gen.business_name ?? "")],
    ["Template", gen.template_name ?? gen.template_id],
    ["Pages", gen.requested_pages.join(", ")],
    ["Services", Array.isArray(brief.services) ? (brief.services as string[]).join(", ") : ""],
    ["Areas", Array.isArray(brief.service_areas) ? (brief.service_areas as string[]).join(", ") : ""],
    ["Exclude people in photos", gen.options?.exclude_people === false ? "No" : "Yes"],
  ];
  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-text-faint">Run setup (frozen at creation)</h2>
      <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex gap-2 text-sm">
            <dt className="w-44 shrink-0 text-text-muted">{k}</dt>
            <dd className="text-text">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
