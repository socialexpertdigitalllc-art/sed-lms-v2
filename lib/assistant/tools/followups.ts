import { leadRegion } from "@/lib/geo/regions";
import {
  followUpTotals,
  FU_GROUP_BYS,
  groupFollowUps,
  pickupPatterns,
  touchesBeforeClose,
  type FuGroupBy,
} from "../analytics";
import { boolArg, canonical, localStamp, PERIOD_PROPERTIES, periodFrom, resolveUser } from "./filters";
import { leadScopeLine } from "./leads";
import type { AssistantTool } from "./types";

/**
 * Calling behaviour: how many follow-up calls were logged, how many were
 * answered, and WHEN calls get answered — by the hour and weekday at the
 * lead's own location, which is the pattern an agent calling US businesses
 * from another timezone can actually act on.
 */
export const analyzeFollowUpsTool: AssistantTool = {
  name: "analyze_follow_ups",
  label: "Analysing follow-up calls",
  description:
    "Follow-up call analytics for the leads the user can see, over a period of call dates (default: the last 30 days): calls logged, pickups, pickup rate; optionally grouped (by day/week/month, by agent who made the call, by the hour or weekday AT THE LEAD's own timezone, by company-clock hour or weekday, by the lead's current status or state). Also returns pickup patterns (best and worst hours and weekdays at the lead), how many calls closed leads took before closing, and open Ready leads stuck on long no-pickup streaks.",
  parameters: {
    type: "object",
    properties: {
      ...PERIOD_PROPERTIES,
      agent: { type: "string", description: "Only calls made by this person (name, or \"me\")." },
      group_by: { type: "string", enum: [...FU_GROUP_BYS], description: "Optional grouping of the calls." },
      include_patterns: { type: "boolean", description: "Include best/worst calling times and the extra analyses (default true)." },
    },
  },
  available: (perms) => perms.has("leads.view"),
  async run(args, ctx) {
    const period = periodFrom({ from: args.from as string | undefined, to: args.to as string | undefined }, ctx, 30);
    const [allCalls, leads, agentName] = await Promise.all([ctx.data.followUps(period), ctx.data.leads(), ctx.data.names()]);
    const leadById = new Map(leads.map((l) => [l.id, l]));
    let calls = allCalls;
    const applied: Record<string, unknown> = period ? { from: period.from, to: period.to, timezone: ctx.timezone } : { period: "all time" };
    let agentId: string | null = null;
    if (typeof args.agent === "string" && args.agent.trim()) {
      const who = await resolveUser(args.agent, ctx);
      agentId = who.id;
      calls = calls.filter((c) => c.user_id === who.id);
      applied.made_by = who.name;
    }

    const fuCtx = { tz: ctx.timezone, leadById, agentName };
    const totals = followUpTotals(calls);
    const data: Record<string, unknown> = { visible_scope: await leadScopeLine(ctx), filters: applied, totals };

    if (typeof args.group_by === "string") {
      const by = canonical(args.group_by, FU_GROUP_BYS, "group_by") as FuGroupBy;
      const grouped = groupFollowUps(calls, by, fuCtx);
      data.group_by = by;
      data.groups = grouped.rows.slice(0, 60);
      if (grouped.unplaced) data.ungrouped_calls = `${grouped.unplaced} calls are on leads whose timezone is unknown (no US area code or state), so they are not in the groups.`;
    }

    if (boolArg(args.include_patterns, true)) {
      data.pickup_patterns = pickupPatterns(calls, fuCtx);

      // Touches before close, over leads that closed inside the same window —
      // the agent's own leads when the question is about one agent.
      const closedScoped = leads.filter((l) => {
        if (!l.closed_at) return false;
        if (agentId && l.agent_id !== agentId) return false;
        if (!period) return true;
        const t = new Date(l.closed_at).getTime();
        return t >= period.fromMs && t < period.toExMs;
      });
      if (closedScoped.length) {
        const history = await ctx.data.followUpsForLeads(closedScoped.slice(0, 600).map((l) => l.id));
        data.calls_before_close = touchesBeforeClose(closedScoped.slice(0, 600), history);
      }

      const stuck = leads
        .filter((l) => l.status === "Ready" && (l.no_pickup_streak ?? 0) >= 3 && (!agentId || l.agent_id === agentId))
        .sort((a, b) => (b.no_pickup_streak ?? 0) - (a.no_pickup_streak ?? 0));
      data.ready_leads_on_no_pickup_streaks = {
        count: stuck.length,
        worst: stuck.slice(0, 10).map((l) => ({
          id: l.id,
          business_name: l.business_name,
          agent: agentName(l.agent_id),
          region: leadRegion(l),
          unanswered_in_a_row: l.no_pickup_streak,
          next_follow_up: localStamp(l.follow_up_time, ctx.timezone),
          link: `/leads/${l.id}`,
        })),
      };
    }

    return {
      data,
      summary: `${totals.logged} calls · ${totals.pickup_rate_pct ?? 0}% picked up`,
    };
  },
};
