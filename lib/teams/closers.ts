import type { SupabaseClient } from "@supabase/supabase-js";
import { ttlCached, ttlInvalidate } from "@/lib/cache/ttl";

/**
 * The closer -> sales-agent hierarchy (table `closer_assignments`, migration
 * 0069).
 *
 * A closer owns a team of sales agents: they may see their team's work and act
 * on it, and every action they take is attributed to THEM, never to the agent
 * (see `actingAs`). The shape is enforced in the database — one closer per
 * agent, and no closer under another closer — so these helpers only ever
 * READ the hierarchy; they never re-derive its rules.
 *
 * Reads are TTL-cached: authorization asks "is this agent on my team?" on
 * every write to a lead, and the answer changes only when an admin edits the
 * roster (which invalidates it).
 */

const TEAM_TTL_MS = 60_000;

export interface CloserAssignment {
  agent_id: string;
  closer_id: string;
}

/** Agent ids reporting to this closer. Empty for a non-closer. */
export async function getTeamAgentIds(admin: SupabaseClient, closerId: string): Promise<string[]> {
  return ttlCached("closer-team", closerId, TEAM_TTL_MS, async () => {
    const { data } = await admin.from("closer_assignments").select("agent_id").eq("closer_id", closerId);
    return (data ?? []).map((r) => r.agent_id as string);
  });
}

/** The closer this agent reports to, or null. */
export async function getCloserOf(admin: SupabaseClient, agentId: string): Promise<string | null> {
  return ttlCached("closer-of", agentId, TEAM_TTL_MS, async () => {
    const { data } = await admin
      .from("closer_assignments")
      .select("closer_id")
      .eq("agent_id", agentId)
      .maybeSingle();
    return (data?.closer_id as string | undefined) ?? null;
  });
}

/**
 * May `actorId` act on work owned by `agentId`? True for the agent themselves
 * and for that agent's closer. Says nothing about permissions — callers still
 * apply their own (a closer with no leads.edit still cannot edit).
 */
export async function canActForAgent(
  admin: SupabaseClient,
  actorId: string,
  agentId: string | null | undefined,
): Promise<boolean> {
  if (!agentId) return false;
  if (actorId === agentId) return true;
  return (await getCloserOf(admin, agentId)) === actorId;
}

/**
 * The set of user ids whose work `actorId` may see/act on: themselves plus
 * their team. Useful for scoping list views.
 */
export async function visibleAgentIds(admin: SupabaseClient, actorId: string): Promise<string[]> {
  return [actorId, ...(await getTeamAgentIds(admin, actorId))];
}

/**
 * The attribution stamp for an action a CLOSER took on a team member's
 * record — the "closer token". The activity log's `user_id` is always the
 * real actor; this marks whose work was touched, so "who actually did this"
 * survives in the record rather than looking like the agent did it.
 * Returns null when the actor is acting on their own work.
 */
export function actingAs(actorId: string, ownerAgentId: string | null | undefined) {
  if (!ownerAgentId || actorId === ownerAgentId) return null;
  return { as: "closer" as const, on_behalf_of: ownerAgentId, performed_by: actorId };
}

/** Roster changed — drop the cached answers on this instance. */
export function invalidateCloserTeams(): void {
  ttlInvalidate("closer-team");
  ttlInvalidate("closer-of");
}
