import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const ticks = vi.hoisted(() => ({ fns: [] as ((k: string, table: string) => void)[] }));
vi.mock("@/lib/realtime/leadsTicks", () => ({
  subscribeLeadsTicks: (fn: (k: string, table: string) => void) => {
    ticks.fns.push(fn);
    return () => {
      ticks.fns = ticks.fns.filter((f) => f !== fn);
    };
  },
}));

import { useTickRefetch, TICK_REFETCH_DELAY_MS, TICK_REFETCH_JITTER_MS } from "@/hooks/useTickRefetch";

function List({ initial, load }: { initial: string[]; load: () => Promise<string[]> }) {
  const rows = useTickRefetch("lead_tickets", initial, load);
  return <div data-testid="rows">{rows.join(",")}</div>;
}

const wait = async () => {
  await act(async () => {
    vi.advanceTimersByTime(TICK_REFETCH_DELAY_MS + TICK_REFETCH_JITTER_MS + 1);
  });
  await act(async () => {
    await Promise.resolve();
  });
};
const tick = (table: string) => act(() => ticks.fns.forEach((f) => f("other", table)));

describe("useTickRefetch — a small table kept live", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ticks.fns = [];
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });
  afterEach(() => vi.useRealTimers());

  it("starts from what the page sent, and re-reads on a tick for its table", async () => {
    const load = vi.fn(async () => ["t1", "t2"]);
    render(<List initial={["t1"]} load={load} />);
    expect(screen.getByTestId("rows").textContent).toBe("t1");
    tick("lead_tickets");
    tick("lead_tickets");
    await wait();
    expect(load).toHaveBeenCalledTimes(1); // a burst is one read
    expect(screen.getByTestId("rows").textContent).toBe("t1,t2");
  });

  it("ignores ticks for other tables", async () => {
    const load = vi.fn(async () => ["x"]);
    render(<List initial={["t1"]} load={load} />);
    tick("leads");
    tick("lead_follow_ups");
    await wait();
    expect(load).not.toHaveBeenCalled();
  });

  it("a hidden tab waits, then re-reads when looked at", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const load = vi.fn(async () => ["t9"]);
    render(<List initial={["t1"]} load={load} />);
    tick("lead_tickets");
    await wait();
    expect(load).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await wait();
    expect(screen.getByTestId("rows").textContent).toBe("t9");
  });

  it("a failed re-read keeps what is shown", async () => {
    const load = vi.fn(async () => {
      throw new Error("offline");
    });
    render(<List initial={["t1"]} load={load} />);
    tick("lead_tickets");
    await wait();
    expect(screen.getByTestId("rows").textContent).toBe("t1");
  });
});
