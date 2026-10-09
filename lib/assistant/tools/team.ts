import { computeWindowMetrics, type ContractLite, type WindowMetrics } from "@/lib/reports/agentPeriodicMath";
import { summarize, type SessionRow } from "@/lib/signin/analytics";
import { getAppSettings } from "@/lib/settings/appSettings";
import { round } from "../analytics";
import { localDateKey, periodFor, previousPeriod, type Period } from "../dates";
import { fetchAll } from "./data";
import { boolArg, canonical, intArg, localStamp, PERIOD_PROPERTIES, periodFrom, resolveUser } from "./filters";
import { leadScopeLine } from "./leads";
import { ToolError, type AssistantTool, type ToolContext } from "./types";

const iso = (ms: number) => new Date(ms).toISOString();

/** The current month so far, in the company timezone. */
function monthToDate(ctx: ToolContext): Period {
  const today = localDateKey(ctx.now, ctx.timezone);
  return periodFor(`${today.slice(0, 8)}01`, today, ctx.timezone);
}

interface AttendanceRow {
  user: string;
  days_present: number;
  total_hours: number;
  avg_hours_per_day: number | null;
  avg_minutes_late: number | null;
}

/** Sign-in attendance per user over the period — the Activity Log's own math. */
async function attendance(ctx: ToolContext, period: Period, onlyUser: string | null) {
  const settings = await getAppSettings();
  const sessions = await fetchAll<SessionRow>((from, to) => {
    let q = ctx.admin
      .from("user_sessions")
      .select("user_id, signed_in_at, signed_out_at, last_seen_at")
      .gte("signed_in_at", iso(period.fromMs))
      .lt("signed_in_at", iso(period.toExMs));
    if (onlyUser) q = q.eq("user_id", onlyUser);
    return q.order("signed_in_at", { ascending: true }).range(from, to);
  });
  const { perUserDay, online } = summarize(sessions, {
    tz: settings.work_timezone,
    workStart: (settings.work_start_time ?? "09:00").slice(0, 5),
    now: ctx.now,
    idleMin: settings.idle_timeout_minutes,
  });
  const name = await ctx.data.names();
  const byUser = new Map<string, { days: number; hours: number; late: number }>();
  for (const d of perUserDay) {
    const agg = byUser.get(d.userId) ?? { days: 0, hours: 0, late: 0 };
    agg.days++;
    agg.hours += d.hours;
    agg.late += d.lateMinutes;
    byUser.set(d.userId, agg);
  }
  const rows: AttendanceRow[] = [...byUser.entries()]
    .map(([id, a]) => ({
      user: name(id),
      days_present: a.days,
      total_hours: round(a.hours, 1) ?? 0,
      avg_hours_per_day: round(a.hours / a.days, 1),
      avg_minutes_late: round(a.late / a.days, 0),
    }))
    .sort((a, b) => b.total_hours - a.total_hours);
  return {
    work_day_starts: (settings.work_start_time ?? "09:00").slice(0, 5),
    timezone: settings.work_timezone,
    rows,
    online_now: online.map((o) => ({ user: name(o.userId), since: localStamp(o.since, ctx.timezone) })),
  };
}

/* ------------------------------------------------------- team performance */

const PERF_SORTS = ["closed", "closed_revenue", "close_rate", "arrived", "pickup_rate", "follow_ups"] as const;

function agentRow(name: string, m: WindowMetrics, prev: WindowMetrics) {
  return {
    agent: name,
    new_leads: m.arrived,
    closed: m.closedCount,
    dropped: m.droppedCount,
    close_rate_pct: round(m.closeRatio, 1),
    closed_revenue: round(m.closedRevenue, 2),
    recurring_revenue: round(m.recurringRevenue, 2),
    avg_closed_deal: round(m.avgDealSize, 2),
    median_days_to_close: round(m.medianCloseDays, 1),
    avg_hours_to_first_call: round(m.avgFirstTouchHours, 1),
    follow_up_calls: m.followUpsLogged,
    pickup_rate_pct: round(m.pickupRate, 1),
    contracts_sent: m.contractsSent,
    open_leads_at_period_end: m.openAtEnd,
    open_lead_age: { "0_7_days": m.openAging.d0_7, "8_30_days": m.openAging.d8_30, "over_30_days": m.openAging.d30p },
    fast_drops_within_7_days: m.fastDrops,
    previous_period: {
      closed: prev.closedCount,
      close_rate_pct: round(prev.closeRatio, 1),
      closed_revenue: round(prev.closedRevenue, 2),
      follow_up_calls: prev.followUpsLogged,
    },
  };
}

export const teamPerformanceTool: AssistantTool = {
  name: "get_team_performance",
  label: "Comparing agents",
  description:
    "Per-agent performance over a period (default: this month so far), side by side with the previous equal-length period: new leads, closed, dropped, close rate, closed and recurring revenue, average deal, median days to close, hours to first call, follow-up calls and pickup rate, contracts sent, open leads and how old they are, fast drops. Includes a team total. Only agents whose leads the user can see appear. With include_attendance (admins/managers with the activity log), adds days present, hours and lateness from sign-in sessions.",
  parameters: {
    type: "object",
    properties: {
      ...PERIOD_PROPERTIES,
      agent: { type: "string", description: "Only this agent (name, or \"me\")." },
      sort_by: { type: "string", enum: [...PERF_SORTS], description: "Ranking (default closed)." },
      include_attendance: { type: "boolean", description: "Add sign-in attendance per agent (needs activity-log access)." },
      limit: { type: "integer", minimum: 1, maximum: 50, description: "Most agents to return (default 25)." },
    },
  },
  available: (perms) =>
    perms.has("analytics.by_agent") || perms.has("analytics.view_all_agents") || perms.has("reports.agent_periodic"),
  async run(args, ctx) {
    const period =
      periodFrom({ from: args.from as string | undefined, to: args.to as string | undefined }, ctx, "all") ?? monthToDate(ctx);
    const prev = previousPeriod(period, ctx.timezone);
    const w = { fromMs: period.fromMs, toExMs: period.toExMs };
    const pw = { fromMs: prev.fromMs, toExMs: prev.toExMs };
    const span = periodFor(prev.from, period.to, ctx.timezone);

    const canSeeContracts = ctx.perms.has("contracts.view") || ctx.perms.has("contracts.send");
    const [leads, calls, name, contracts] = await Promise.all([
      ctx.data.leads(),
      ctx.data.followUps(span),
      ctx.data.names(),
      canSeeContracts
        ? fetchAll<ContractLite>((from, to) =>
            ctx.db
              .from("contracts")
              .select("id, created_by, sent_at")
              .not("sent_at", "is", null)
              .gte("sent_at", iso(span.fromMs))
              .lt("sent_at", iso(span.toExMs))
              .order("sent_at", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to),
          )
        : Promise.resolve([] as ContractLite[]),
    ]);

    let agentIds = new Set<string>();
    for (const l of leads) if (l.agent_id) agentIds.add(l.agent_id);
    for (const c of calls) if (c.user_id) agentIds.add(c.user_id);
    if (typeof args.agent === "string" && args.agent.trim()) {
      const who = await resolveUser(args.agent, ctx);
      agentIds = new Set(agentIds.has(who.id) ? [who.id] : []);
      if (!agentIds.size) throw new ToolError(`None of ${who.name}'s leads or calls are visible to you.`);
    }

    const none = new Set<string>();
    const rows = [...agentIds]
      .map((id) => {
        const own = leads.filter((l) => l.agent_id === id);
        const fu = calls.filter((c) => c.user_id === id);
        const ct = contracts.filter((c) => c.created_by === id);
        return {
          id,
          m: computeWindowMetrics(own, fu, ct, w, none),
          p: computeWindowMetrics(own, fu, ct, pw, none),
        };
      })
      .filter(({ m, p }) => m.arrived + m.closedCount + m.droppedCount + m.followUpsLogged + m.contractsSent + p.closedCount > 0);

    const sort = typeof args.sort_by === "string" ? canonical(args.sort_by, PERF_SORTS, "sort_by") : "closed";
    const key = (m: WindowMetrics): number => {
      switch (sort) {
        case "closed_revenue":
          return m.closedRevenue;
        case "close_rate":
          return m.closeRatio ?? -1;
        case "arrived":
          return m.arrived;
        case "pickup_rate":
          return m.pickupRate ?? -1;
        case "follow_ups":
          return m.followUpsLogged;
        default:
          return m.closedCount;
      }
    };
    rows.sort((a, b) => key(b.m) - key(a.m) || b.m.closedRevenue - a.m.closedRevenue);
    const limit = intArg(args.limit, 25, 1, 50);

    const team = computeWindowMetrics(leads, calls, contracts, w, none);
    const teamPrev = computeWindowMetrics(leads, calls, contracts, pw, none);
    const data: Record<string, unknown> = {
      visible_scope: await leadScopeLine(ctx),
      period: { from: period.from, to: period.to, timezone: ctx.timezone },
      previous_period: { from: prev.from, to: prev.to },
      definitions:
        "new_leads = created in the period; closed/dropped = closed or dropped in the period (whenever created); close_rate = closed ÷ (closed + dropped); follow_up_calls and pickup_rate count calls MADE by the agent.",
      team_total: agentRow("Everyone visible", team, teamPrev),
      agents: rows.slice(0, limit).map(({ id, m, p }) => agentRow(name(id), m, p)),
    };
    if (!canSeeContracts) data.contracts_note = "Contract counts are 0 because this user cannot view contracts.";
    if (rows.length > limit) data.truncated = `Showing ${limit} of ${rows.length} agents.`;

    if (boolArg(args.include_attendance, false)) {
      if (!ctx.perms.has("admin.logs.view")) {
        data.attendance = "Not available: attendance needs access to the Activity Log.";
      } else {
        const att = await attendance(ctx, period, rows.length === 1 ? rows[0].id : null);
        data.attendance = att.rows;
      }
    }

    const best = rows[0];
    return {
      data,
      summary: `${rows.length} agent${rows.length === 1 ? "" : "s"} · ${team.closedCount} closed${best ? ` · top: ${name(best.id)}` : ""}`,
    };
  },
};

/* ---------------------------------------------------------- team activity */

const ACTIVITY_PARTS = ["attendance", "audit", "usage"] as const;

export const teamActivityTool: AssistantTool = {
  name: "get_team_activity",
  label: "Reading the activity log",
  description:
    "What everyone has been doing in the app over a period (default: the last 7 days) — ADMIN-LEVEL, from the Activity Log: attendance from sign-in sessions (days present, hours, minutes late, who is online now), the audit trail of changes (actions per person: lead edits, status changes, assignments…), and app usage (page views and clicks per person, most-used pages). Optionally for one person only.",
  parameters: {
    type: "object",
    properties: {
      ...PERIOD_PROPERTIES,
      user: { type: "string", description: "Only this person (name, or \"me\")." },
      include: {
        type: "array",
        items: { type: "string", enum: [...ACTIVITY_PARTS] },
        description: "Which sections to include (default all three).",
      },
    },
  },
  available: (perms) => perms.has("admin.logs.view"),
  async run(args, ctx) {
    const period = periodFrom({ from: args.from as string | undefined, to: args.to as string | undefined }, ctx, 7)!;
    const include = new Set(
      Array.isArray(args.include) && args.include.length
        ? args.include.filter((x): x is string => typeof x === "string").map((x) => canonical(x, ACTIVITY_PARTS, "include"))
        : ACTIVITY_PARTS,
    );
    let userId: string | null = null;
    const applied: Record<string, unknown> = { from: period.from, to: period.to, timezone: ctx.timezone };
    if (typeof args.user === "string" && args.user.trim()) {
      const who = await resolveUser(args.user, ctx);
      userId = who.id;
      applied.user = who.name;
    }
    const name = await ctx.data.names();
    const data: Record<string, unknown> = { filters: applied };

    if (include.has("attendance")) data.attendance = await attendance(ctx, period, userId);

    if (include.has("audit")) {
      // Same source and access as the Activity Log page (service role behind
      // admin.logs.view). Capped: a busy fortnight is tens of thousands of rows.
      const rows = await fetchAll<{ user_id: string | null; action: string }>((from, to) => {
        let q = ctx.admin
          .from("activity_log")
          .select("id, user_id, action")
          .gte("created_at", iso(period.fromMs))
          .lt("created_at", iso(period.toExMs));
        if (userId) q = q.eq("user_id", userId);
        return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
      });
      const byUser = new Map<string, Map<string, number>>();
      for (const r of rows) {
        const u = name(r.user_id);
        const m = byUser.get(u) ?? new Map<string, number>();
        m.set(r.action, (m.get(r.action) ?? 0) + 1);
        byUser.set(u, m);
      }
      data.audit = {
        total_changes: rows.length,
        by_person: [...byUser.entries()]
          .map(([user, m]) => ({
            user,
            total: [...m.values()].reduce((s, n) => s + n, 0),
            top_actions: Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)),
          }))
          .sort((a, b) => b.total - a.total),
      };
    }

    if (include.has("usage")) {
      const rows = await fetchAll<{ user_id: string | null; type: string; path: string | null }>((from, to) => {
        let q = ctx.admin
          .from("user_activity")
          .select("id, user_id, type, path")
          .gte("created_at", iso(period.fromMs))
          .lt("created_at", iso(period.toExMs));
        if (userId) q = q.eq("user_id", userId);
        return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
      });
      const section = (p: string | null) => (p ? `/${p.split("?")[0].split("/").filter(Boolean).slice(0, 2).join("/")}` : "(unknown)");
      const perUser = new Map<string, { views: number; clicks: number; pages: Map<string, number> }>();
      const pages = new Map<string, number>();
      for (const r of rows) {
        const u = name(r.user_id);
        const agg = perUser.get(u) ?? { views: 0, clicks: 0, pages: new Map<string, number>() };
        if (r.type === "page_view") {
          agg.views++;
          const s = section(r.path);
          agg.pages.set(s, (agg.pages.get(s) ?? 0) + 1);
          pages.set(s, (pages.get(s) ?? 0) + 1);
        } else if (r.type === "click") agg.clicks++;
        perUser.set(u, agg);
      }
      data.usage = {
        most_used_sections: [...pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([path, views]) => ({ path, views })),
        by_person: [...perUser.entries()]
          .map(([user, a]) => ({
            user,
            page_views: a.views,
            clicks: a.clicks,
            top_sections: [...a.pages.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([p]) => p),
          }))
          .sort((a, b) => b.page_views - a.page_views),
      };
    }

    const att = data.attendance as { rows: AttendanceRow[]; online_now: unknown[] } | undefined;
    return {
      data,
      summary: att ? `${att.rows.length} people active · ${att.online_now.length} online now` : `Activity ${period.from} → ${period.to}`,
    };
  },
};
