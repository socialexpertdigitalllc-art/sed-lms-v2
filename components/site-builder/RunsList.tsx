"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Rocket } from "lucide-react";
import { EmptyPanel, PageHeader, Pill, type PillTone } from "@/components/common/Panel";
import { btnPrimary } from "@/components/common/buttons";
import { RelativeTime } from "@/components/common/RelativeTime";

type BuilderRunStatus = "queued" | "generating" | "review" | "approved" | "deployed" | "failed";

interface RunListRow {
  id: string;
  lead_id: string | null;
  template_id: string;
  status: BuilderRunStatus;
  created_at: string;
  updated_at: string;
  leads: { business_name: string } | null;
}

const STATUS_PILL: Record<BuilderRunStatus, { tone: PillTone; label: string }> = {
  queued: { tone: "neutral", label: "Queued" },
  generating: { tone: "accent", label: "Generating" },
  review: { tone: "notready", label: "Awaiting review" },
  approved: { tone: "accent", label: "Approved" },
  deployed: { tone: "ready", label: "Deployed" },
  failed: { tone: "dropped", label: "Failed" },
};

/** Every Site Builder run, newest first — how the operator gets back to a
 *  run they navigated away from mid-generation, or one already deployed. */
export function RunsList() {
  const router = useRouter();
  const [rows, setRows] = useState<RunListRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/site-builder/runs");
      const body = await res.json().catch(() => ({}));
      setRows((body.runs ?? []) as RunListRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const empty = useMemo(() => !loading && rows.length === 0, [loading, rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Site Builder runs"
        description="Every site generated from a template, from first draft to deployed."
        action={
          <Link href="/ai-tools/site-builder/new" className={btnPrimary}>
            <Plus className="h-4 w-4" /> New site
          </Link>
        }
      />

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading runs…
        </div>
      ) : empty ? (
        <EmptyPanel icon={Rocket} title="No runs yet" hint="Start a new site to generate your first run." />
      ) : (
        <div className="overflow-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-faint">
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pill = STATUS_PILL[r.status];
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2"
                    onClick={() => router.push(`/ai-tools/site-builder/runs/${r.id}`)}
                  >
                    <td className="px-3 py-2 text-text">{r.leads?.business_name ?? "—"}</td>
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
    </div>
  );
}
