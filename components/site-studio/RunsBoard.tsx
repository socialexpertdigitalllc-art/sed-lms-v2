"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus, Rocket } from "lucide-react";
import { EmptyPanel, PageHeader, Pill } from "@/components/common/Panel";
import { btnPrimary } from "@/components/common/buttons";
import { RelativeTime } from "@/components/common/RelativeTime";
import { runStatusPill } from "@/lib/site-studio/ui/status";
import type { RunStatus } from "@/lib/site-studio/run/types";
import { RunLaunch } from "@/components/site-studio/RunLaunch";

interface RunListRow {
  id: string;
  lead_id: string | null;
  template_id: string;
  template_version: number;
  status: RunStatus;
  created_at: string;
  updated_at: string;
  leads: { business_name: string } | null;
}

interface TemplateOption { id: string; name: string; }

export function RunsBoard() {
  const router = useRouter();
  // Arriving here via a lead's "Generate from template" link (?lead=<id>)
  // opens the launcher straight away, preselected — see RunLaunch.
  const leadParam = useSearchParams().get("lead");
  const [rows, setRows] = useState<RunListRow[]>([]);
  const [templateNames, setTemplateNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(() => Boolean(leadParam));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [runsRes, templatesRes] = await Promise.all([
        fetch("/api/site-studio/runs"),
        fetch("/api/site-studio/templates"),
      ]);
      const runsBody = await runsRes.json().catch(() => ({}));
      const templatesBody = await templatesRes.json().catch(() => ({}));
      setRows((runsBody.runs ?? []) as RunListRow[]);
      const names: Record<string, string> = {};
      for (const t of (templatesBody.templates ?? []) as TemplateOption[]) names[t.id] = t.name;
      setTemplateNames(names);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const empty = useMemo(() => !loading && rows.length === 0, [loading, rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generation runs"
        description="Launch a certified template against a lead, review Gate 1, and download the finished site."
        action={
          <button className={btnPrimary} onClick={() => setLaunching(true)}>
            <Plus className="h-4 w-4" /> New run
          </button>
        }
      />

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading runs…
        </div>
      ) : empty ? (
        <EmptyPanel
          icon={Rocket}
          title="No runs yet"
          hint="Start a run above to generate your first client site."
        />
      ) : (
        <div className="overflow-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-faint">
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Template</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pill = runStatusPill(r.status);
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                    onClick={() => router.push(`/ai-tools/site-studio/runs/${r.id}`)}
                  >
                    <td className="px-3 py-2 text-text">{r.leads?.business_name ?? "—"}</td>
                    <td className="px-3 py-2 text-text-muted">{templateNames[r.template_id] ?? r.template_id}</td>
                    <td className="px-3 py-2"><Pill tone={pill.tone}>{pill.label}</Pill></td>
                    <td className="px-3 py-2 text-text-muted"><RelativeTime iso={r.created_at} /></td>
                    <td className="px-3 py-2 text-text-muted"><RelativeTime iso={r.updated_at} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {launching ? (
        <RunLaunch
          initialLeadId={leadParam}
          onClose={() => setLaunching(false)}
          onCreated={(id) => {
            setLaunching(false);
            router.push(`/ai-tools/site-studio/runs/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}
