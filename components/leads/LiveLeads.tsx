"use client";

import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useLiveLeads } from "@/hooks/useLiveLeads";
import { TableSkeleton } from "@/components/common/TableSkeleton";
import { Skeleton } from "@/components/common/Skeleton";
import { LeadsTable } from "./LeadsTable";
import { FollowUpQueue } from "./FollowUpQueue";
import type { Lead } from "@/lib/leads/types";

/**
 * The leads screens, fed by the live leads store (hooks/useLiveLeads.ts)
 * instead of a full server read on every visit and every change. The page
 * sends only the small things (names, tags, permissions); the leads come from
 * the browser's copy and stay current by themselves.
 */

function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading leads">
      <div className="mb-4">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-32 mt-1.5" />
      </div>
      <TableSkeleton rows={10} cols={7} />
    </div>
  );
}

function Failed({ error, retry }: { error: string | null; retry: () => void }) {
  return (
    <div role="alert" className="bg-surface border border-border rounded-lg p-8 text-center">
      <AlertTriangle className="w-6 h-6 mx-auto text-dropped-fg" />
      <div className="mt-2 text-sm font-medium text-text">Couldn&apos;t load the leads</div>
      {error && <div className="mt-1 text-xs text-text-muted break-words">{error}</div>}
      <button
        type="button"
        onClick={retry}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-2"
      >
        <RefreshCw className="w-4 h-4" /> Try again
      </button>
    </div>
  );
}

/** Renders `children(leads)` once the live copy has data; a skeleton or a retry before. */
export function LiveLeadsGate({ children, loading }: { children: (leads: Lead[]) => ReactNode; loading?: ReactNode }) {
  const { status, leads, error, retry } = useLiveLeads();
  if (status === "error") return <Failed error={error} retry={retry} />;
  if (status !== "ready") return <>{loading ?? <Loading />}</>;
  return <>{children(leads)}</>;
}

export function LiveLeadsTable(props: Omit<ComponentProps<typeof LeadsTable>, "leads">) {
  return <LiveLeadsGate>{(leads) => <LeadsTable {...props} leads={leads} />}</LiveLeadsGate>;
}

export function LiveFollowUpQueue(props: Omit<ComponentProps<typeof FollowUpQueue>, "leads">) {
  return <LiveLeadsGate>{(leads) => <FollowUpQueue {...props} leads={leads} />}</LiveLeadsGate>;
}
