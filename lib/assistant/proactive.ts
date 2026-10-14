import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Suggestions SED AI starts itself: a quick look at the person's own work for
 * things it could take off their hands — overdue follow-ups, Ready leads with
 * no website build, closed deals with no receipt, tickets waiting on them.
 * Each one is a ready-made request they can send in Act mode with one tap
 * (it still prepares cards to confirm). SERVER ONLY; reads through the
 * person's own client, so it only ever counts what they can see.
 */

export interface ProactiveSuggestion {
  id: string;
  title: string;
  detail: string;
  /** The request it sends. */
  prompt: string;
}

const cache = new Map<string, { at: number; items: ProactiveSuggestion[] }>();
const TTL_MS = 5 * 60_000;

async function count(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count: n, error } = await q;
  return error ? 0 : (n ?? 0);
}

export async function proactiveSuggestions(db: SupabaseClient, userId: string, perms: Set<string>, now = new Date()): Promise<ProactiveSuggestion[]> {
  const hit = cache.get(userId);
  if (hit && now.getTime() - hit.at < TTL_MS) return hit.items;
  const iso = now.toISOString();
  const out: ProactiveSuggestion[] = [];

  const [overdue, readyIds, closedIds, myTickets] = await Promise.all([
    perms.has("leads.edit")
      ? count(
          db.from("leads").select("id", { count: "exact", head: true }).eq("agent_id", userId).is("deleted_at", null).in("status", ["Ready", "Long Term"]).lt("follow_up_time", iso),
        )
      : Promise.resolve(0),
    perms.has("studio.manage")
      ? db.from("leads").select("id").eq("agent_id", userId).eq("status", "Ready").is("deleted_at", null).limit(200).then((r) => (r.data ?? []).map((l) => l.id as string))
      : Promise.resolve([] as string[]),
    perms.has("receipts.send")
      ? db.from("leads").select("id").eq("status", "Closed").is("deleted_at", null).gte("closed_at", new Date(now.getTime() - 30 * 86_400_000).toISOString()).limit(200).then((r) => (r.data ?? []).map((l) => l.id as string))
      : Promise.resolve([] as string[]),
    perms.has("tickets.view") ? count(db.from("lead_tickets").select("id", { count: "exact", head: true }).eq("assigned_to", userId).in("status", ["Assigned", "Open"])) : Promise.resolve(0),
  ]);

  if (overdue > 0) {
    out.push({
      id: "overdue",
      title: `${overdue} overdue follow-up${overdue === 1 ? "" : "s"}`,
      detail: "Move them to a new time in one go",
      prompt: `Reschedule my ${overdue} overdue follow-ups to tomorrow at 11:00`,
    });
  }
  if (readyIds.length) {
    const { data: runs } = await db.from("builder_runs").select("lead_id").in("lead_id", readyIds);
    const built = new Set((runs ?? []).map((r) => r.lead_id as string));
    const missing = readyIds.filter((id) => !built.has(id)).length;
    if (missing > 0) {
      out.push({ id: "builds", title: `${missing} Ready lead${missing === 1 ? "" : "s"} without a website build`, detail: "Start their Site Builder runs", prompt: `Start website builds for my Ready leads that don't have one yet` });
    }
  }
  if (closedIds.length) {
    const { data: receipts } = await db.from("lead_receipts").select("lead_id").in("lead_id", closedIds);
    const done = new Set((receipts ?? []).map((r) => r.lead_id as string));
    const missing = closedIds.filter((id) => !done.has(id)).length;
    if (missing > 0) {
      out.push({ id: "receipts", title: `${missing} closed deal${missing === 1 ? "" : "s"} without a receipt`, detail: "Last 30 days", prompt: `Which leads closed in the last 30 days have no payment receipt? Prepare receipts for them` });
    }
  }
  if (myTickets > 0) {
    out.push({ id: "tickets", title: `${myTickets} ticket${myTickets === 1 ? "" : "s"} waiting on you`, detail: "Start the oldest", prompt: `Show the tickets assigned to me and start work on the oldest one` });
  }
  const items = out.slice(0, 4);
  cache.set(userId, { at: now.getTime(), items });
  return items;
}
