import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { emptyNewLead, type NewLeadFormState } from "@/lib/leads/newLeadForm";
import { leadDraftKey, LEAD_DRAFT_VERSION } from "@/lib/leads/leadDraft";

// Only the parts that talk to the network are stubbed; the form is the real one.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/leads/new",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({ has: () => true, hasAny: () => true, all: new Set(["leads.create", "leads.cat_set.not_ready"]) }),
}));
vi.mock("@/hooks/useDuplicateCheck", () => ({ useDuplicateCheck: () => [] }));
vi.mock("@/hooks/usePhotoExtension", () => ({ usePhotoExtension: () => ({ installed: false, version: null, capture: vi.fn() }) }));
vi.mock("@/hooks/useColorSchemeCheck", () => ({
  useColorSchemeCheck: () => ({ rejected: false, issues: [], checkNow: () => {}, aiUnavailable: false, suggestion: null }),
}));
vi.mock("@/components/leads/TemplateRecommendation", () => ({ TemplateRecommendation: () => null }));
vi.mock("@/components/leads/ExtensionInstallCard", () => ({ ExtensionInstallCard: () => null }));
vi.mock("@/components/email-verify/EmailFieldVerify", () => ({ EmailFieldVerify: () => null }));
vi.mock("@/components/leads/ColorSchemeField", () => ({ ColorSchemeField: () => null }));
vi.mock("@/hooks/useLiveLeads", () => ({ syncLeadsNow: () => {} }));
vi.mock("@/components/leads/HeaderChips", () => ({
  AreaChip: () => null,
  CategoryChip: ({ value, onSelect }: { value: string | null; onSelect: (v: string | null) => void }) => (
    <button type="button" onClick={() => onSelect("Plumber")}>{value ?? "Category"}</button>
  ),
}));

import { NewLeadForm } from "@/components/leads/NewLeadForm";

const USER = "agent-1";
const props = {
  agents: [],
  canAssign: false,
  canSetStatus: false,
  salesUsers: [],
  addons: [],
  currentUserId: USER,
  canOverrideDuplicate: false,
};

function validDraft(): NewLeadFormState {
  return {
    ...emptyNewLead("Not Ready"),
    site_type: "Custom Website",
    business_name: "Acme Plumbing",
    category: "Plumber",
    business_phone: "(252) 401-2775",
    business_email: "acme@example.com",
    platform: "Google",
    business_profile_link: "https://maps.google.com/acme",
    has_service_areas: "No",
    services: ["Plumbing"],
    client_experience: "5",
    specify_pages: ["Home", "About Us", "Contact Us"],
    color_scheme: "#0D9488, #FFFFFF",
    follow_up_time: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    price_quoted: "500",
    comments: "Solid lead",
    rating: 8,
    fresh_or_followup: "Fresh",
    closed_by: "self",
  };
}
const putDraft = (form: Partial<NewLeadFormState>) =>
  localStorage.setItem(leadDraftKey(USER), JSON.stringify({ v: LEAD_DRAFT_VERSION, savedAt: Date.now(), form }));
const stored = () => JSON.parse(localStorage.getItem(leadDraftKey(USER)) ?? "null");
const businessName = () => screen.getByPlaceholderText(/business name/i) as HTMLInputElement;

beforeEach(() => {
  localStorage.clear();
  window.scrollTo = vi.fn() as never;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});
afterEach(() => vi.unstubAllGlobals());

describe("New Lead form — the draft survives a refresh", () => {
  it("what the agent types is saved on this device", async () => {
    render(<NewLeadForm {...props} />);
    fireEvent.change(businessName(), { target: { value: "Jumbo's Pizza" } });
    await waitFor(() => expect(stored()?.form.business_name).toBe("Jumbo's Pizza"));
  });

  it("opening the form again brings the unsent lead back, and says so", () => {
    putDraft({ ...emptyNewLead("Not Ready"), business_name: "Jumbo's Pizza", services: ["Pizza"] });
    render(<NewLeadForm {...props} />);
    expect(businessName().value).toBe("Jumbo's Pizza");
    expect(screen.getByTestId("draft-restored").textContent).toMatch(/Restored the lead you were filling in/);
  });

  it("Clear form empties every field and forgets the draft — after a confirm", () => {
    putDraft({ ...emptyNewLead("Not Ready"), business_name: "Jumbo's Pizza" });
    render(<NewLeadForm {...props} />);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Clear form" })[0]);
    expect(businessName().value).toBe("Jumbo's Pizza"); // cancelled
    fireEvent.click(screen.getAllByRole("button", { name: "Clear form" })[0]);
    expect(businessName().value).toBe("");
    expect(localStorage.getItem(leadDraftKey(USER))).toBeNull();
    expect(screen.queryByTestId("draft-restored")).toBeNull();
    confirm.mockRestore();
  });

  it("a dropped connection on submit says so, frees the button, and keeps the draft", async () => {
    putDraft(validDraft());
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/leads") throw new TypeError("Failed to fetch");
      return new Response("{}");
    }));
    render(<NewLeadForm {...props} />);
    const submit = screen.getAllByRole("button", { name: /Submit Lead/ })[0];
    await act(async () => {
      fireEvent.click(submit);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't reach the server/);
    expect(screen.getAllByRole("button", { name: /Submit Lead/ })[0]).not.toBeDisabled();
    expect(stored()?.form.business_name).toBe("Acme Plumbing");
  });

  it("a successful submit forgets the draft", async () => {
    putDraft(validDraft());
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) =>
      String(url) === "/api/leads" ? new Response(JSON.stringify({ id: "new-lead" })) : new Response("{}"),
    ));
    render(<NewLeadForm {...props} />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Submit Lead/ })[0]);
    });
    await waitFor(() => expect(localStorage.getItem(leadDraftKey(USER))).toBeNull());
  });
});

describe("New Lead form — platform from the link", () => {
  const link = () => screen.getByPlaceholderText(/Paste the profile link/i);

  it("a Yelp link selects Yelp", () => {
    render(<NewLeadForm {...props} />);
    fireEvent.change(link(), { target: { value: "https://www.yelp.com/biz/acme" } });
    expect(screen.getByRole("button", { name: "Yelp" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("platform-detected").textContent).toMatch(/Yelp/);
  });

  it("another site picks Other and names it after the main domain", () => {
    render(<NewLeadForm {...props} />);
    fireEvent.change(link(), { target: { value: "https://xyz.abc.com/profile/1" } });
    // The platform field's own pills: the ones right after the link box.
    const pills = link().closest("[data-error], div")!.parentElement!;
    expect(within(pills).getByRole("button", { name: "Other" })).toHaveAttribute("aria-pressed", "true");
    expect((screen.getByPlaceholderText(/Facebook, Instagram/) as HTMLInputElement).value).toBe("Abc");
  });
});

describe("New Lead form — category and instructions", () => {
  it("submitting without a category points at it", async () => {
    putDraft({ ...validDraft(), category: "" });
    render(<NewLeadForm {...props} />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Submit Lead/ })[0]);
    });
    expect(screen.getByText(/Please choose the business category/)).toBeTruthy();
  });

  it("instructions are added one item at a time, with a 50-word counter", () => {
    render(<NewLeadForm {...props} />);
    const list = screen.getByTestId("instructions-list");
    fireEvent.change(within(list).getByLabelText("Instruction 1"), { target: { value: "Sticky header on mobile" } });
    fireEvent.click(within(list).getByRole("button", { name: /Add instruction/ }));
    const second = within(list).getByLabelText("Instruction 2");
    fireEvent.change(second, { target: { value: Array.from({ length: 51 }, () => "word").join(" ") } });
    expect(within(list).getByText(/51\/50 words/)).toBeTruthy();
    expect(within(list).getByText(/4\/50 words/)).toBeTruthy();
  });
});
