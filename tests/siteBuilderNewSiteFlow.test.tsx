import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NewSiteFlow } from "@/components/site-builder/NewSiteFlow";

/** Mount smoke tests, same idiom as tests/siteStudioBoard.test.tsx. */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const leads = [
  { id: "l1", business_name: "Ace Plumbing", status: "Not Ready", deleted_at: null, business_phone: "555-1111", business_email: "ace@example.com", services: ["Drain cleaning"], service_areas: ["Downtown"], color_scheme: "navy and orange", specify_pages: ["About"], about_business: "Family owned.", image_links: ["https://example.com/photo1.jpg"] },
  { id: "l2", business_name: "Best Roofing", status: "Contacted", deleted_at: null, business_phone: null, business_email: null, services: [], service_areas: [], color_scheme: null, specify_pages: [], about_business: null, image_links: [] },
];

const templates = [
  { id: "t1", name: "Plumber Pro", storage_path: "t1/source.zip", page_files: ["index.html"], asset_files: [], created_by: null, created_at: "2026-07-25T00:00:00.000Z" },
];

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/leads")) return { ok: true, json: async () => ({ leads }) } as Response;
    if (url.includes("/api/site-builder/templates")) return { ok: true, json: async () => ({ templates }) } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NewSiteFlow", () => {
  it("only lists 'Not Ready' leads, and filters by search", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    // Contacted lead never shown — the flow only offers "Not Ready" leads
    await screen.findByText("Ace Plumbing");
    expect(screen.queryByText("Best Roofing")).not.toBeInTheDocument();

    const search = screen.getByLabelText(/search leads/i) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "zzz-no-match" } });
    await waitFor(() => expect(screen.queryByText("Ace Plumbing")).not.toBeInTheDocument());
  });

  it("shows the lead's read-only details on selection", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    expect(await screen.findByText("555-1111")).toBeInTheDocument();
    expect(screen.getByText("ace@example.com")).toBeInTheDocument();
    expect(screen.getByText("Drain cleaning")).toBeInTheDocument();
  });

  it("keeps Generate disabled until both a lead and a template are picked", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    const generate = await screen.findByRole("button", { name: /^generate$/i });
    expect(generate).toBeDisabled();

    fireEvent.click(await screen.findByText("Ace Plumbing"));
    expect(generate).toBeDisabled();

    await screen.findByText(/plumber pro/i);
    fireEvent.change(screen.getByLabelText(/^template$/i), { target: { value: "t1" } });
    await waitFor(() => expect(generate).not.toBeDisabled());
  });
});
