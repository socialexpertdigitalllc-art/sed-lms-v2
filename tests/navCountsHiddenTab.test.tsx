import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNavCounts } from "@/hooks/useNavCounts";

/**
 * The disk-IO fix's client half: a HIDDEN tab must not poll badge counts
 * (an overnight background tab doing so every minute was a leading burner
 * of the shared database's IO budget), and a visible one polls on the 180s
 * floor. Supabase realtime is stubbed inert — only the poll path is under
 * test here.
 */

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
    realtime: { setAuth: () => {} },
    channel: () => {
      const chain = { on: () => chain, subscribe: () => chain };
      return chain;
    },
    removeChannel: () => {},
  }),
}));

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
  fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ counts: { leads: 1 } }) }));
  vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setVisibility("visible");
});

describe("useNavCounts polling", () => {
  it("polls on the interval while visible, never while hidden, and catches up on return", async () => {
    const { unmount } = renderHook(() => useNavCounts());
    await act(async () => {}); // mount fetch
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // visible: the 180s floor tick fires
    await act(async () => {
      vi.advanceTimersByTime(181_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // hidden: three full intervals pass — not a single fetch
    setVisibility("hidden");
    await act(async () => {
      vi.advanceTimersByTime(3 * 181_000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // back to visible: the visibilitychange tick refetches immediately
    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {});
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    unmount();
  });
});
