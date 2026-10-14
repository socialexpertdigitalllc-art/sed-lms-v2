// @vitest-environment node
import { describe, it, expect } from "vitest";
import { looksLikeTask } from "@/lib/assistant/intent";
import { describeSchedule, nextRunAt } from "@/lib/assistant/rules";
import { actSection, pageSection } from "@/lib/assistant/prompt";
import { actionHistoryLines } from "@/lib/assistant/engine";
import { applyEvent, liveTurn, turnsFromMessages } from "@/lib/assistant/turns";
import type { ActionCard } from "@/lib/assistant/actions/card";
import type { StoredAction } from "@/lib/assistant/actions/types";
import type { UiMessage } from "@/lib/assistant/view";

describe("looksLikeTask", () => {
  it("spots tasks, in English and Roman Urdu", () => {
    for (const t of ["Create a lead for Jumbo's Pizza", "please mark Jumbo's as closed", "remind me tomorrow at 10 to call Ali", "Jumbo's ka lead bana do", "log a no pickup on Old Town"]) {
      expect(looksLikeTask(t), t).toBe(true);
    }
  });
  it("never mistakes a question for a task", () => {
    for (const t of ["How many leads did I create this week?", "what is my pickup rate", "Show me my overdue follow-ups", "create?", "hi"]) {
      expect(looksLikeTask(t), t).toBe(false);
    }
  });
});

describe("rule schedules", () => {
  const tz = "Asia/Karachi";
  it("fires daily at the company time", () => {
    // 10:00Z = 15:00 Karachi → next 09:00 Karachi is tomorrow 04:00Z.
    expect(nextRunAt({ every: "day", at: "09:00" }, new Date("2026-10-14T10:00:00Z"), tz).toISOString()).toBe("2026-10-15T04:00:00.000Z");
    expect(nextRunAt({ every: "day", at: "18:30" }, new Date("2026-10-14T10:00:00Z"), tz).toISOString()).toBe("2026-10-14T13:30:00.000Z");
  });
  it("fires weekly on the right weekday", () => {
    // 2026-10-14 is a Wednesday.
    expect(nextRunAt({ every: "week", weekday: 1, at: "09:00" }, new Date("2026-10-14T10:00:00Z"), tz).toISOString()).toBe("2026-10-19T04:00:00.000Z");
  });
  it("fires hourly at the top of the hour", () => {
    expect(nextRunAt({ every: "hour" }, new Date("2026-10-14T10:20:00Z"), tz).toISOString()).toBe("2026-10-14T11:00:00.000Z");
  });
  it("describes itself", () => {
    expect(describeSchedule({ every: "week", weekday: 1, at: "09:00" })).toBe("every Monday at 09:00");
  });
});

describe("Act-mode prompt", () => {
  it("tells someone without Act mode that it is off, instead of pretending", () => {
    expect(actSection(null, "Asia/Karachi")).toMatch(/not enabled for their account/);
  });
  it("offers the switch in Ask mode and the rules + catalogue in Act mode", () => {
    expect(actSection({ mode: "ask" }, "Asia/Karachi")).toMatch(/switch_to_action_mode/);
    const act = actSection({ mode: "act", catalogue: "Leads:\n- lead.create: Create a lead", history: ["- [x] Create lead — DONE"] }, "Asia/Karachi");
    expect(act).toMatch(/Never invent/);
    expect(act).toMatch(/NEVER say it is done/);
    expect(act).toMatch(/lead\.create/);
    expect(act).toMatch(/Actions in this chat/);
  });
  it("names the page the person is on", () => {
    expect(pageSection("the lead “Jumbo's” (/leads/1)")).toMatch(/They are looking at the lead/);
    expect(pageSection(null)).toBe("");
  });
});

describe("action outcomes for the model", () => {
  it("says plainly what happened to each card", () => {
    const row = (over: Partial<StoredAction>): StoredAction =>
      ({ id: "a", title: "Create lead — X", status: "proposed", expires_at: "2099-01-01T00:00:00Z", result: null, error: null, approval_note: null, ...over }) as StoredAction;
    const lines = actionHistoryLines([
      row({ status: "done", result: { message: "Created the lead X.", link: { href: "/leads/1", label: "Open" } } }),
      row({ status: "failed", error: "Duplicate" }),
      row({ status: "proposed", expires_at: "2000-01-01T00:00:00Z" }),
      row({ status: "rejected", approval_note: "not now" }),
    ]);
    expect(lines[0]).toMatch(/DONE — Created the lead X\. \(\/leads\/1\)/);
    expect(lines[1]).toMatch(/FAILED — Duplicate/);
    expect(lines[2]).toMatch(/expired/);
    expect(lines[3]).toMatch(/turned down.*not now/);
  });
});

describe("cards in the chat thread", () => {
  const card = (over: Partial<ActionCard>): ActionCard => ({
    id: "card-1",
    key: "lead.create",
    title: "Create a lead — X",
    group: "Leads",
    risk: "standard",
    status: "proposed",
    confirmLabel: "Create lead",
    fields: [],
    createdAt: "",
    ...over,
  });
  const msg = (over: Partial<UiMessage>): UiMessage => ({
    id: "m",
    turn_id: "t1",
    role: "assistant",
    content: "",
    reasoning: null,
    tool_calls: null,
    tool_call_id: null,
    tool_name: null,
    meta: null,
    status: "complete",
    error: null,
    created_at: "2026-10-14T10:00:00Z",
    ...over,
  });

  it("puts each saved card under the turn that prepared it, with the question's files and the self-switch", () => {
    const turns = turnsFromMessages(
      [
        msg({ id: "t1", role: "user", content: "create a lead", meta: { mode: "ask", attachments: [{ id: "f1", name: "logo.png", mime: "image/png" }] } }),
        msg({ id: "a1", tool_calls: [{ id: "c1", name: "switch_to_action_mode" }] }),
        msg({ id: "r1", role: "tool", tool_call_id: "c1", tool_name: "switch_to_action_mode", meta: { label: "Switching", ok: true, summary: "", duration_ms: 1, args: { task: "create a lead" } } }),
        msg({ id: "a2", tool_calls: [{ id: "c2", name: "prepare_action" }] }),
        msg({ id: "r2", role: "tool", tool_call_id: "c2", tool_name: "prepare_action", meta: { label: "Preparing", ok: true, summary: "", duration_ms: 1 } }),
        msg({ id: "a3", content: "Review the card." }),
      ],
      [card({ callId: "c2" }), card({ id: "card-2", callId: null, turnId: "t1" })],
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].actions.map((a) => a.id)).toEqual(["card-1", "card-2"]);
    expect(turns[0].attachments[0].name).toBe("logo.png");
    expect(turns[0].switchedToAct).toBe("create a lead");
  });

  it("adds a card live and updates it in place", () => {
    let t = liveTurn("p", "create a lead");
    t = applyEvent(t, { type: "mode", mode: "act", reason: "create a lead" });
    t = applyEvent(t, { type: "action", card: card({}) });
    t = applyEvent(t, { type: "action", card: card({ status: "done" }) });
    expect(t.switchedToAct).toBe("create a lead");
    expect(t.actions).toHaveLength(1);
    expect(t.actions[0].status).toBe("done");
  });
});
