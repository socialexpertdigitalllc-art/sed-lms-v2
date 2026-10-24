import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRefreshPacer, REALTIME_REFRESH } from "@/hooks/useRealtimeRefresh";

/**
 * One lead change reaches every open tab; each refresh re-renders the whole
 * server tree. The pacer turns that herd into: one refresh per burst, never
 * from a hidden tab, never more than one per MIN_GAP per tab.
 */

let visible = true;
let refresh: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  visible = true;
  refresh = vi.fn();
});
afterEach(() => vi.useRealTimers());

const pacer = () => createRefreshPacer(refresh, () => visible, { random: () => 0 });

describe("realtime refresh pacer", () => {
  it("collapses a burst of events into one refresh after the debounce", () => {
    const p = pacer();
    for (let i = 0; i < 25; i++) p.onEvent();
    vi.advanceTimersByTime(REALTIME_REFRESH.DEBOUNCE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("never refreshes a hidden tab, and catches up once when it is looked at", () => {
    const p = pacer();
    visible = false;
    p.onEvent();
    p.onEvent();
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();

    visible = true;
    p.onVisible();
    vi.advanceTimersByTime(REALTIME_REFRESH.DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    // nothing pending → looking again does nothing
    p.onVisible();
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("holds an event that arrives while hidden even if its timer was already running", () => {
    const p = pacer();
    p.onEvent();
    visible = false; // tab hidden before the debounce elapsed
    vi.advanceTimersByTime(REALTIME_REFRESH.DEBOUNCE_MS);
    expect(refresh).not.toHaveBeenCalled();
    visible = true;
    p.onVisible();
    vi.advanceTimersByTime(REALTIME_REFRESH.DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes at most once per MIN_GAP however busy the table is", () => {
    const p = pacer();
    p.onEvent();
    vi.advanceTimersByTime(REALTIME_REFRESH.DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    // a steady stream right after
    for (let t = 0; t < REALTIME_REFRESH.MIN_GAP_MS - 100; t += 100) {
      p.onEvent();
      vi.advanceTimersByTime(100);
    }
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REALTIME_REFRESH.MIN_GAP_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("spreads tabs out with jitter", () => {
    const early = createRefreshPacer(refresh, () => true, { random: () => 0 });
    const late = createRefreshPacer(refresh, () => true, { random: () => 1 });
    early.onEvent();
    late.onEvent();
    vi.advanceTimersByTime(REALTIME_REFRESH.DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REALTIME_REFRESH.JITTER_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels a scheduled refresh (unmount)", () => {
    const p = pacer();
    p.onEvent();
    p.dispose();
    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
