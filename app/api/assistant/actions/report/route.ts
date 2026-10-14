import { NextResponse } from "next/server";
import { actionError, actionGuard } from "@/lib/assistant/actions/http";
import { getActionDef } from "@/lib/assistant/actions/registry";
import { listActions } from "@/lib/assistant/actions/store";
import type { StoredAction } from "@/lib/assistant/actions/types";

export const runtime = "nodejs";

/**
 * What SED AI did for the team over a period: how much, by whom, which
 * actions, what failed — and roughly how much time it saved. For people who
 * manage SED AI actions.
 */

export interface ActionReport {
  from: string;
  to: string;
  totals: Record<StoredAction["status"] | "all", number>;
  minutesSaved: number;
  byAction: { key: string; title: string; total: number; done: number; failed: number; minutesSaved: number }[];
  byPerson: { id: string; name: string; total: number; done: number; minutesSaved: number }[];
  bySource: Record<string, number>;
  recentFailures: { id: string; title: string; error: string | null; who: string; at: string }[];
  waitingApproval: number;
}

export async function GET(req: Request) {
  const guard = await actionGuard({ manage: true });
  if (!guard.ok) return guard.response;
  const { ctx } = guard.value;
  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || 30, 1), 365);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  try {
    const rows = await listActions(ctx.admin, { since: from.toISOString(), limit: 1000 });
    const ids = [...new Set(rows.map((r) => r.user_id))];
    const { data: profs } = ids.length ? await ctx.admin.from("profiles").select("id, display_name, email").in("id", ids) : { data: [] };
    const name = new Map(((profs ?? []) as { id: string; display_name: string | null; email: string }[]).map((p) => [p.id, p.display_name || p.email]));

    const totals = { all: 0 } as ActionReport["totals"];
    const byAction = new Map<string, ActionReport["byAction"][number]>();
    const byPerson = new Map<string, ActionReport["byPerson"][number]>();
    const bySource: Record<string, number> = {};
    let minutesSaved = 0;
    for (const r of rows) {
      totals.all++;
      totals[r.status] = (totals[r.status] ?? 0) + 1;
      bySource[r.source] = (bySource[r.source] ?? 0) + 1;
      const def = getActionDef(r.action_key);
      const saved = r.status === "done" ? (def?.minutesSaved ?? 1) : 0;
      minutesSaved += saved;
      const a = byAction.get(r.action_key) ?? { key: r.action_key, title: def?.title ?? r.action_key, total: 0, done: 0, failed: 0, minutesSaved: 0 };
      a.total++;
      if (r.status === "done") a.done++;
      if (r.status === "failed") a.failed++;
      a.minutesSaved += saved;
      byAction.set(r.action_key, a);
      const p = byPerson.get(r.user_id) ?? { id: r.user_id, name: name.get(r.user_id) ?? "Someone", total: 0, done: 0, minutesSaved: 0 };
      p.total++;
      if (r.status === "done") p.done++;
      p.minutesSaved += saved;
      byPerson.set(r.user_id, p);
    }
    const report: ActionReport = {
      from: from.toISOString(),
      to: to.toISOString(),
      totals,
      minutesSaved,
      byAction: [...byAction.values()].sort((a, b) => b.total - a.total),
      byPerson: [...byPerson.values()].sort((a, b) => b.total - a.total),
      bySource,
      recentFailures: rows
        .filter((r) => r.status === "failed")
        .slice(0, 10)
        .map((r) => ({ id: r.id, title: r.title, error: r.error, who: name.get(r.user_id) ?? "Someone", at: r.executed_at ?? r.updated_at })),
      waitingApproval: rows.filter((r) => r.status === "awaiting_approval").length,
    };
    return NextResponse.json({ report, capped: rows.length >= 1000 });
  } catch (e) {
    return actionError(e, "Could not build the report.");
  }
}
