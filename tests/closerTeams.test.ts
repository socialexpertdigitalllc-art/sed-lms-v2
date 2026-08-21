// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ttlResetAll } from "@/lib/cache/ttl";
import {
  actingAs,
  canActForAgent,
  getCloserOf,
  getTeamAgentIds,
  visibleAgentIds,
} from "@/lib/teams/closers";

/**
 * The closer -> sales-agent hierarchy. The STRUCTURE (one closer per agent, no
 * closer under a closer) is enforced by migration 0069's primary key and
 * trigger; what is pinned here is how the app reads that hierarchy to decide
 * who may act on whose work, and how the action is attributed.
 */

const CLOSER = "closer-1";
const OTHER_CLOSER = "closer-2";
const AGENT = "agent-1";
const AGENT_2 = "agent-2";
const STRANGER = "agent-9";

const rows = [
  { agent_id: AGENT, closer_id: CLOSER },
  { agent_id: AGENT_2, closer_id: CLOSER },
];

function admin(): SupabaseClient {
  return {
    from: () => ({
      select: () => {
        const api = {
          eq: (col: string, val: string) => {
            const matched = rows.filter((r) => (r as Record<string, string>)[col] === val);
            return Object.assign(Promise.resolve({ data: matched, error: null }), {
              maybeSingle: async () => ({ data: matched[0] ?? null, error: null }),
            });
          },
        };
        return api;
      },
    }),
  } as unknown as SupabaseClient;
}

beforeEach(() => ttlResetAll());

describe("reading the hierarchy", () => {
  it("lists a closer's team and returns nothing for a non-closer", async () => {
    expect((await getTeamAgentIds(admin(), CLOSER)).sort()).toEqual([AGENT, AGENT_2]);
    expect(await getTeamAgentIds(admin(), STRANGER)).toEqual([]);
  });

  it("resolves an agent's closer, or null when they are on no team", async () => {
    expect(await getCloserOf(admin(), AGENT)).toBe(CLOSER);
    expect(await getCloserOf(admin(), STRANGER)).toBeNull();
  });

  it("scopes a closer to themselves plus their team", async () => {
    expect((await visibleAgentIds(admin(), CLOSER)).sort()).toEqual([AGENT, AGENT_2, CLOSER].sort());
    expect(await visibleAgentIds(admin(), STRANGER)).toEqual([STRANGER]);
  });
});

describe("canActForAgent", () => {
  it("lets an agent act on their own work", async () => {
    expect(await canActForAgent(admin(), AGENT, AGENT)).toBe(true);
  });

  it("lets a closer act on their own team member", async () => {
    expect(await canActForAgent(admin(), CLOSER, AGENT)).toBe(true);
  });

  it("does NOT let a closer act on another closer's agent", async () => {
    expect(await canActForAgent(admin(), OTHER_CLOSER, AGENT)).toBe(false);
  });

  it("does NOT let an agent act on a peer, or on an unowned lead", async () => {
    expect(await canActForAgent(admin(), AGENT_2, AGENT)).toBe(false);
    expect(await canActForAgent(admin(), CLOSER, null)).toBe(false);
  });
});

describe("actingAs — the closer token", () => {
  it("stamps who really acted and whose work it was", () => {
    expect(actingAs(CLOSER, AGENT)).toEqual({
      as: "closer",
      on_behalf_of: AGENT,
      performed_by: CLOSER,
    });
  });

  it("is absent when someone acts on their own work", () => {
    expect(actingAs(AGENT, AGENT)).toBeNull();
    expect(actingAs(AGENT, null)).toBeNull();
  });
});
