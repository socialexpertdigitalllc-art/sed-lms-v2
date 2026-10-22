import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MilestoneCelebration, clubName, thousands } from "@/components/celebrations/MilestoneCelebration";

/** The celebration: shown once, marked seen the moment it shows, closed with one click. */

afterEach(() => vi.unstubAllGlobals());

const celebration = { milestone: 1000, total: 1000, mine: 137, closed: 89, team: 14, reachedAt: "2026-10-21T18:48:00Z", next: 2000 };

describe("MilestoneCelebration", () => {
  it("celebrates, marks it seen right away, and closes", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return init?.method === "POST" ? Response.json({ seen: 1000 }) : Response.json({ celebration });
      }),
    );
    render(<MilestoneCelebration displayName="Aqib Khan" />);
    const card = await screen.findByTestId("milestone-card");
    expect(card.textContent).toMatch(/Achievement unlocked/);
    expect(card.textContent).toMatch(/1K Club/);
    expect(screen.getByRole("dialog", { name: "1,000" })).toBeTruthy();
    expect(card.textContent).toMatch(/leads in the pipeline!/);
    expect(card.textContent).toMatch(/Aqib, every call/);
    expect(card.textContent).toMatch(/137of them are yours/);
    expect(card.textContent).toMatch(/89deals closed/);
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "POST")!.init!.body))).toEqual({ milestone: 1000 });
    fireEvent.click(screen.getByRole("button", { name: /On to 2,000/ }));
    expect(screen.queryByTestId("milestone-card")).toBeNull();
  });

  it("Escape closes it too", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => (init?.method === "POST" ? Response.json({ seen: 1000 }) : Response.json({ celebration }))));
    render(<MilestoneCelebration displayName="" />);
    await screen.findByTestId("milestone-card");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("milestone-card")).toBeNull();
  });

  it("nothing owed → nothing shown, nothing written", async () => {
    const fetchMock = vi.fn(async () => Response.json({ celebration: null }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MilestoneCelebration displayName="Aqib" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("milestone-card")).toBeNull();
  });

  it("names", () => {
    expect(thousands(2000)).toBe("2,000");
    expect(clubName(3000)).toBe("3K Club");
  });
});
