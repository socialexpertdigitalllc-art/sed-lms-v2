import { NextResponse } from "next/server";
import { actionError, actionGuard } from "@/lib/assistant/actions/http";
import { listActions, toCard } from "@/lib/assistant/actions/store";
import type { StoredAction } from "@/lib/assistant/actions/types";

export const runtime = "nodejs";

/**
 * Action history. `scope=mine` (default): the caller's own actions, for their
 * history panel. `scope=approvals`: requests waiting on an approver;
 * `scope=all`: everyone's — both for people who manage SED AI actions.
 */

const STATUSES = new Set<StoredAction["status"]>(["proposed", "executing", "done", "failed", "cancelled", "expired", "undone", "awaiting_approval", "rejected"]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "mine";
  const guard = await actionGuard({ manage: scope !== "mine" });
  if (!guard.ok) return guard.response;
  const { ctx } = guard.value;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const before = url.searchParams.get("before") ?? undefined;
  const status = url.searchParams.get("status");
  try {
    const rows = await listActions(ctx.admin, {
      userId: scope === "mine" ? ctx.userId : undefined,
      statuses: scope === "approvals" ? ["awaiting_approval"] : status && STATUSES.has(status as StoredAction["status"]) ? [status as StoredAction["status"]] : undefined,
      limit,
      before,
    });
    const people = [...new Set(rows.flatMap((r) => [r.user_id, r.approver_id]).filter((x): x is string => Boolean(x)))];
    const { data: profs } = people.length ? await ctx.admin.from("profiles").select("id, display_name, email").in("id", people) : { data: [] };
    const name = new Map(((profs ?? []) as { id: string; display_name: string | null; email: string }[]).map((p) => [p.id, p.display_name || p.email]));
    return NextResponse.json({
      actions: rows.map((r) => ({
        ...toCard(r),
        conversationId: r.conversation_id,
        source: r.source,
        requester: { id: r.user_id, name: name.get(r.user_id) ?? "Someone" },
        approver: r.approver_id ? { id: r.approver_id, name: name.get(r.approver_id) ?? "An admin" } : null,
        executedAt: r.executed_at,
      })),
      nextBefore: rows.length === limit ? rows[rows.length - 1].created_at : null,
    });
  } catch (e) {
    return actionError(e, "Could not load the actions.");
  }
}
