import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RunLaunch } from "@/components/site-studio/RunLaunch";
import { RunCockpit } from "@/components/site-studio/RunCockpit";
import { ImagePicker } from "@/components/site-studio/ImagePicker";
import { AssetLibrary } from "@/components/site-studio/AssetLibrary";

/**
 * Mount smoke tests, 2b precedent (tests/siteStudioBoard.test.tsx): the
 * cockpit and library are only ever exercised behind a login, so a
 * crash-on-mount would otherwise reach an operator before anyone noticed.
 * Fetch is stubbed per URL+method; no real network, no timers advanced.
 */

function stubFetch(handler: (url: string, method: string, body: unknown) => { status?: number; body: unknown }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let parsedBody: unknown = null;
    if (typeof init?.body === "string") {
      try { parsedBody = JSON.parse(init.body); } catch { parsedBody = init.body; }
    }
    const { status = 200, body } = handler(url, method, parsedBody);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  }));
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const leadsFixture = [
  {
    id: "lead-1", business_name: "Ace Plumbing", status: "Not Ready", deleted_at: null,
    business_phone: "555-1000", business_email: "ace@example.com",
    services: ["Drain Cleaning"], service_areas: ["Springfield"], specify_pages: ["Home", "Contact"],
  },
  {
    id: "lead-2", business_name: "Bright Roofing", status: "Ready", deleted_at: null,
    business_phone: null, business_email: null, services: [], service_areas: [], specify_pages: [],
  },
];

const templatesFixture = [
  { id: "tmpl-1", name: "Plumber Pro", status: "certified", version: 1 },
  { id: "tmpl-2", name: "Draft Template", status: "needs_review", version: 1 },
];

describe("RunLaunch", () => {
  it("renders and shows only Not Ready leads, filtering further by search", async () => {
    stubFetch((url) => {
      if (url.includes("/api/leads")) return { body: { leads: leadsFixture } };
      if (url.includes("/api/site-studio/templates")) return { body: { templates: templatesFixture } };
      return { body: {} };
    });
    render(<RunLaunch onClose={() => {}} onCreated={() => {}} />);

    expect(await screen.findByText("Ace Plumbing")).toBeInTheDocument();
    // "Ready" leads are never offered — only "Not Ready" is eligible for a new run.
    expect(screen.queryByText("Bright Roofing")).not.toBeInTheDocument();
    // certified-only template picker
    expect(screen.getByText("Plumber Pro")).toBeInTheDocument();
    expect(screen.queryByText("Draft Template")).not.toBeInTheDocument();

    const search = screen.getByLabelText(/search leads/i) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "nomatch" } });
    await waitFor(() => expect(screen.queryByText("Ace Plumbing")).not.toBeInTheDocument());
  });
});

const manifestFixture = {
  engine: 3, name: "plumberpro", version: 1,
  identity: { business_name: "PlumberPro" },
  theme: { mode: "none", roles: {} },
  nav: [],
  pages: [
    {
      id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home",
      slots: [
        { id: "hero_text", type: "text", sample: "Sample hero text", html: false },
        { id: "hero_image", type: "image", sample: "img/hero.jpg", html: false },
        { id: "hero_image_alt", type: "text", sample: "Sample alt", html: false },
      ],
      repeats: [],
    },
  ],
};

function runFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    lead_id: "lead-1",
    template_id: "tmpl-1",
    template_version: 1,
    status: "reviewing",
    options: {},
    content_doc: {
      identity: { business_name: "Ace Plumbing" },
      theme: {},
      pages: [
        {
          page_id: "index",
          output: "index.html",
          title: "Welcome to Ace Plumbing",
          slots: { hero_text: "We fix pipes fast.", hero_image: "img/hero.jpg", hero_image_alt: "A plumber at work" },
          repeats: {},
        },
      ],
      provenance: [
        { title: { written_by: "ai" }, slots: { hero_text: { written_by: "ai" } }, repeats: {} },
      ],
    },
    steps: {
      prepare: { at: "2026-07-25T00:00:00.000Z", pages: 1 },
      write: { pages: { "0": { status: "written", attempts: 1 } } },
      images: { slots: { "0:hero_image": { query: "plumber team", candidates: [], sourced_at: "2026-07-25T00:00:00.000Z" } } },
    },
    client_photos: [],
    site_slug: "ace-plumbing-abc123",
    zip_path: null,
    deployed_url: null,
    error: null,
    paused: false,
    created_by: null,
    created_at: "2026-07-25T00:00:00.000Z",
    updated_at: "2026-07-25T00:00:00.000Z",
    ...overrides,
  };
}

function stubRunAndTemplate(run: unknown) {
  stubFetch((url) => {
    if (url.includes("/api/site-studio/runs/run-1/step")) return { body: { run, done: true, claimed: true } };
    if (url.includes("/api/site-studio/runs/run-1")) return { body: { run } };
    if (url.includes("/api/site-studio/templates/tmpl-1")) return { body: { template: { id: "tmpl-1", manifest: manifestFixture } } };
    return { body: {} };
  });
}

describe("RunCockpit", () => {
  it("renders a page card with its slot content from a canned run at the gate", async () => {
    stubRunAndTemplate(runFixture());
    render(<RunCockpit runId="run-1" />);

    expect(await screen.findByText("Welcome to Ace Plumbing")).toBeInTheDocument();
    expect(screen.getByText("We fix pipes fast.")).toBeInTheDocument();
    expect(screen.getByText(/using template sample/i)).toBeInTheDocument();
  });

  it("shows the gate footer only when status is reviewing", async () => {
    stubRunAndTemplate(runFixture());
    render(<RunCockpit runId="run-1" />);
    expect(await screen.findByRole("button", { name: /approve & render/i })).toBeInTheDocument();
  });

  it("does not show the gate footer for a terminal (ready) run", async () => {
    stubRunAndTemplate(runFixture({ status: "ready", zip_path: "runs/run-1/site.zip" }));
    render(<RunCockpit runId="run-1" />);
    expect(await screen.findByRole("button", { name: /download site/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve & render/i })).not.toBeInTheDocument();
  });

  it("shows a paused banner when the run is paused", async () => {
    stubRunAndTemplate(runFixture({ status: "preparing", paused: true }));
    render(<RunCockpit runId="run-1" />);
    expect(await screen.findByText(/paused/i)).toBeInTheDocument();
  });

  it("shows the run's error verbatim in the failed state, with no resurrect button", async () => {
    stubRunAndTemplate(runFixture({ status: "failed", error: "Write failed: page 0 exhausted its attempts" }));
    render(<RunCockpit runId="run-1" />);
    expect(await screen.findByText("Write failed: page 0 exhausted its attempts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});

describe("ImagePicker", () => {
  it("renders sourced candidates from canned state", async () => {
    stubFetch((url) => {
      if (url.includes("/images")) {
        return {
          body: {
            slots: {
              "0:hero_image": {
                query: "plumber team",
                candidates: [
                  { kind: "pexels", pexels_id: 42, thumb_url: "https://img.example/thumb.jpg", download_url: "https://img.example/full.jpg", width: 1600, height: 1200, photographer: "Ana" },
                ],
                sourced_at: "2026-07-25T00:00:00.000Z",
              },
            },
          },
        };
      }
      return { body: {} };
    });

    render(
      <ImagePicker
        runId="run-1"
        leadId="lead-1"
        pageIndex={0}
        slotId="hero_image"
        clientPhotos={[]}
        altValue="A plumber at work"
        onEditAlt={async () => {}}
        onPicked={() => {}}
        onClose={() => {}}
      />,
    );

    expect(await screen.findByText(/photo by ana/i)).toBeInTheDocument();
  });
});

const assetsFixture = [
  {
    id: "a1", kind: "stock", lead_id: null, subject: "plumber van", niche_tags: ["plumbing"],
    width: 1600, height: 1200, source: "pexels", pexels_id: 1, photographer: "Ana",
    storage_path: "a1.jpg", content_type: "image/jpeg", use_count: 2, created_at: "2026-07-25T00:00:00.000Z",
    thumb_url: "https://img.example/a1.jpg",
  },
  {
    id: "a2", kind: "client", lead_id: "lead-1", subject: "storefront", niche_tags: [],
    width: 800, height: 600, source: "upload", pexels_id: null, photographer: null,
    storage_path: "a2.jpg", content_type: "image/jpeg", use_count: 0, created_at: "2026-07-25T00:00:00.000Z",
    thumb_url: "https://img.example/a2.jpg",
  },
];

describe("AssetLibrary", () => {
  it("renders a grid from canned rows", async () => {
    stubFetch((url) => {
      if (url.includes("/api/leads")) return { body: { leads: [{ id: "lead-1", business_name: "Ace Plumbing" }] } };
      if (url.includes("/api/site-studio/assets")) return { body: { assets: assetsFixture } };
      return { body: {} };
    });
    render(<AssetLibrary />);
    expect(await screen.findByText("plumber van")).toBeInTheDocument();
    expect(screen.getByText("storefront")).toBeInTheDocument();
    // client-owned card names its lead and carries the fence badge
    expect(screen.getByText(/never offered to other clients/i)).toBeInTheDocument();
  });

  it("filters by kind when a chip is clicked", async () => {
    stubFetch((url) => {
      if (url.includes("/api/leads")) return { body: { leads: [] } };
      if (url.includes("/api/site-studio/assets")) {
        const kind = new URL(url, "http://x").searchParams.get("kind");
        const rows = kind === "client" ? assetsFixture.filter((a) => a.kind === "client") : assetsFixture;
        return { body: { assets: rows } };
      }
      return { body: {} };
    });
    render(<AssetLibrary />);
    await screen.findByText("plumber van");

    fireEvent.click(screen.getByRole("button", { name: /^client$/i }));
    await waitFor(() => expect(screen.queryByText("plumber van")).not.toBeInTheDocument());
    expect(screen.getByText("storefront")).toBeInTheDocument();
  });
});
