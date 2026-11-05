"use client";

import { useCallback, useMemo, type ComponentProps } from "react";
import { DashboardBoard } from "./DashboardBoard";
import { LiveLeadsGate, LiveLoadFailed } from "@/components/leads/LiveLeads";
import { buildRegionFacets } from "@/lib/geo/regions";
import DashboardLoading from "@/app/(app)/dashboard/loading";
import { useLiveFollowUps } from "@/hooks/useLiveLeads";
import { useTickRefetch } from "@/hooks/useTickRefetch";
import { createClient } from "@/lib/supabase/client";
import type { Lead } from "@/lib/leads/types";

type BoardProps = Omit<ComponentProps<typeof DashboardBoard>, "leads" | "facets" | "followUps">;
type TicketRow = BoardProps["tickets"][number];

/** The ticket columns the dashboard reads (same as the page's server read). */
const TICKET_SELECT = "status, due_date, created_at, resolved_at, lead_id";

function Board({ leads, tickets: serverTickets, ...props }: BoardProps & { leads: Lead[] }) {
  // Region facets follow the live leads (they were computed on the server).
  const facets = useMemo(() => buildRegionFacets(leads), [leads]);
  // Follow-ups: the live, only-what-changed copy (2,400+ rows were read on
  // every visit before). Tickets: a small table, re-read when one changes.
  const fu = useLiveFollowUps();
  const loadTickets = useCallback(async (): Promise<TicketRow[]> => {
    const { data, error } = await createClient().from("lead_tickets").select(TICKET_SELECT);
    if (error) throw new Error(error.message);
    return (data ?? []) as TicketRow[];
  }, []);
  const tickets = useTickRefetch("lead_tickets", serverTickets, loadTickets);

  if (fu.status === "error") return <LiveLoadFailed error={fu.error} retry={fu.retry} />;
  if (fu.status !== "ready") return <DashboardLoading />;
  return <DashboardBoard {...props} leads={leads} facets={facets} followUps={fu.leads} tickets={tickets} />;
}

/**
 * The dashboard on the live stores: lead numbers, follow-up numbers and
 * ticket numbers all change by themselves when anyone changes something —
 * the dashboard used to have no live updates at all, and read every lead and
 * every follow-up on every visit.
 */
export function LiveDashboardBoard(props: BoardProps) {
  return (
    <LiveLeadsGate loading={<DashboardLoading />}>
      {(leads) => <Board {...props} leads={leads} />}
    </LiveLeadsGate>
  );
}
