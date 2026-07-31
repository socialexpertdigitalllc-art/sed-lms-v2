import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead } from "@/lib/leads/types";
import { summarize, type SessionRow } from "@/lib/signin/analytics";
import {
  computeWindowMetrics,
  regionRows,
  windowFor,
  type ContractLite,
  type FollowUpRow,
  type RegionRow,
  type ReportWindow,
  type WindowMetrics,
} from "@/lib/reports/agentPeriodicMath";

export interface AgentPeriodicReport {
  agent: { id: string; name: string; active: boolean };
  period: { from: string; to: string };
  metrics: { agent: WindowMetrics; team: WindowMetrics; prev: WindowMetrics };
  regions: { agent: RegionRow[]; team: RegionRow[] };
  generation: { ai: number; template: number; studio: number; builder: number; total: number };
  attendance: { days: number; totalHours: number; avgLateMinutes: number } | null;
}

const iso = (msVal: number) => new Date(msVal).toISOString();

async function generationCount(
  admin: SupabaseClient,
  table: string,
  col: "created_by" | "agent_id",
  agentId: string,
  w: ReportWindow
): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(col, agentId)
    .gte("created_at", iso(w.fromMs))
    .lt("created_at", iso(w.toExMs));
  if (error) console.error(`[agentPeriodic] ${table} count failed:`, error.message);
  return count ?? 0;
}

export async function buildAgentPeriodicReport(
  admin: SupabaseClient,
  opts: { agentId: string; from: string; to: string; includeAttendance: boolean }
): Promise<AgentPeriodicReport | null> {
  const w = windowFor(opts.from, opts.to);

  const [
    { data: profile },
    { data: leadsData, error: leadsError },
    { data: fuData },
    { data: contractsData },
    { data: approxData },
  ] =
    await Promise.all([
      admin.from("profiles").select("id, display_name, is_active").eq("id", opts.agentId).maybeSingle(),
      admin
        .from("leads")
        .select(
          "id, agent_id, status, business_phone, price_quoted, yearly_price, created_at, closed_at, dropped_at, first_touch_at"
        )
        .is("deleted_at", null)
        .not("agent_id", "is", null),
      admin
        .from("lead_follow_ups")
        .select("user_id, fu_status, created_at")
        .gte("created_at", iso(w.prev.fromMs))
        .lt("created_at", iso(w.toExMs)),
      admin
        .from("contracts")
        .select("created_by, sent_at")
        .not("sent_at", "is", null)
        .gte("sent_at", iso(w.prev.fromMs))
        .lt("sent_at", iso(w.toExMs)),
      admin.from("lead_status_events").select("lead_id").eq("source", "backfill_approx"),
    ]);
  if (!profile) return null;
  if (leadsError) throw new Error(`leads fetch failed: ${leadsError.message}`);

  const leads = (leadsData ?? []) as Lead[];
  const followUps = (fuData ?? []) as FollowUpRow[];
  const contracts = (contractsData ?? []) as ContractLite[];
  const approxIds = new Set((approxData ?? []).map((r) => r.lead_id as string));

  const agentLeads = leads.filter((l) => l.agent_id === opts.agentId);
  const agentFu = followUps.filter((f) => f.user_id === opts.agentId);
  const agentContracts = contracts.filter((c) => c.created_by === opts.agentId);

  const [ai, template, studio, builder] = await Promise.all([
    generationCount(admin, "ai_generations", "agent_id", opts.agentId, w),
    generationCount(admin, "template_generations", "created_by", opts.agentId, w),
    generationCount(admin, "studio_runs", "created_by", opts.agentId, w),
    generationCount(admin, "builder_runs", "created_by", opts.agentId, w),
  ]);

  let attendance: AgentPeriodicReport["attendance"] = null;
  if (opts.includeAttendance) {
    const [{ data: settings }, { data: sessions }] = await Promise.all([
      admin.from("app_settings").select("work_start_time, work_timezone").limit(1).maybeSingle(),
      admin
        .from("user_sessions")
        .select("user_id, signed_in_at, signed_out_at, last_seen_at")
        .eq("user_id", opts.agentId)
        .gte("signed_in_at", iso(w.fromMs))
        .lt("signed_in_at", iso(w.toExMs)),
    ]);
    const { perUserDay } = summarize((sessions ?? []) as SessionRow[], {
      tz: settings?.work_timezone ?? "Asia/Karachi",
      workStart: (settings?.work_start_time ?? "09:00").slice(0, 5),
      now: new Date(w.toExMs),
    });
    const days = perUserDay.filter((d) => d.userId === opts.agentId);
    attendance = {
      days: days.length,
      totalHours: days.reduce((s, d) => s + d.hours, 0),
      avgLateMinutes: days.length ? days.reduce((s, d) => s + d.lateMinutes, 0) / days.length : 0,
    };
  }

  return {
    agent: {
      id: profile.id,
      name: (profile.display_name as string | null) ?? "—",
      active: (profile.is_active as boolean | null) ?? true,
    },
    period: { from: opts.from, to: opts.to },
    metrics: {
      agent: computeWindowMetrics(agentLeads, agentFu, agentContracts, w, approxIds),
      team: computeWindowMetrics(leads, followUps, contracts, w, approxIds),
      prev: computeWindowMetrics(agentLeads, agentFu, agentContracts, w.prev, approxIds),
    },
    regions: { agent: regionRows(agentLeads, w), team: regionRows(leads, w) },
    generation: { ai, template, studio, builder, total: ai + template + studio + builder },
    attendance,
  };
}
