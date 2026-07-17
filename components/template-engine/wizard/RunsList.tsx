"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { RelativeTime } from "@/components/common/RelativeTime";
import { EmptyState } from "@/components/common/EmptyState";
import { TableSkeleton } from "@/components/common/TableSkeleton";
import { statusPill } from "@/lib/template-engine/wizard";
import { cn } from "@/lib/utils";

type Row = {
  id: string; status: string; created_at: string; pages_built: number;
  deployed_url: string | null; error: string | null;
  template_name: string | null; business_name: string | null;
};

export function RunsList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [rtTick, setRtTick] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/template-engine/generations");
        if (res.ok) setRows((await res.json()).generations ?? []);
        else setRows((prev) => prev ?? []);
      } catch {
        // First load: end the skeleton; refetch: keep the rows we have.
        setRows((prev) => prev ?? []);
      }
    })();
  }, [rtTick]);

  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const channel = supabase.channel("rt-tge-runs");
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "template_generations" }, () => {
          if (t) clearTimeout(t);
          t = setTimeout(() => setRtTick((n) => n + 1), 400);
        })
        .subscribe();
    })();
    return () => { cancelled = true; if (t) clearTimeout(t); supabase.removeChannel(channel); };
  }, []);

  if (rows === null) return <TableSkeleton rows={5} cols={4} toolbar={false} />;
  if (rows.length === 0) return <EmptyState icon={History} title="No generations yet" hint="Start one above — it takes about ten minutes end to end." />;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-[10px] uppercase tracking-wider text-text-faint">
            <th className="px-4 py-2.5 font-semibold">Business</th>
            <th className="px-4 py-2.5 font-semibold">Template</th>
            <th className="px-4 py-2.5 font-semibold">Status</th>
            <th className="px-4 py-2.5 font-semibold">Started</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pill = statusPill(r.status);
            return (
              <tr key={r.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-2">
                <td className="px-4 py-2.5">
                  <Link href={`/ai-tools/template-engine/${r.id}`} className="font-medium text-text hover:text-accent-ink">
                    {r.business_name ?? "—"}
                  </Link>
                  {r.error ? <p className="mt-0.5 max-w-md truncate text-xs text-dropped-fg">{r.error}</p> : null}
                </td>
                <td className="px-4 py-2.5 text-text-muted">{r.template_name ?? "—"}</td>
                <td className="px-4 py-2.5"><span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", pill.cls)}>{pill.label}</span></td>
                <td className="px-4 py-2.5 text-text-muted"><RelativeTime iso={r.created_at} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
