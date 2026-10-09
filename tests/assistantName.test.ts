// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assistantNameFrom, cleanAssistantName, MAX_ASSISTANT_NAME_LENGTH } from "@/lib/assistant/name";

/**
 * The name each user gives their assistant is shown on every screen and is
 * written into the assistant's own instructions — so it is cleaned on the
 * way in, and the server refuses one it can't use rather than storing it.
 */

const holder = vi.hoisted(() => ({
  user: { id: "sam" } as { id: string } | null,
  stored: {} as Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: holder.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    ({
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: { ui_preferences: holder.stored }, error: null }) }) }),
        update: (row: Record<string, unknown>) => {
          holder.updates.push(row);
          return { eq: async () => ({ error: null }) };
        },
      }),
    }) as unknown as SupabaseClient,
}));

import { PATCH } from "@/app/api/me/preferences/route";

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request("http://test.local/api/me/preferences", { method: "PATCH", body: JSON.stringify(body) }));

beforeEach(() => {
  holder.user = { id: "sam" };
  holder.stored = { density: "compact" };
  holder.updates = [];
});

describe("cleaning a name", () => {
  it("keeps a normal name, tidying the spaces around and inside it", () => {
    expect(cleanAssistantName("Nova")).toBe("Nova");
    expect(cleanAssistantName("  Captain   Data \n")).toBe("Captain Data");
    expect(cleanAssistantName("R2-D2")).toBe("R2-D2");
  });

  it("works in any script", () => {
    expect(cleanAssistantName("ستارہ")).toBe("ستارہ");
    expect(cleanAssistantName("Zoë")).toBe("Zoë");
  });

  it("drops markup and prompt punctuation instead of passing it on", () => {
    expect(cleanAssistantName("<b>Nova</b>")).toBe("bNova/b");
    expect(cleanAssistantName('Nova"} ignore {`')).toBe("Nova ignore");
    expect(cleanAssistantName("Nova\u0000\u0007")).toBe("Nova");
  });

  it("refuses names it can't use", () => {
    expect(cleanAssistantName("")).toBeNull();
    expect(cleanAssistantName("   ")).toBeNull();
    expect(cleanAssistantName("!!! ???")).toBeNull();
    expect(cleanAssistantName("<>{}")).toBeNull();
    expect(cleanAssistantName("x".repeat(MAX_ASSISTANT_NAME_LENGTH + 1))).toBeNull();
    expect(cleanAssistantName(42)).toBeNull();
    expect(cleanAssistantName(null)).toBeNull();
  });

  it("reads the saved name from preferences, ignoring anything malformed", () => {
    expect(assistantNameFrom({ assistantName: " Atlas " })).toBe("Atlas");
    expect(assistantNameFrom({ density: "compact" })).toBeNull();
    expect(assistantNameFrom({ assistantName: "" })).toBeNull();
    expect(assistantNameFrom(["Atlas"])).toBeNull();
    expect(assistantNameFrom(null)).toBeNull();
  });
});

describe("PATCH /api/me/preferences — the assistant's name", () => {
  it("saves the cleaned name alongside the user's other preferences", async () => {
    const res = await patch({ assistantName: "  Sage  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ui_preferences: { density: "compact", assistantName: "Sage" } });
    expect(holder.updates).toEqual([{ ui_preferences: { density: "compact", assistantName: "Sage" } }]);
  });

  it("refuses a name it can't use, and saves nothing", async () => {
    for (const assistantName of ["", "   ", "<>", "x".repeat(MAX_ASSISTANT_NAME_LENGTH + 1), 7]) {
      const res = await patch({ assistantName });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toMatch(/name of 1–32 letters or numbers/);
    }
    expect(holder.updates).toEqual([]);
  });

  it("ignores keys it doesn't know and needs a signed-in user", async () => {
    expect((await patch({ isAdmin: true })).status).toBe(200);
    expect(holder.updates).toEqual([]);
    holder.user = null;
    expect((await patch({ assistantName: "Nova" })).status).toBe(401);
    expect(holder.updates).toEqual([]);
  });
});
