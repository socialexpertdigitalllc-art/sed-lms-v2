import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BuilderRun } from "@/components/site-builder/BuilderRun";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/** Mount smoke tests, same idiom as tests/siteStudioBoard.test.tsx. */

function runFixture(status: "review" | "approved" | "deployed") {
  return {
    id: "run-1",
    lead_id: "lead-1",
    template_id: "tmpl-1",
    status,
    images: [],
    pages: {
      "index.html": { status: "ok", kind: "existing", html: "<!doctype html><html><body>Home</body></html>" },
      "about.html": { status: "failed", kind: "existing", error: "reply contained no HTML" },
    },
    output_path: status === "deployed" || status === "approved" ? "run-1/site.zip" : null,
    deployed_url: status === "deployed" ? "https://ace-plumbing.example.com" : null,
    error: null,
    created_at: "2026-07-25T00:00:00.000Z",
    updated_at: "2026-07-25T00:00:00.000Z",
  };
}

function stubFetch(run: ReturnType<typeof runFixture>) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ run }) } as Response)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BuilderRun", () => {
  it("shows per-page state, including a failed page's error and Retry", async () => {
    stubFetch(runFixture("review"));
    render(<BuilderRun runId="run-1" />);
    expect(await screen.findByText(/^OK$/)).toBeInTheDocument();
    expect(screen.getByText(/^Failed$/)).toBeInTheDocument();
    expect(screen.getByText(/reply contained no HTML/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("offers the regenerate-with-instruction control for the previewed page, and Approve (not Deploy) at review", async () => {
    stubFetch(runFixture("review"));
    render(<BuilderRun runId="run-1" />);
    await screen.findByTestId("sb-preview-frame");
    expect(screen.getByLabelText(/regenerate "index.html"/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /regenerate this page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^deploy$/i })).not.toBeInTheDocument();
  });

  it("offers Deploy (not Approve) once the run is approved", async () => {
    stubFetch(runFixture("approved"));
    render(<BuilderRun runId="run-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^deploy$/i })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
  });

  it("shows the deployed URL and no Approve/Deploy buttons once deployed", async () => {
    stubFetch(runFixture("deployed"));
    render(<BuilderRun runId="run-1" />);
    expect(await screen.findByText("https://ace-plumbing.example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^deploy$/i })).not.toBeInTheDocument();
  });

  it("shows LIVE per-page progress while generating: done, writing-now, and waiting states", async () => {
    const run = {
      ...runFixture("review"),
      status: "generating",
      pages: {
        "js/components.js": { status: "ok", kind: "component", name: "Shared components", html: "// rewritten" },
        "index.html": { status: "generating", kind: "existing" },
        "about.html": { status: "pending", kind: "existing" },
      },
    };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ run }) } as Response)));
    render(<BuilderRun runId="run-1" />);

    expect(await screen.findByText(/Generating — 1 of 3 done/)).toBeInTheDocument();
    expect(screen.getByText(/Writing now: index.html/)).toBeInTheDocument();
    expect(screen.getByText(/^OK$/)).toBeInTheDocument();
    expect(screen.getByText(/^Writing…$/)).toBeInTheDocument();
    expect(screen.getByText(/^Waiting$/)).toBeInTheDocument();
    expect(screen.getByText(/shared components/)).toBeInTheDocument();
  });

  it("offers Open preview and Download zip once pages exist", async () => {
    stubFetch(runFixture("approved"));
    render(<BuilderRun runId="run-1" />);
    const preview = await screen.findByRole("link", { name: /open preview/i });
    expect(preview).toHaveAttribute("href", "/api/site-builder/runs/run-1/preview/");
    expect(preview).toHaveAttribute("target", "_blank");
    const download = screen.getByRole("link", { name: /download zip/i });
    expect(download).toHaveAttribute("href", "/api/site-builder/runs/run-1/download");
  });
});
