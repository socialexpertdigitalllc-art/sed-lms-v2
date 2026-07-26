import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunPreview, SlotEditor } from "@/components/site-studio/RunPreview";
import { ThemePanel } from "@/components/site-studio/ThemePanel";
import type { TemplateManifest } from "@/lib/site-studio/schema";
import type { StudioRunRow } from "@/lib/site-studio/run/types";

/**
 * Mount smoke tests, 2b/3b precedent (tests/siteStudioBoard.test.tsx,
 * tests/siteStudioCockpit.test.tsx): no real network, and — unlike the
 * cockpit's own tests — no fetch mocking is needed at all here, because
 * none of these assertions trigger a request: `RunPreview` takes its `run`
 * as a prop (no internal load), and `SlotEditor`/`ThemePanel` are mounted
 * directly, the same way `ImagePicker` is tested standalone in
 * siteStudioCockpit.test.tsx, rather than by simulating a real click
 * through the preview iframe (jsdom does not execute the iframe's own
 * navigation, so nothing inside it is reachable the way a browser click
 * would be — see RunPreview.tsx's own note on this).
 */

function runFixture(overrides: Partial<StudioRunRow> = {}): StudioRunRow {
  return {
    id: "run-1",
    lead_id: "lead-1",
    template_id: "tmpl-1",
    template_version: 1,
    status: "ready",
    options: {},
    content_doc: {
      identity: { business_name: "Ace Plumbing" },
      theme: { brand: "#112233" },
      pages: [
        {
          page_id: "index",
          output: "index.html",
          nav_title: "Home",
          title: "Welcome",
          slots: { hero_text: "We fix pipes fast.", hero_image: "img/a.jpg" },
          repeats: {},
        },
        {
          page_id: "svc",
          output: "services/plumbing.html",
          title: "Plumbing",
          slots: { svc_text: "About plumbing" },
          repeats: {},
        },
      ],
      provenance: [
        { title: { written_by: "ai" }, slots: { hero_text: { written_by: "operator" } }, repeats: {} },
        { title: { written_by: "ai" }, slots: { svc_text: { written_by: "ai" } }, repeats: {} },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    steps: {},
    client_photos: [],
    site_slug: "ace-plumbing-abc123",
    zip_path: "runs/run-1/site.zip",
    deployed_url: null,
    error: null,
    paused: false,
    created_by: null,
    created_at: "2026-07-25T00:00:00.000Z",
    updated_at: "2026-07-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("RunPreview", () => {
  it("renders the preview iframe with the page index and version query", () => {
    render(<RunPreview run={runFixture()} onRunUpdated={() => {}} />);
    const frame = screen.getByTitle("Site preview") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe(
      `/api/site-studio/runs/run-1/preview?page=0&v=${encodeURIComponent("2026-07-26T00:00:00.000Z")}`,
    );
  });

  it("renders one page control per doc page", () => {
    render(<RunPreview run={runFixture()} onRunUpdated={() => {}} />);
    expect(screen.getAllByTestId("ss-page-tab")).toHaveLength(2);
    expect(screen.getByText(/home/i)).toBeInTheDocument();
    expect(screen.getByText(/services\/plumbing\.html/)).toBeInTheDocument();
  });

  it("the width toggle changes the iframe's container width, not its src", () => {
    render(<RunPreview run={runFixture()} onRunUpdated={() => {}} />);
    const wrap = screen.getByTestId("ss-preview-frame");
    const frame = screen.getByTitle("Site preview") as HTMLIFrameElement;
    const originalSrc = frame.getAttribute("src");
    expect(wrap).toHaveStyle({ width: "100%" });

    fireEvent.click(screen.getByRole("button", { name: /mobile width/i }));
    expect(wrap).toHaveStyle({ width: "375px" });
    expect(frame.getAttribute("src")).toBe(originalSrc);

    fireEvent.click(screen.getByRole("button", { name: /desktop width/i }));
    expect(wrap).toHaveStyle({ width: "100%" });
  });

  it("shows a disabled Deploy button (Task 9 not shipped yet) only when the run is ready", () => {
    const { rerender } = render(<RunPreview run={runFixture({ status: "ready" })} onRunUpdated={() => {}} />);
    const deployBtn = screen.getByRole("button", { name: /deploy/i });
    expect(deployBtn).toBeDisabled();
    expect(deployBtn).toHaveAttribute("title", "Deploy lands in Task 9");

    rerender(<RunPreview run={runFixture({ status: "rendering" })} onRunUpdated={() => {}} />);
    expect(screen.queryByRole("button", { name: /deploy/i })).not.toBeInTheDocument();
  });
});

describe("SlotEditor", () => {
  it("shows the revert button only when the field is operator-owned", () => {
    const { rerender } = render(
      <SlotEditor
        title="hero_text"
        value="We fix pipes fast."
        operatorOwned={true}
        onSave={async () => {}}
        onRevert={async () => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /revert to ai/i })).toBeInTheDocument();

    rerender(
      <SlotEditor
        title="svc_text"
        value="About plumbing"
        operatorOwned={false}
        onSave={async () => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /revert to ai/i })).not.toBeInTheDocument();
  });
});

const manifestFixture: TemplateManifest = {
  engine: 3,
  name: "plumberpro",
  version: 1,
  identity: { business_name: "PlumberPro" },
  theme: { mode: "css_vars", roles: { brand: { hex: "#112233" }, accent: { var: "--accent", hex: "#445566" } } },
  nav: [],
  pages: [
    { id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home", slots: [], repeats: [] },
  ],
};

describe("ThemePanel", () => {
  it("renders one color input per manifest-declared role", () => {
    render(
      <ThemePanel
        runId="run-1"
        manifest={manifestFixture}
        theme={{ brand: "#112233", accent: "#445566" }}
        onRunUpdated={() => {}}
      />,
    );
    expect(screen.getByLabelText("Theme role brand")).toBeInTheDocument();
    expect(screen.getByLabelText("Theme role accent")).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="color"]')).toHaveLength(2);
  });

  it("renders nothing when the template declares no theme roles", () => {
    const noRoles: TemplateManifest = { ...manifestFixture, theme: { mode: "none", roles: {} } };
    const { container } = render(
      <ThemePanel runId="run-1" manifest={noRoles} theme={{}} onRunUpdated={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
