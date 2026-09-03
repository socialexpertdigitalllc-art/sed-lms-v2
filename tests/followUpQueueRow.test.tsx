import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FollowUpQueue } from "@/components/leads/FollowUpQueue";
import { PermissionProvider } from "@/providers/PermissionProvider";
import type { Lead } from "@/lib/leads/types";
import { SPECIFIC_TTL_MS } from "@/lib/leads/followups";

/**
 * The Follow-ups page IS the calling queue: the number being dialled belongs on
 * the row, and a Specific badge has to stop claiming an appointment that aged
 * out a day ago.
 */

// The queue subscribes to realtime; these tests only exercise the row.
vi.mock("@/hooks/useRealtimeRefresh", () => ({ useRealtimeRefresh: () => {} }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/leads/follow-ups",
  useSearchParams: () => new URLSearchParams(),
}));

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ pickup: null }) }));
  vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
});
afterEach(() => vi.unstubAllGlobals());

function lead(over: Partial<Lead>): Lead {
  return {
    id: "lead-1",
    status: "Ready",
    agent_id: "agent-1",
    business_name: "Ridgeline Roofing",
    business_phone: "(252) 401-2775",
    business_email: null,
    no_email: null,
    business_profile_link: null,
    website_link: null,
    logo_link: null,
    logo_via_sms: null,
    map_embed_link: null,
    site_type: null,
    platform: null,
    services: null,
    service_areas: null,
    has_service_areas: null,
    client_experience: null,
    num_webpages: null,
    specify_pages: null,
    color_scheme: null,
    color_same_as_logo: null,
    add_ons: null,
    price_quoted: null,
    yearly_price: null,
    follow_up_time: new Date(Date.now() + 3_600_000).toISOString(),
    last_followup_status: "No Pickup",
    no_pickup_streak: 1,
    closed_at: null,
    dropped_at: null,
    first_touch_at: null,
    direct_line_saved: null,
    fresh_or_followup: null,
    reference_link: null,
    design_reference_links: null,
    image_links: null,
    rating: null,
    comments: null,
    about_business: null,
    created_by: null,
    closed_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    ...over,
  } as Lead;
}

function mount(leads: Lead[]) {
  return render(
    <PermissionProvider value={["leads.view", "leads.followup"]}>
      <FollowUpQueue leads={leads} agentNameById={{ "agent-1": "Sam" }} currentUserId="me" />
    </PermissionProvider>,
  );
}

describe("Follow-ups row", () => {
  it("shows the lead's phone number as a dialable link", () => {
    mount([lead({})]);
    const tel = screen.getByRole("link", { name: "(252) 401-2775" });
    expect(tel).toHaveAttribute("href", "tel:(252) 401-2775");
  });

  it("offers a copy button for that number", () => {
    mount([lead({})]);
    expect(screen.getByRole("button", { name: /copy phone/i })).toBeInTheDocument();
  });

  it("carries the hoverable follow-up pill, not the bare chip", () => {
    mount([lead({})]);
    expect(screen.getByText("No Pickup").closest("[data-fu-chip]")).not.toBeNull();
  });

  it("offers the tick and cross quick actions", () => {
    mount([lead({})]);
    expect(screen.getByRole("button", { name: /log a pickup/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /no pickup follow-up and retry/i })).toBeInTheDocument();
  });
});

describe("Specific badge decay on the queue", () => {
  const recent = new Date(Date.now() - 60_000).toISOString();
  const aged = new Date(Date.now() - SPECIFIC_TTL_MS - 60_000).toISOString();

  // The row badge and the toolbar filter both read "Specific"; the badge is the
  // one that explains itself in a title, so target that.
  const badge = () => screen.queryByTitle(/asked for this exact time/i);

  it("badges a specific follow-up logged within the day", () => {
    mount([lead({ follow_up_is_specific: true, follow_up_set_at: recent })]);
    expect(badge()).toBeInTheDocument();
  });

  it("drops the badge once the day has passed", () => {
    mount([lead({ follow_up_is_specific: true, follow_up_set_at: aged })]);
    expect(badge()).not.toBeInTheDocument();
  });

  it("keeps badging a lead written before the set-at column existed", () => {
    mount([lead({ follow_up_is_specific: true, follow_up_set_at: null })]);
    expect(badge()).toBeInTheDocument();
  });

  it("counts only the still-active ones on the Specific filter", () => {
    mount([
      lead({ id: "a", follow_up_is_specific: true, follow_up_set_at: recent }),
      lead({ id: "b", business_name: "Bayside", follow_up_is_specific: true, follow_up_set_at: aged }),
    ]);
    expect(screen.getByRole("button", { name: /^Specific \(1\)$/ })).toBeInTheDocument();
  });
});
