import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BuilderRun } from "@/components/site-builder/BuilderRun";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/** Mount smoke tests, same idiom as tests/siteStudioBoard.test.tsx. */

type RunStatus = "queued" | "generating" | "review" | "approved" | "deployed" | "failed";

function runFixture(status: RunStatus) {
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
    expect(screen.getByLabelText(/regenerate .index\.html./i)).toBeInTheDocument();
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

  it("shows the AI-returned code for a page when View code is clicked", async () => {
    stubFetch(runFixture("review"));
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<BuilderRun runId="run-1" />);

    const viewButtons = await screen.findAllByRole("button", { name: /view code/i });
    expect(viewButtons.length).toBeGreaterThan(0);
    await user.click(viewButtons[0]);

    const dialog = await screen.findByRole("dialog", { name: /generated code for index\.html/i });
    expect(dialog).toBeInTheDocument();
    // the modal shows the exact stored html for that page
    expect(dialog.textContent).toContain("<!doctype html><html><body>Home</body></html>");
    // and a raw link to the source
    const raw = screen.getByRole("link", { name: /^raw$/i });
    expect(raw).toHaveAttribute("href", expect.stringContaining("/preview/index.html?raw=1"));
  });
});

/**
 * The operator's two ways out of a run that went wrong. Both are about the
 * screen no longer being a dead end: a failed run is retryable (the generate
 * route accepts it and resumes the pages that already finished), and a run
 * wedged in "generating" can be released without waiting the server out.
 */
describe("BuilderRun — getting a broken run moving again", () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000).toISOString();

  /** A fetch stub that records the calls, so a click can be checked against
   *  the ENDPOINT it hit rather than just "something was fetched". */
  function recordingFetch(run: unknown) {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ run }),
    } as Response));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const posted = (fetchMock: ReturnType<typeof recordingFetch>, url: string) =>
    fetchMock.mock.calls.some(([u, init]) => u === url && init?.method === "POST");

  const failedRun = () => ({
    ...runFixture("failed"),
    error: "Every page failed to generate.",
  });

  it("offers Retry failed pages on a failed run, and the click re-runs generation", async () => {
    const fetchMock = recordingFetch(failedRun());
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<BuilderRun runId="run-1" />);

    const btn = await screen.findByRole("button", { name: /retry failed pages/i });
    // The mount fetch is a GET; nothing has been retried yet.
    expect(posted(fetchMock, "/api/site-builder/runs/run-1/generate")).toBe(false);

    await user.click(btn);

    await waitFor(() => expect(posted(fetchMock, "/api/site-builder/runs/run-1/generate")).toBe(true));
  });

  it("keeps polling while the retry POST is still outstanding", async () => {
    /**
     * The generate route does not answer until the WHOLE generation has
     * finished — minutes, sometimes far more. Meanwhile the run went
     * "generating" server-side a moment after the click, so without a poll the
     * screen would sit on the failed panel showing a spinner and nothing else
     * for the entire run. Modelled here by a POST that never resolves.
     */
    let gets = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") await new Promise<void>(() => {});
      gets += 1;
      return { ok: true, json: async () => ({ run: failedRun() }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<BuilderRun runId="run-1" />);

    await user.click(await screen.findByRole("button", { name: /retry failed pages/i }));
    const afterClick = gets;

    // The poll runs on a 2s interval, so one further refresh proves it started.
    await waitFor(() => expect(gets).toBeGreaterThan(afterClick), { timeout: 6000 });
  }, 10000);

  it("tells the operator the finished pages are kept, instead of calling the run a write-off", async () => {
    recordingFetch(failedRun());
    render(<BuilderRun runId="run-1" />);

    // The panel is up (so the assertions below are about its COPY, not about a
    // panel that failed to render).
    expect(await screen.findByText(/this run failed/i)).toBeInTheDocument();
    expect(screen.getByText(/already generated are kept/i)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be resumed/i)).not.toBeInTheDocument();
  });

  it("leaves the per-page Retry ENABLED on a failed run — the route accepts it", async () => {
    recordingFetch(failedRun());
    render(<BuilderRun runId="run-1" />);

    // The per-page control inside the failed page's card, not the panel-level
    // "Retry failed pages" — hence the anchored name.
    const perPage = await screen.findByRole("button", { name: /^retry$/i });
    expect(perPage).toBeEnabled();
  });

  it("disables EVERY regenerate control while one page is being rewritten", async () => {
    /**
     * Two failed pages on a "review" run is the ORDINARY partial failure —
     * runSite calls a run ok when any real page succeeded — and per-page Retry
     * is the only tool there. Each regeneration rewrites the run's whole page
     * set from the snapshot it read minutes ago, so letting the operator start
     * a second one invites an AI call the server will (correctly) refuse.
     */
    const run = {
      ...runFixture("review"),
      pages: {
        "index.html": { status: "ok", kind: "existing", html: "<html>a</html>" },
        "about.html": { status: "failed", kind: "existing", error: "boom" },
        "contact.html": { status: "failed", kind: "existing", error: "boom" },
      },
    };
    // The regenerate POST never resolves — one rewrite in flight, as in life.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") await new Promise<void>(() => {});
        return { ok: true, json: async () => ({ run }) } as Response;
      }),
    );
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<BuilderRun runId="run-1" />);

    const retries = await screen.findAllByRole("button", { name: /^retry$/i });
    expect(retries).toHaveLength(2);
    // Both start enabled, so the disabling below is caused by the click.
    expect(retries[0]).toBeEnabled();
    expect(retries[1]).toBeEnabled();
    const panel = screen.getByRole("button", { name: /regenerate this page/i });
    expect(panel).toBeEnabled();

    await user.click(retries[0]);

    // The OTHER page's Retry, and the instruction panel's button, are what
    // used to stay clickable — `busy` was keyed on the file, not on "any".
    await waitFor(() => expect(retries[1]).toBeDisabled());
    expect(retries[0]).toBeDisabled();
    expect(panel).toBeDisabled();
    expect(retries[1]).toHaveAttribute("title", expect.stringMatching(/one page.*at a time/i));
  });

  it("offers Stop and recover once a generating run has been quiet for six minutes", async () => {
    const run = { ...runFixture("generating"), updated_at: minutesAgo(6) };
    const fetchMock = recordingFetch(run);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<BuilderRun runId="run-1" />);

    const btn = await screen.findByRole("button", { name: /stop and recover/i });
    await user.click(btn);

    await waitFor(() => expect(posted(fetchMock, "/api/site-builder/runs/run-1/recover")).toBe(true));
  });

  it("does not claim the previous attempt is stopped — it is only disowned", async () => {
    /**
     * /recover clears the claim token; NOTHING aborts the attempt. It keeps
     * running under the generate route's maxDuration of an hour, keeps making
     * paced AI calls, and keeps spending the same provider's rate budget — so
     * it costs money after the click and can make the operator's own retry
     * slower. Copy that says "stopped" is a promise the system cannot keep.
     */
    const run = { ...runFixture("generating"), updated_at: minutesAgo(6) };
    recordingFetch(run);
    const confirmMock = vi.fn((_message?: string) => true);
    vi.stubGlobal("confirm", confirmMock);
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<BuilderRun runId="run-1" />);

    const btn = await screen.findByRole("button", { name: /stop and recover/i });

    // The panel copy, right above the button.
    const panel = screen.getByText(/Nothing has been written for a few minutes/);
    expect(panel.textContent).toMatch(/does not actually stop/i);
    expect(panel.textContent).toMatch(/keep costing|keep working/i);

    await user.click(btn);

    const asked = String(confirmMock.mock.calls[0]?.[0] ?? "");
    expect(asked).toMatch(/does not actually stop/i);
    expect(asked).toMatch(/costing/i);
    // …and it still says what IS true: saved pages survive.
    expect(asked).toMatch(/already saved are kept/i);
  });

  it("does NOT offer Stop and recover on a generating run that wrote a minute ago", async () => {
    const run = { ...runFixture("generating"), updated_at: minutesAgo(1) };
    recordingFetch(run);
    render(<BuilderRun runId="run-1" />);

    // Wait for the in-flight panel, so the absence below is a real absence and
    // not just "the screen had not loaded yet".
    expect(await screen.findByText(/Generating — /)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop and recover/i })).not.toBeInTheDocument();
  });
});

/**
 * The live stream readout: while a run generates, the screen polls
 * `GET /runs/[id]/live` (the in-memory registry's snapshot) and shows, per
 * generating page, how many chars have streamed and how long the stream has
 * been quiet — plus an expandable raw tail. This is what tells "writing a
 * long page" apart from "wedged".
 */
describe("BuilderRun — watching the live stream", () => {
  /** A server clock the fixtures hang off — idle seconds are computed from the
   *  RESPONSE's `now` minus `lastChunkAt`, never from the client's clock, so
   *  the tests pin both and assert the exact figure. */
  const SERVER_NOW = 1_753_800_000_000;

  const generatingRun = () => ({
    ...runFixture("generating"),
    pages: {
      "index.html": { status: "generating", kind: "existing" },
      "about.html": { status: "pending", kind: "existing" },
    },
  });

  /** Routes the two endpoints the screen polls: the run row and the live
   *  snapshot. Returns the mock plus a live-call counter for the stop test. */
  function routedFetch(opts: {
    run: () => unknown;
    live: () => { now: number; files: unknown[] };
  }) {
    let liveCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/live")) {
        liveCalls += 1;
        return { ok: true, json: async () => opts.live() } as Response;
      }
      return { ok: true, json: async () => ({ run: opts.run() }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    return { fetchMock, getLiveCalls: () => liveCalls };
  }

  it("shows chars streamed and quiet seconds for the generating page, from the live snapshot", async () => {
    routedFetch({
      run: generatingRun,
      live: () => ({
        now: SERVER_NOW,
        files: [{ file: "index.html", chars: 12345, lastChunkAt: SERVER_NOW - 5000, tail: "<h1>stream</h1>" }],
      }),
    });
    render(<BuilderRun runId="run-1" />);

    // 12,345 chars in, last chunk 5s before the snapshot — the exact figure is
    // the discrimination: an implementation that used lastChunkAt directly as
    // seconds would show an epoch-sized number here, not 5.
    expect(await screen.findByText(/~12,345 chars/)).toBeInTheDocument();
    const quiet = screen.getByText(/quiet for 5s/);
    expect(quiet).toBeInTheDocument();
    // A 5s pause is normal thinking time, not an alarm.
    expect(quiet).not.toHaveAttribute("title");
    // The pending page has no live entry and gains nothing new.
    expect(screen.getAllByRole("button", { name: /^watch$/i })).toHaveLength(1);
  });

  it("styles the quiet figure as alarming once the stream has been silent for over a minute", async () => {
    routedFetch({
      run: generatingRun,
      live: () => ({
        now: SERVER_NOW,
        files: [{ file: "index.html", chars: 900, lastChunkAt: SERVER_NOW - 90_000, tail: "…" }],
      }),
    });
    render(<BuilderRun runId="run-1" />);

    const quiet = await screen.findByText(/quiet for 90s/);
    expect(quiet).toHaveAttribute("title", expect.stringMatching(/stalled/i));
    expect(quiet.className).toContain("text-dropped-fg");
  });

  it("expands the raw tail when Watch is clicked, and collapses it again", async () => {
    const TAIL = "<section>the raw model output, mid-page</section>";
    routedFetch({
      run: generatingRun,
      live: () => ({
        now: SERVER_NOW,
        files: [{ file: "index.html", chars: 48, lastChunkAt: SERVER_NOW - 1000, tail: TAIL }],
      }),
    });
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<BuilderRun runId="run-1" />);

    const watch = await screen.findByRole("button", { name: /^watch$/i });
    // Collapsed by default — the tail is opt-in, not another wall of text.
    expect(screen.queryByTestId("sb-live-tail")).not.toBeInTheDocument();

    await user.click(watch);
    const tail = await screen.findByTestId("sb-live-tail");
    expect(tail.textContent).toBe(TAIL);

    await user.click(screen.getByRole("button", { name: /^hide$/i }));
    expect(screen.queryByTestId("sb-live-tail")).not.toBeInTheDocument();
  });

  it("stops polling the live endpoint once the run reaches review", async () => {
    let status: "generating" | "review" = "generating";
    const { getLiveCalls } = routedFetch({
      run: () => ({ ...runFixture(status) }),
      live: () => ({ now: SERVER_NOW, files: [] }),
    });
    render(<BuilderRun runId="run-1" />);

    // The live poll is running (it fires immediately on entering "generating").
    await waitFor(() => expect(getLiveCalls()).toBeGreaterThan(0));

    // The run finishes server-side; the 2s run poll picks the new status up.
    status = "review";
    await waitFor(() => expect(screen.getByText("Awaiting review")).toBeInTheDocument(), { timeout: 6000 });

    // No further live fetches after the status change settles.
    const after = getLiveCalls();
    await new Promise((r) => setTimeout(r, 2600));
    expect(getLiveCalls()).toBe(after);
  }, 15000);
});
