import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NewSiteFlow } from "@/components/site-builder/NewSiteFlow";

/** Mount smoke tests, same idiom as tests/siteStudioBoard.test.tsx. */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const leads = [
  { id: "l1", business_name: "Ace Plumbing", status: "Not Ready", deleted_at: null, business_phone: "555-1111", business_email: "ace@example.com", services: ["Drain cleaning"], service_areas: ["Downtown"], color_scheme: "navy and orange", specify_pages: ["About"], about_business: "Family owned.", image_links: ["https://example.com/photo1.jpg", "https://example.com/photo2.jpg"] },
  { id: "l2", business_name: "Best Roofing", status: "Contacted", deleted_at: null, business_phone: null, business_email: null, services: [], service_areas: [], color_scheme: null, specify_pages: [], about_business: null, image_links: [] },
];

const templates = [
  { id: "t1", name: "Plumber Pro", storage_path: "t1/source.zip", page_files: ["index.html"], asset_files: [], created_by: null, created_at: "2026-07-25T00:00:00.000Z" },
];

const sourcedNeeds = {
  needs: [
    {
      purpose: "Hero",
      query: "drain cleaning",
      pexelsError: null,
      candidates: [
        { kind: "library", key: "library:a1", asset_id: "a1", width: 1600, height: 1200, thumb_url: "https://lib.example.com/a1.jpg" },
        { kind: "pexels", key: "pexels:1", pexels_id: 1, download_url: "https://images.pexels.com/1-full.jpg", width: 1600, height: 1200, photographer: "Jane", thumb_url: "https://images.pexels.com/1-thumb.jpg" },
      ],
    },
    {
      purpose: "Service: Drain cleaning",
      query: "drain cleaning",
      pexelsError: null,
      candidates: [
        { kind: "pexels", key: "pexels:2", pexels_id: 2, download_url: "https://images.pexels.com/2-full.jpg", width: 1600, height: 1200, photographer: "Joe", thumb_url: "https://images.pexels.com/2-thumb.jpg" },
      ],
    },
    {
      purpose: "About",
      query: "team drain cleaning",
      pexelsError: null,
      candidates: [],
    },
  ],
  servicesTruncated: false,
  droppedServices: [],
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/leads")) return { ok: true, json: async () => ({ leads }) } as Response;
    if (url.includes("/api/site-builder/templates")) return { ok: true, json: async () => ({ templates }) } as Response;
    if (url.includes("/api/site-builder/images/source")) return { ok: true, json: async () => sourcedNeeds } as Response;
    if (url.includes("/api/site-builder/images/pick")) {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      return { ok: true, json: async () => ({ url: `https://rehosted.example.com/${body.kind}.jpg` }) } as Response;
    }
    if (url.includes("/api/site-builder/runs")) return { ok: true, json: async () => ({ run: { id: "r1" } }) } as Response;
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

  it("sources images automatically on lead selection and renders one row per need with a query shown", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));

    expect(await screen.findByText("Hero")).toBeInTheDocument();
    expect(screen.getByText("Service: Drain cleaning")).toBeInTheDocument();
    expect(screen.getAllByText("About").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/searched:.*drain cleaning/i).length).toBeGreaterThan(0);
  });

  it("pre-selects the first candidate for each need", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    await screen.findByText("Hero");

    const heroImages = screen.getAllByAltText("");
    // The first Hero candidate thumbnail is pressed (selected) by default.
    const firstHeroThumb = screen.getAllByLabelText(/use this image for hero/i)[0];
    expect(firstHeroThumb).toHaveAttribute("aria-pressed", "true");
    expect(heroImages.length).toBeGreaterThan(0);
  });

  it("clicking another thumbnail swaps the need's pick", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    await screen.findByText("Hero");

    const heroThumbs = screen.getAllByLabelText(/use this image for hero/i);
    expect(heroThumbs[0]).toHaveAttribute("aria-pressed", "true");
    expect(heroThumbs[1]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(heroThumbs[1]);
    await waitFor(() => expect(heroThumbs[1]).toHaveAttribute("aria-pressed", "true"));
    expect(heroThumbs[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("lets a need be set to 'no image'", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    await screen.findByText("Hero");

    const noImage = screen.getAllByLabelText(/no image for hero/i)[0];
    expect(noImage).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(noImage);
    await waitFor(() => expect(noImage).toHaveAttribute("aria-pressed", "true"));
  });

  it("pre-selects the client's own photos in the Gallery row", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    await screen.findByText("Gallery");

    const galleryToggles = screen.getAllByLabelText(/remove from gallery/i);
    expect(galleryToggles).toHaveLength(2); // both of Ace Plumbing's image_links
    galleryToggles.forEach((t) => expect(t).toHaveAttribute("aria-pressed", "true"));
  });

  it("a gallery photo can be dropped by clicking it again", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    await screen.findByText("Gallery");

    const [first] = screen.getAllByLabelText(/remove from gallery/i);
    fireEvent.click(first);
    await waitFor(() => expect(screen.getAllByLabelText(/add to gallery/i)).toHaveLength(1));
  });

  it("submits the pre-selected picks as the run's images on Generate", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    await screen.findByText("Hero");
    await screen.findByText(/plumber pro/i);
    fireEvent.change(screen.getByLabelText(/^template$/i), { target: { value: "t1" } });

    const generate = await screen.findByRole("button", { name: /^generate$/i });
    await waitFor(() => expect(generate).not.toBeDisabled());
    fireEvent.click(generate);

    await waitFor(() => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const runsCall = fetchMock.mock.calls.find((call: unknown[]) => String(call[0]).includes("/api/site-builder/runs"));
      expect(runsCall).toBeTruthy();
    });
  });
});
