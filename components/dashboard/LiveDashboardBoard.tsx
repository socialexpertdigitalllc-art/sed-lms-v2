"use client";

import { useMemo, type ComponentProps } from "react";
import { DashboardBoard } from "./DashboardBoard";
import { LiveLeadsGate } from "@/components/leads/LiveLeads";
import { buildRegionFacets } from "@/lib/geo/regions";
import DashboardLoading from "@/app/(app)/dashboard/loading";
import type { Lead } from "@/lib/leads/types";

type BoardProps = Omit<ComponentProps<typeof DashboardBoard>, "leads" | "facets">;

function Board({ leads, ...props }: BoardProps & { leads: Lead[] }) {
  // Region facets follow the live leads (they were computed on the server).
  const facets = useMemo(() => buildRegionFacets(leads), [leads]);
  return <DashboardBoard {...props} leads={leads} facets={facets} />;
}

/**
 * The dashboard on the live leads store: its numbers come from the browser's
 * copy and change by themselves when anyone changes a lead — the dashboard
 * used to have no live updates at all, and read every lead on every visit.
 */
export function LiveDashboardBoard(props: BoardProps) {
  return (
    <LiveLeadsGate loading={<DashboardLoading />}>
      {(leads) => <Board {...props} leads={leads} />}
    </LiveLeadsGate>
  );
}
