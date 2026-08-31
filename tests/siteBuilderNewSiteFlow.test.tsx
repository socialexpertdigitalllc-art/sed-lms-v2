import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { NewSiteFlow } from "@/components/site-builder/NewSiteFlow";

/** Mount smoke tests, same idiom as tests/siteStudioBoard.test.tsx. */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const leads = [
  { id: "l1", business_name: "Ace Plumbing", status: "Not Ready", deleted_at: null, business_phone: "555-1111", business_email: "ace@example.com", services: ["Drain cleaning", "Water heaters"], service_areas: ["Downtown"], color_scheme: "navy and orange", specify_pages: ["About"], about_business: "Family owned.", image_links: ["https://example.com/photo1.jpg", "https://example.com/photo2.jpg"] },
  { id: "l2", business_name: "Best Roofing", status: "Contacted", deleted_at: null, business_phone: null, business_email: null, services: [], service_areas: [], color_scheme: null, specify_pages: [], about_business: null, image_links: [] },
];

const templates = [
  { id: "t1", name: "Plumber Pro", storage_path: "t1/source.zip", page_files: ["index.html"], asset_files: [], created_by: null, created_at: "2026-07-25T00:00:00.000Z" },
];

const sourcedImages = {
  hero: [
    { kind: "library", key: "library:a1", asset_id: "a1", width: 1600, height: 1200, thumb_url: "https://lib.example.com/a1.jpg" },
    { kind: "library", key: "library:a2", asset_id: "a2", width: 1600, height: 1200, thumb_url: "https://lib.example.com/a2.jpg" },
    { kind: "pexels", key: "pexels:1", pexels_id: 1, download_url: "https://images.pexels.com/1-full.jpg", width: 1600, height: 1200, photographer: "Jane", thumb_url: "https://images.pexels.com/1-thumb.jpg" },
    { kind: "pexels", key: "pexels:2", pexels_id: 2, download_url: "https://images.pexels.com/2-full.jpg", width: 1600, height: 1200, photographer: "Joe", thumb_url: "https://images.pexels.com/2-thumb.jpg" },
    { kind: "client", key: "client:https://example.com/photo1.jpg", url: "https://example.com/photo1.jpg", thumb_url: "https://example.com/photo1.jpg" },
  ],
  services: [
    {
      service: "Drain cleaning",
      purpose: "Service: Drain cleaning",
      query: "Drain cleaning",
      pexelsError: null,
      candidates: [
        { kind: "pexels", key: "pexels:10", pexels_id: 10, download_url: "https://images.pexels.com/10-full.jpg", width: 1600, height: 1200, photographer: "Joe", thumb_url: "https://images.pexels.com/10-thumb.jpg" },
      ],
    },
    {
      service: "Water heaters",
      purpose: "Service: Water heaters",
      query: "Water heaters",
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
    if (url.includes("/api/site-builder/images/source")) return { ok: true, json: async () => sourcedImages } as Response;
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
    expect(screen.getByText("Drain cleaning, Water heaters")).toBeInTheDocument();
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

  it("sources images automatically on lead selection: a Hero row plus one row per service — no About row", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));

    expect(await screen.findByText("Hero")).toBeInTheDocument();
    expect(screen.getByText("Service: Drain cleaning")).toBeInTheDocument();
    expect(screen.getByText("Service: Water heaters")).toBeInTheDocument();
    // No "About" image row — that was never asked for and has been dropped.
    // (The lead detail card above legitimately shows the word "About" twice —
    // once as the about_business label, once because "About" is one of this
    // lead's requested pages — so scope the check to the Images section.)
    const imagesSection = screen.getByText("3. Images").closest("section") as HTMLElement;
    expect(within(imagesSection).queryByText("About")).not.toBeInTheDocument();
  });

  it("pre-selects the first 3 Hero candidates by default", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    await screen.findByText("Hero");

    const heroThumbs = screen.getAllByLabelText(/use this image for hero/i);
    expect(heroThumbs).toHaveLength(5);
    expect(heroThumbs.slice(0, 3).every((t) => t.getAttribute("aria-pressed") === "true")).toBe(true);
    expect(heroThumbs.slice(3).every((t) => t.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(screen.getByText(/pick up to 3.*3 selected/i)).toBeInTheDocument();
  });

  it("caps Hero selection at 3 — a 4th click is a no-op until one is deselected", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    await screen.findByText("Hero");

    const heroThumbs = screen.getAllByLabelText(/use this image for hero/i);
    // First 3 already selected by default; clicking a 4th must not select it.
    fireEvent.click(heroThumbs[3]);
    await waitFor(() => expect(screen.getByText(/pick up to 3.*3 selected/i)).toBeInTheDocument());
    expect(heroThumbs[3]).toHaveAttribute("aria-pressed", "false");

    // Deselecting one frees a slot for another.
    fireEvent.click(heroThumbs[0]);
    await waitFor(() => expect(heroThumbs[0]).toHaveAttribute("aria-pressed", "false"));
    fireEvent.click(heroThumbs[3]);
    await waitFor(() => expect(heroThumbs[3]).toHaveAttribute("aria-pressed", "true"));
  });

  it("allows fewer than 3 Hero picks — deselecting down to zero is fine", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    await screen.findByText("Hero");

    const heroThumbs = screen.getAllByLabelText(/use this image for hero/i);
    fireEvent.click(heroThumbs[0]);
    fireEvent.click(heroThumbs[1]);
    fireEvent.click(heroThumbs[2]);
    await waitFor(() => expect(screen.getByText(/pick up to 3.*0 selected/i)).toBeInTheDocument());
  });

  it("service rows stay single-select", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    await screen.findByText("Service: Drain cleaning");

    const rowThumbs = screen.getAllByLabelText(/use this image for service: drain cleaning/i);
    expect(rowThumbs).toHaveLength(1);
    expect(rowThumbs[0]).toHaveAttribute("aria-pressed", "true"); // pre-selected

    const noImage = screen.getAllByLabelText(/no image for service: drain cleaning/i)[0];
    fireEvent.click(noImage);
    await waitFor(() => expect(noImage).toHaveAttribute("aria-pressed", "true"));
    expect(rowThumbs[0]).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(rowThumbs[0]);
    await waitFor(() => expect(rowThumbs[0]).toHaveAttribute("aria-pressed", "true"));
    expect(noImage).toHaveAttribute("aria-pressed", "false");
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

  /**
   * Generate is meant to be the LAST click: the operator picks a lead and a
   * template, and the site goes live on its own. Auto deploy shipped opt-in
   * and the operator ticked it on every single run, so the default was simply
   * wrong — it stays a checkbox only as an escape hatch for a client whose
   * site must not publish itself.
   */
  it("deploys automatically by default — Generate is the only click needed", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    await screen.findByText("Hero");
    fireEvent.change(screen.getByLabelText(/^template$/i), { target: { value: "t1" } });

    const autoDeploy = screen.getByRole("checkbox", { name: /auto deploy/i });
    expect(autoDeploy).toBeChecked();

    const generate = await screen.findByRole("button", { name: /^generate$/i });
    await waitFor(() => expect(generate).not.toBeDisabled());
    fireEvent.click(generate);

    await waitFor(() => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const runsCall = fetchMock.mock.calls.find(
        (call: unknown[]) => String(call[0]).includes("/api/site-builder/runs") && (call[1] as RequestInit)?.method === "POST",
      );
      expect(runsCall).toBeTruthy();
      const sent = JSON.parse(String((runsCall![1] as RequestInit).body)) as { options: { auto_deploy: boolean } };
      expect(sent.options.auto_deploy).toBe(true);
    });
  });

  it("still lets the operator opt OUT of publishing before generating", async () => {
    stubFetch();
    render(<NewSiteFlow />);
    fireEvent.click(await screen.findByText("Ace Plumbing"));
    await screen.findByText("Hero");
    fireEvent.change(screen.getByLabelText(/^template$/i), { target: { value: "t1" } });

    fireEvent.click(screen.getByRole("checkbox", { name: /auto deploy/i }));

    const generate = await screen.findByRole("button", { name: /^generate$/i });
    await waitFor(() => expect(generate).not.toBeDisabled());
    fireEvent.click(generate);

    await waitFor(() => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const runsCall = fetchMock.mock.calls.find(
        (call: unknown[]) => String(call[0]).includes("/api/site-builder/runs") && (call[1] as RequestInit)?.method === "POST",
      );
      expect(runsCall).toBeTruthy();
      const sent = JSON.parse(String((runsCall![1] as RequestInit).body)) as { options: { auto_deploy: boolean } };
      expect(sent.options.auto_deploy).toBe(false);
    });
  });
});
