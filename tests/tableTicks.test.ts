import { describe, it, expect, vi, beforeEach } from "vitest";

const rt = vi.hoisted(() => ({
  channels: new Map<string, { handler?: (m: { payload: unknown }) => void; status?: (s: string) => void; removed: boolean }>(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (name: string) => {
      const c = { removed: false } as { handler?: (m: { payload: unknown }) => void; status?: (s: string) => void; removed: boolean };
      rt.channels.set(name, c);
      const api = {
        on: (_t: string, _f: unknown, h: (m: { payload: unknown }) => void) => {
          c.handler = h;
          return api;
        },
        subscribe: (s: (st: string) => void) => {
          c.status = s;
          s("SUBSCRIBED");
          return api;
        },
      };
      return api;
    },
    removeChannel: (ch: unknown) => {
      for (const c of rt.channels.values()) if (ch && c) c.removed = true;
    },
  }),
}));
const leads = vi.hoisted(() => ({ fn: null as null | ((k: string, t: string, b: Record<string, unknown>) => void) }));
vi.mock("@/lib/realtime/leadsTicks", () => ({
  subscribeLeadsTicks: (fn: (k: string, t: string, b: Record<string, unknown>) => void) => {
    leads.fn = fn;
    return () => {
      leads.fn = null;
    };
  },
}));

import { subscribeTableTicks, createTickPacer, toTablePayload, tableTopic } from "@/lib/realtime/tableTicks";

describe("table ticks — channels", () => {
  beforeEach(() => rt.channels.clear());

  it("one public topic per table; payloads carry only the row's ids", () => {
    const got: unknown[] = [];
    const off = subscribeTableTicks(["contracts", "pre_leads"], (p) => got.push(p));
    expect([...rt.channels.keys()].sort()).toEqual([tableTopic("contracts"), tableTopic("pre_leads")].sort());
    rt.channels.get("lms:t:contracts")!.handler!({ payload: { table: "contracts", op: "UPDATE", id: "c1", lead_id: "L1", secret: "x" } });
    expect(got).toEqual([{ table: "contracts", op: "UPDATE", id: "c1", lead_id: "L1", ticket_id: undefined }]);
    off();
  });

  it("the leads group comes through the shared leads topic, filtered to the asked tables", () => {
    const got: string[] = [];
    const off = subscribeTableTicks(["lead_tickets", "contracts"], (p) => got.push(`${p.table}:${p.lead_id ?? ""}`));
    expect(rt.channels.has("lms:t:lead_tickets")).toBe(false);
    leads.fn!("other", "lead_tickets", { lead_id: "L1" });
    leads.fn!("leads", "leads", {});
    expect(got).toEqual(["lead_tickets:L1"]);
    off();
    expect(leads.fn).toBeNull();
  });

  it("two screens on the same table share one channel", () => {
    const a = subscribeTableTicks(["feedback"], () => {});
    const b = subscribeTableTicks(["feedback"], () => {});
    expect(rt.channels.size).toBe(1);
    a();
    b();
  });

  it("toTablePayload drops anything that is not an id", () => {
    expect(toTablePayload("x", { id: 5, lead_id: "", op: "INSERT" })).toEqual({ table: "x", op: "INSERT", id: undefined, lead_id: undefined, ticket_id: undefined });
  });
});

describe("tick pacer", () => {
  function setup(visible = true) {
    let now = 0;
    let isVisible = visible;
    const timers: { fn: () => void; at: number }[] = [];
    const run = vi.fn();
    const p = createTickPacer(run, {
      debounceMs: 300,
      jitterMs: 0,
      minGapMs: 3000,
      isVisible: () => isVisible,
      now: () => now,
      random: () => 0,
      setTimer: (fn, ms) => {
        timers.push({ fn, at: now + ms });
        return timers.length;
      },
      clearTimer: () => {},
    });
    const advance = (ms: number) => {
      now += ms;
      for (const t of timers.splice(0).filter((x) => x.at <= now)) t.fn();
    };
    return { p, run, advance, timers, setVisible: (v: boolean) => (isVisible = v) };
  }

  it("a burst is one run after the debounce", () => {
    const { p, run, advance } = setup();
    p.tick();
    p.tick();
    p.tick();
    advance(300);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("never runs more often than the minimum gap", () => {
    const { p, run, advance, timers } = setup();
    p.tick();
    advance(300);
    p.tick();
    expect(timers[0].at).toBe(3300);
    advance(3000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a hidden tab waits, then runs once when visible", () => {
    const { p, run, advance, setVisible } = setup(false);
    p.tick();
    advance(1000);
    expect(run).not.toHaveBeenCalled();
    setVisible(true);
    p.visible();
    advance(0);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
