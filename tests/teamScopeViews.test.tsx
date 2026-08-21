import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FollowUpQueue } from "@/components/leads/FollowUpQueue";
import { PermissionProvider } from "@/providers/PermissionProvider";
import { ToastProvider } from "@/components/common/Toast";
import type { Lead } from "@/lib/leads/types";

/**
 * The "My team" scope a closer gets on the list views: it must narrow to the
 * closer PLUS their own agents — never another closer's agents, and never
 * unassigned leads — and it must not appear at all for someone with no team.
 */

// The queue subscribes to realtime; the test only exercises filtering.
vi.mock("@/hooks/useRealtimeRefresh", () => ({ useRealtimeRefresh: () => {} }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/leads/follow-ups",
}));

const CLOSER = "closer-1";
const MINE_A = "agent-a";
const MINE_B = "agent-b";
const THEIRS = "agent-x";

function lead(id: string, name: string, agentId: string | null): Lead {
  return {
    id,
    business_name: name,
    agent_id: agentId,
    status: "Ready",
    follow_up_time: new Date(Date.now() + 86_400_000).toISOString(),
    created_at: "2026-08-01T00:00:00.000Z",
    deleted_at: null,
  } as unknown as Lead;
}

const leads = [
  lead("l1", "Closer Own Co", CLOSER),
  lead("l2", "Agent A Co", MINE_A),
  lead("l3", "Agent B Co", MINE_B),
  lead("l4", "Other Team Co", THEIRS),
  lead("l5", "Nobody Co", null),
];

const names = { [CLOSER]: "Casey Closer", [MINE_A]: "Ana", [MINE_B]: "Ben", [THEIRS]: "Xena" };

function mount(teamAgentIds: string[]) {
  return render(
    <ToastProvider>
      <PermissionProvider value={["leads.view", "leads.followup"]}>
        <FollowUpQueue
          leads={leads}
          agentNameById={names}
          currentUserId={CLOSER}
          teamAgentIds={teamAgentIds}
        />
      </PermissionProvider>
    </ToastProvider>,
  );
}

// useViewState mirrors filters to sessionStorage per pathname, so without
// this each test would inherit the previous one'''s scope.
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("My team scope", () => {
  it("is hidden for someone with no team", () => {
    mount([]);
    expect(screen.queryByRole("button", { name: /my team/i })).not.toBeInTheDocument();
  });

  it("shows every lead until the closer turns it on", () => {
    mount([MINE_A, MINE_B]);
    expect(screen.getByText("Other Team Co")).toBeInTheDocument();
    expect(screen.getByText("Agent A Co")).toBeInTheDocument();
  });

  it("narrows to the closer and their own agents, excluding another closer's agent and unassigned", () => {
    mount([MINE_A, MINE_B]);
    fireEvent.click(screen.getByRole("button", { name: /my team/i }));

    expect(screen.getByText("Closer Own Co")).toBeInTheDocument();
    expect(screen.getByText("Agent A Co")).toBeInTheDocument();
    expect(screen.getByText("Agent B Co")).toBeInTheDocument();
    expect(screen.queryByText("Other Team Co")).not.toBeInTheDocument();
    expect(screen.queryByText("Nobody Co")).not.toBeInTheDocument();
  });

  it("toggles back off", () => {
    mount([MINE_A, MINE_B]);
    const chip = screen.getByRole("button", { name: /my team/i });
    fireEvent.click(chip);
    expect(screen.queryByText("Other Team Co")).not.toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.getByText("Other Team Co")).toBeInTheDocument();
  });
});
