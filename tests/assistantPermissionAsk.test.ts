// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { memorySupabase, type MemoryDb } from "./helpers/memorySupabase";
import { requestPermissionModeTool } from "@/lib/assistant/tools/actions";
import { compactToolResults, KEEP_RECENT_ROUNDS } from "@/lib/assistant/engine";
import { actSection } from "@/lib/assistant/prompt";
import { permissionAskOf } from "@/components/assistant/PermissionAskCard";
import type { AutoRunContext } from "@/lib/assistant/actions/run";
import type { WireMessage } from "@/lib/assistant/llm";

/**
 * A big job meets a cautious permission mode: SED AI asks ONCE to switch, and
 * a long job keeps its context small as it goes.
 */

let mem: MemoryDb;
beforeEach(() => {
  mem = memorySupabase({ assistant_messages: [] });
});

const auto = (over: Partial<AutoRunContext> = {}): AutoRunContext => ({ mode: "ask", cap: "auto", allow: [], origin: "x", budget: { left: 60 }, ...over });
function ctx(a: AutoRunContext | null, source: "chat" | "telegram" = "chat") {
  return {
    userId: "sam", displayName: "Sam", perms: new Set(["assistant.act"]), db: mem.client, admin: mem.client, timezone: "Asia/Karachi",
    now: new Date(), conversationId: "conv-1", data: {} as never,
    act: { mode: "act" as const, turnId: "t1", source, isAdmin: false, callId: "k1", auto: a } as {
      mode: "act"; turnId: string; source: "chat" | "telegram"; isAdmin: boolean; callId: string; auto: AutoRunContext | null; askedPermission?: boolean;
    },
  };
}
const ask = (c: ReturnType<typeof ctx>, mode = "auto") => requestPermissionModeTool.run({ mode, reason: "to categorise 802 leads" }, c as never);

describe("request_permission_mode", () => {
  it("asks for the mode the job needs — and tells the engine to wrap up", async () => {
    const c = ctx(auto());
    const out = await ask(c);
    expect(out.data).toMatchObject({ status: "asked", mode: "auto" });
    expect(out.summary).toBe("Asked to switch to “Auto-run all but high-impact” — to categorise 802 leads");
    expect(c.act.askedPermission).toBe(true);
  });

  it("not needed when the mode already allows it", async () => {
    const c = ctx(auto({ mode: "auto" }));
    expect((await ask(c, "auto_safe")).data).toMatchObject({ status: "already" });
    expect(c.act.askedPermission).toBeUndefined();
  });

  it("only once per chat", async () => {
    mem.tables.assistant_messages.push({ id: "m1", conversation_id: "conv-1", tool_name: "request_permission_mode" });
    await expect(ask(ctx(auto()))).rejects.toThrow(/already asked/);
  });

  it("never above the company limit, never on the phone, never for Ask", async () => {
    await expect(ask(ctx(auto({ cap: "auto_safe" })))).rejects.toThrow(/company's limit/);
    await expect(ask(ctx(auto(), "telegram"))).rejects.toThrow(/no button on the phone/);
    await expect(ask(ctx(auto()), "ask")).rejects.toThrow(/auto_safe" or "auto/);
  });
});

describe("the card reads the request back from the saved tool call", () => {
  it("finds an asked request; ignores 'already' and failed ones", () => {
    const seg = (summary: string, status = "ok", mode = "auto") => ({ kind: "tool", name: "request_permission_mode", status, summary, args: { mode, reason: "to finish" } });
    expect(permissionAskOf([seg("Asked to switch to …")])).toEqual({ mode: "auto", reason: "to finish" });
    expect(permissionAskOf([seg("Already allowed")])).toBeNull();
    expect(permissionAskOf([seg("Asked…", "error")])).toBeNull();
    expect(permissionAskOf([seg("Asked…", "ok", "ask")])).toBeNull();
  });
});

describe("compactToolResults — a long job keeps its context small", () => {
  it("shortens results older than the last few rounds to their summary, keeping call ids paired", () => {
    const messages: WireMessage[] = [{ role: "system", content: "s" }];
    const slots: { index: number; round: number; summary: string; trimmed: boolean }[] = [];
    for (let round = 0; round < 6; round++) {
      messages.push({ role: "tool", tool_call_id: `c${round}`, name: "search_leads", content: "x".repeat(5000) });
      slots.push({ index: messages.length - 1, round, summary: `100 matches · batch ${round}`, trimmed: false });
    }
    const n = compactToolResults(messages, slots, 6);
    expect(n).toBe(6 - KEEP_RECENT_ROUNDS);
    const first = messages[1] as { content: string; tool_call_id: string };
    expect(first.tool_call_id).toBe("c0");
    expect(JSON.parse(first.content)).toMatchObject({ summary: "100 matches · batch 0" });
    expect((messages[6] as { content: string }).content).toHaveLength(5000);
    // Idempotent.
    expect(compactToolResults(messages, slots, 6)).toBe(0);
  });
});

describe("the Act prompt for big jobs", () => {
  const p = actSection({ mode: "act", catalogue: "Leads:\n- lead.categorize: Set the category of many leads", permission: { mode: "ask", allow: [] } }, "Asia/Karachi");
  it("does the whole job in one answer, in bulk, and lists what it couldn't decide", () => {
    expect(p).toMatch(/do ALL of it in this answer/);
    expect(p).toMatch(/lead\.categorize/);
    expect(p).toMatch(/list them for the person at the end/);
  });
  it("asks once to switch the mode — even when permission was given in words", () => {
    expect(p).toMatch(/call request_permission_mode ONCE/);
    expect(p).toMatch(/even if they already gave permission in their message/);
    expect(p).toMatch(/Never ask twice/);
  });
});
