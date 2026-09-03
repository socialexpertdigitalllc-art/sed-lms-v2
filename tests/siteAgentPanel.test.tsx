import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import { AgentRunPanel } from "@/components/tickets/AgentRunPanel";
import { ToastProvider } from "@/components/common/Toast";

/**
 * The ticket screen's "AI developer" panel (Ticket Agent): Send to AI, live
 * progress, diff review, sandboxed preview, and the approve / revise /
 * discard gates. The API surface is built and tested elsewhere — these tests
 * pin the PANEL's behavior against a route-map fetch stub, in the style of
 * tests/siteBuilderRunScreen.test.tsx.
 */

type Status = "queued" | "running" | "review" | "deploying" | "deployed" | "failed" | "discarded";

const HOST = "greenlawn.dmviral.com";
const LIST_URL = "/api/tickets/tk-1/agent-runs";
const detailUrl = (id: string) => `/api/site-agent/runs/${id}`;

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    ticket_id: "tk-1",
    lead_id: "lead-1",
    site_host: HOST,
    status: "review" as Status,
    files: { "index.html": { action: "edit", bytes: 2048 } },
    output_tail: null,
    summary: "Updated the phone number in the header and footer.",
    error: null,
    created_by: "dev-1",
    created_at: "2026-08-30T10:00:00.000Z",
    updated_at: "2026-08-30T10:00:00.000Z",
    ...overrides,
  };
}

/** The ticket's items as TicketDetail passes them — two undone, one done. */
const ITEMS = [
  { id: "it-1", body: "Replace the phone number", is_done: false },
  { id: "it-2", body: "Fix the footer link", is_done: false },
  { id: "it-3", body: "Swap the old logo", is_done: true },
];
const TITLE = "Fix the phone number";
/** The worker-published catalogue as the list/poll payloads carry it. */
const MODELS = [
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
];

type Reply = { status?: number; body: unknown };
const method = (init?: RequestInit) => init?.method ?? "GET";

/** Route-map fetch stub: `route` inspects url+method and returns a reply; an
 *  unmatched request rejects loudly so a test never silently 200s. */
function stubFetchRoutes(route: (url: string, init?: RequestInit) => Reply | null) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const r = route(String(url), init);
    if (!r) throw new Error(`Unhandled fetch: ${method(init)} ${String(url)}`);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type FetchMock = ReturnType<typeof stubFetchRoutes>;
const countCalls = (fetchMock: FetchMock, pattern: RegExp, m = "GET") =>
  fetchMock.mock.calls.filter(
    ([u, init]) => pattern.test(String(u)) && method(init as RequestInit | undefined) === m,
  ).length;
/** The parsed JSON body of the first POST matching `pattern` (`{}` when the
 *  POST carried no body at all). */
const postBody = (fetchMock: FetchMock, pattern: RegExp): Record<string, unknown> => {
  const call = fetchMock.mock.calls.find(
    ([u, i]) => pattern.test(String(u)) && method(i as RequestInit | undefined) === "POST",
  );
  const raw = (call?.[1] as RequestInit | undefined)?.body;
  return raw ? (JSON.parse(String(raw)) as Record<string, unknown>) : {};
};

function mount(props: Partial<Parameters<typeof AgentRunPanel>[0]> = {}) {
  return render(
    <ToastProvider>
      <AgentRunPanel
        ticketId="tk-1"
        ticketTitle={TITLE}
        items={ITEMS}
        websiteLink={`https://${HOST}`}
        canViewAgentRuns={true}
        canResolve={true}
        ticketStatus="In Progress"
        {...props}
      />
    </ToastProvider>,
  );
}

/** Lead-mode mount: no ticket, no items, no status — the "AI edit site" entry. */
function mountLead(props: Partial<Parameters<typeof AgentRunPanel>[0]> = {}) {
  return render(
    <ToastProvider>
      <AgentRunPanel
        leadId="lead-1"
        websiteLink={`https://${HOST}`}
        canViewAgentRuns={true}
        canResolve={true}
        {...props}
      />
    </ToastProvider>,
  );
}

/** Open the pre-send dialog from the panel's Send button and return its root. */
async function openDialog() {
  fireEvent.click(await screen.findByTestId("sa-send"));
  return screen.getByRole("dialog");
}

/** Drain pending fetch/json microtask chains inside act — for the fake-timer
 *  tests, where waitFor/findBy would stall on the mocked clock. */
async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

afterEach(() => {
  cleanup(); // unmount while any fake timers are still installed…
  vi.useRealTimers(); // …so the poll intervals are cleared on the clock that made them
  vi.unstubAllGlobals();
});

describe("AgentRunPanel", () => {
  it("renders nothing at all when the lead has no website link", () => {
    const fetchMock = stubFetchRoutes(() => ({ body: {} }));
    const { container } = render(
      <AgentRunPanel
        ticketId="tk-1"
        websiteLink={null}
        canViewAgentRuns={true}
        canResolve={true}
        ticketStatus="Assigned"
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders nothing and never fetches for a viewer without run access (sales/management)", () => {
    // GET /agent-runs 403s anyone without tickets.resolve/studio.manage — a
    // viewer-only mount must not fire it just to collect an error toast.
    const fetchMock = stubFetchRoutes(() => ({ body: {} }));
    const { container } = render(
      <AgentRunPanel
        ticketId="tk-1"
        websiteLink={`https://${HOST}`}
        canViewAgentRuns={false}
        canResolve={false}
        ticketStatus="In Progress"
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers Send to AI on an Assigned ticket, and the click creates a run and starts polling it", async () => {
    vi.useFakeTimers();
    const queued = runRow({ status: "queued" });
    const fetchMock = stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [] } };
      if (url === LIST_URL && method(init) === "POST") return { status: 201, body: { run: queued } };
      if (url === detailUrl("run-1")) return { body: { run: queued, workerOnline: true } };
      return null;
    });
    mount({ ticketStatus: "Assigned" });
    await flush();

    expect(screen.getByText(/you review every change before it goes live/i)).toBeInTheDocument();
    // v2: Send opens the pre-send dialog; the dialog's Send fires the POST.
    fireEvent.click(screen.getByTestId("sa-send"));
    fireEvent.click(screen.getByTestId("sa-dialog-send"));
    await flush();

    expect(countCalls(fetchMock, /\/api\/tickets\/tk-1\/agent-runs$/, "POST")).toBe(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The new run is focused and polled on the 2s cadence.
    const before = countCalls(fetchMock, /\/api\/site-agent\/runs\/run-1$/);
    expect(before).toBeGreaterThan(0);
    await advance(2000);
    await flush();
    expect(countCalls(fetchMock, /\/api\/site-agent\/runs\/run-1$/)).toBeGreaterThan(before);
  });

  it("hides Send when the ticket status or the permission disqualifies it, but still shows the runs", async () => {
    const deployed = runRow({ id: "run-2", status: "deployed", created_at: "2026-08-31T09:00:00.000Z" });
    const discarded = runRow({ id: "run-1", status: "discarded" });
    const routes = (url: string, init?: RequestInit): Reply | null => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [deployed, discarded] } };
      return null;
    };

    stubFetchRoutes(routes);
    mount({ ticketStatus: "Open" });
    expect(await screen.findByRole("link", { name: HOST })).toBeInTheDocument();
    expect(screen.getByText(/past runs \(1\)/i)).toBeInTheDocument();
    expect(screen.queryByTestId("sa-send")).not.toBeInTheDocument();

    cleanup();

    stubFetchRoutes(routes);
    mount({ canResolve: false });
    expect(await screen.findByRole("link", { name: HOST })).toBeInTheDocument();
    expect(screen.queryByTestId("sa-send")).not.toBeInTheDocument();
  });

  it("shows the worker-offline note while queued when the heartbeat is stale", async () => {
    const queued = runRow({ status: "queued" });
    stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [queued] } };
      if (url === detailUrl("run-1")) return { body: { run: queued, workerOnline: false } };
      return null;
    });
    mount();

    expect(await screen.findByTestId("sa-offline")).toHaveTextContent(/agent worker is offline/i);
    expect(screen.getByText(/waiting for the agent worker/i)).toBeInTheDocument();
    expect(screen.getByTestId("sa-discard")).toBeInTheDocument(); // Stop stays available
  });

  it("shows the live output tail while running and re-polls on the 2s cadence", async () => {
    vi.useFakeTimers();
    const running = runRow({
      status: "running",
      output_tail: "▮ editing index.html — swapping the phone number",
      files: {},
    });
    // The list SELECT carries no output_tail — only the detail poll does.
    const listRow = { ...running, output_tail: undefined };
    const fetchMock = stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [listRow] } };
      if (url === detailUrl("run-1")) return { body: { run: running, workerOnline: true } };
      return null;
    });
    mount();
    await flush();

    expect(screen.getByTestId("sa-tail")).toHaveTextContent("swapping the phone number");
    const before = countCalls(fetchMock, /\/api\/site-agent\/runs\/run-1$/);
    expect(before).toBeGreaterThan(0);
    await advance(2000);
    await flush();
    expect(countCalls(fetchMock, /\/api\/site-agent\/runs\/run-1$/)).toBeGreaterThan(before);
  });

  it("review: lists the changed files with action badges, and a click renders the line diff", async () => {
    const review = runRow({
      files: {
        "index.html": { action: "edit", bytes: 2048 },
        "css/site.css": { action: "create", bytes: 512 },
      },
    });
    stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [review] } };
      if (url === detailUrl("run-1")) return { body: { run: review, workerOnline: true } };
      if (url === "/api/site-agent/runs/run-1/files/index.html")
        return {
          body: {
            path: "index.html",
            binary: false,
            before: "line one\nline two\nline three",
            after: "line one\nline CHANGED\nline three",
          },
        };
      return null;
    });
    mount();

    const files = await screen.findByTestId("sa-files");
    expect(within(files).getByText("index.html")).toBeInTheDocument();
    expect(within(files).getByText("css/site.css")).toBeInTheDocument();
    expect(within(files).getByText("edit")).toBeInTheDocument();
    expect(within(files).getByText("create")).toBeInTheDocument();
    expect(within(files).getByText("2.0 KB")).toBeInTheDocument();

    fireEvent.click(within(files).getByRole("button", { name: /index\.html/ }));

    const dels = await screen.findAllByTestId("sa-diff-del");
    expect(dels.some((r) => r.textContent?.includes("line two"))).toBe(true);
    const adds = screen.getAllByTestId("sa-diff-add");
    expect(adds.some((r) => r.textContent?.includes("line CHANGED"))).toBe(true);
    expect(screen.getAllByTestId("sa-diff-same").length).toBeGreaterThan(0);
  });

  it("review: sandboxes the preview iframe and swaps its src from the page select", async () => {
    const review = runRow({
      files: {
        "index.html": { action: "edit", bytes: 2048 },
        "about.html": { action: "edit", bytes: 1024 },
        "css/site.css": { action: "create", bytes: 512 },
      },
    });
    stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [review] } };
      if (url === detailUrl("run-1")) return { body: { run: review, workerOnline: true } };
      return null;
    });
    mount();

    const frame = await screen.findByTestId("sa-preview-frame");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame).toHaveAttribute("src", "/api/site-agent/runs/run-1/preview/");

    const select = screen.getByRole("combobox");
    expect(within(select).getByRole("option", { name: "about.html" })).toBeInTheDocument();
    // Assets are not pages — never offered in the page list.
    expect(within(select).queryByRole("option", { name: "css/site.css" })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "about.html" } });
    expect(frame).toHaveAttribute("src", "/api/site-agent/runs/run-1/preview/about.html");
  });

  it("review: Approve & Deploy confirms with the host, POSTs approve, and flips to the live link", async () => {
    let status: Status = "review";
    const fetchMock = stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [runRow({ status })] } };
      if (url === detailUrl("run-1") && method(init) === "GET")
        return { body: { run: runRow({ status }), workerOnline: true } };
      if (url === "/api/site-agent/runs/run-1/approve" && method(init) === "POST") {
        status = "deployed";
        return { body: { ok: true, url: `https://${HOST}` } };
      }
      return null;
    });
    const confirmMock = vi.fn<(message?: string) => boolean>(() => true);
    vi.stubGlobal("confirm", confirmMock);
    mount();

    fireEvent.click(await screen.findByTestId("sa-deploy"));

    expect(String(confirmMock.mock.calls[0]?.[0])).toContain(HOST);
    expect(String(confirmMock.mock.calls[0]?.[0])).toMatch(/snapshot/i);
    await waitFor(() => expect(countCalls(fetchMock, /\/approve$/, "POST")).toBe(1));

    const link = await screen.findByRole("link", { name: HOST });
    expect(link).toHaveAttribute("href", `https://${HOST}`);
    expect(screen.queryByTestId("sa-deploy")).not.toBeInTheDocument();
  });

  it("review: Request changes POSTs the instructions and returns the panel to the queue", async () => {
    let status: Status = "review";
    const fetchMock = stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [runRow({ status })] } };
      if (url === detailUrl("run-1") && method(init) === "GET")
        return { body: { run: runRow({ status }), workerOnline: true } };
      if (url === "/api/site-agent/runs/run-1/revise" && method(init) === "POST") {
        status = "queued";
        return { body: { ok: true } };
      }
      return null;
    });
    mount();

    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "Make the header banner blue" },
    });
    fireEvent.click(screen.getByTestId("sa-revise"));

    await waitFor(() => expect(countCalls(fetchMock, /\/revise$/, "POST")).toBe(1));
    const call = fetchMock.mock.calls.find(
      ([u, i]) => /\/revise$/.test(String(u)) && method(i as RequestInit | undefined) === "POST",
    );
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      instructions: "Make the header banner blue",
    });
    expect(await screen.findByText(/waiting for the agent worker/i)).toBeInTheDocument();
  });

  it("failed: shows the error verbatim, and Try again re-opens the dialog seeded from the failed run", async () => {
    // A retry IS a new run — and the commonest failure ("quota exhausted")
    // is exactly when the operator wants to switch model, so the retry goes
    // through the dialog, prefilled with the failed run's scope/task/model.
    const failed = runRow({
      status: "failed",
      error: "agy exited 1 — quota exhausted for today",
      files: {},
      item_ids: ["it-2"],
      task_text: "Only fix the footer link this time.",
      model: "gemini-3.7-flash",
    });
    const queued2 = runRow({ id: "run-2", status: "queued" });
    const fetchMock = stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [failed], models: MODELS } };
      if (url === LIST_URL && method(init) === "POST") return { status: 201, body: { run: queued2 } };
      if (url === detailUrl("run-1") && method(init) === "GET") return { body: { run: failed, workerOnline: true, models: MODELS } };
      if (url === detailUrl("run-2") && method(init) === "GET") return { body: { run: queued2, workerOnline: true } };
      return null;
    });
    mount();

    expect(await screen.findByText("agy exited 1 — quota exhausted for today")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("sa-retry"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByTestId("sa-item-it-1")).not.toBeChecked();
    expect(within(dialog).getByTestId("sa-item-it-2")).toBeChecked();
    expect(within(dialog).getByTestId("sa-task")).toHaveValue("Only fix the footer link this time.");
    expect(within(dialog).getByTestId("sa-model")).toHaveValue("gemini-3.7-flash");
    fireEvent.click(within(dialog).getByTestId("sa-dialog-send"));

    await waitFor(() => expect(countCalls(fetchMock, /\/api\/tickets\/tk-1\/agent-runs$/, "POST")).toBe(1));
    expect(postBody(fetchMock, /\/api\/tickets\/tk-1\/agent-runs$/)).toEqual({
      item_ids: ["it-2"],
      task_text: "Only fix the footer link this time.",
      model: "gemini-3.7-flash",
    });
    expect(await screen.findByText(/waiting for the agent worker/i)).toBeInTheDocument();
  });

  it("deployed: shows the live link, the rollback note, and a fresh Send — never a dead end", async () => {
    const deployed = runRow({ status: "deployed" });
    stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [deployed] } };
      return null;
    });
    mount();

    const link = await screen.findByRole("link", { name: HOST });
    expect(link).toHaveAttribute("href", `https://${HOST}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/roll back/i)).toBeInTheDocument();
    expect(screen.getByText(deployed.summary as string)).toBeInTheDocument();
    for (const id of ["sa-deploy", "sa-revise", "sa-discard", "sa-retry"]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    // Clients ask for changes again and again: a deployed run offers the
    // next one (a FRESH dialog, not a retry seeded from the old run).
    fireEvent.click(screen.getByTestId("sa-send"));
    expect(await screen.findByTestId("sa-dialog-send")).toBeInTheDocument();
  });

  it("review: surfaces a rolled-back deploy error, and only when there is one", async () => {
    // A failed approve rolls the run back to review with `error` set — the
    // panel must show it, not just the (long-gone) toast.
    const withError = runRow({ error: "override failed: extract" });
    stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [withError] } };
      if (url === detailUrl("run-1") && method(init) === "GET") return { body: { run: withError, workerOnline: true } };
      return null;
    });
    mount();

    const card = await screen.findByTestId("sa-review-error");
    expect(card).toHaveTextContent(/last deploy attempt failed/i);
    expect(card).toHaveTextContent("override failed: extract");

    cleanup();

    // No error → no card (a plain review run stays clean).
    const clean = runRow();
    stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [clean] } };
      if (url === detailUrl("run-1") && method(init) === "GET") return { body: { run: clean, workerOnline: true } };
      return null;
    });
    mount();
    await screen.findByTestId("sa-files");
    expect(screen.queryByTestId("sa-review-error")).not.toBeInTheDocument();
  });

  it("review: leaves deleted pages out of the preview select — previewing one only 404s", async () => {
    const review = runRow({
      files: {
        "index.html": { action: "edit", bytes: 2048 },
        "old.html": { action: "delete", bytes: 900 },
      },
    });
    stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [review] } };
      if (url === detailUrl("run-1") && method(init) === "GET") return { body: { run: review, workerOnline: true } };
      return null;
    });
    mount();

    await screen.findByTestId("sa-preview-frame");
    const select = screen.getByRole("combobox");
    expect(within(select).getByRole("option", { name: "index.html" })).toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "old.html" })).not.toBeInTheDocument();
    // The deleted file still shows in the CHANGE list — it is part of the review.
    expect(within(screen.getByTestId("sa-files")).getByText("old.html")).toBeInTheDocument();
  });

  it("deploying: offers Stop once the deploy has been wedged for over ten minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T10:11:00.000Z")); // updated_at + 11m
    const deploying = runRow({ status: "deploying" });
    stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [deploying] } };
      if (url === detailUrl("run-1") && method(init) === "GET") return { body: { run: deploying, workerOnline: true } };
      return null;
    });
    mount();
    await flush();

    expect(screen.getByText(new RegExp(`Deploying to ${HOST}`))).toBeInTheDocument();
    expect(screen.getByTestId("sa-discard")).toBeInTheDocument();
  });

  it("deploying: shows no Stop while the deploy is fresh — it must be left to finish", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T10:01:00.000Z")); // updated_at + 1m
    const deploying = runRow({ status: "deploying" });
    stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [deploying] } };
      if (url === detailUrl("run-1") && method(init) === "GET") return { body: { run: deploying, workerOnline: true } };
      return null;
    });
    mount();
    await flush();

    expect(screen.getByText(new RegExp(`Deploying to ${HOST}`))).toBeInTheDocument();
    expect(screen.queryByTestId("sa-discard")).not.toBeInTheDocument();
  });

  it("declining the discard confirm sends nothing", async () => {
    const fetchMock = stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [runRow()] } };
      if (url === detailUrl("run-1") && method(init) === "GET") return { body: { run: runRow(), workerOnline: true } };
      return null;
    });
    const confirmMock = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmMock);
    mount();

    fireEvent.click(await screen.findByTestId("sa-discard"));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(countCalls(fetchMock, /\/discard$/, "POST")).toBe(0);
  });
});

/**
 * v2 — the pre-send dialog (scope + prompt editing + model) and lead-mode
 * ticketless runs. The create routes normalize the body (Task 4); these pin
 * what the PANEL sends: item_ids only for a real subset, task_text only once
 * edited, model only when not the default.
 */
describe("AgentRunPanel — pre-send dialog (v2)", () => {
  const LEAD_LIST_URL = "/api/leads/lead-1/agent-runs";
  const TICKET_POST = /\/api\/tickets\/tk-1\/agent-runs$/;
  const LEAD_POST = /\/api\/leads\/lead-1\/agent-runs$/;
  const DEFAULT_TASK = `Title: ${TITLE}\nChecklist:\n1. Replace the phone number\n2. Fix the footer link`;

  /** Empty list + a create that answers with a queued run, models published. */
  function idleRoutes(overrides: { listExtra?: Record<string, unknown>; post?: Reply } = {}) {
    const queued = runRow({ status: "queued" });
    return (url: string, init?: RequestInit): Reply | null => {
      if ((url === LIST_URL || url === LEAD_LIST_URL) && method(init) === "GET")
        return { body: { runs: [], workerOnline: true, models: MODELS, ...overrides.listExtra } };
      if ((url === LIST_URL || url === LEAD_LIST_URL) && method(init) === "POST")
        return overrides.post ?? { status: 201, body: { run: queued } };
      if (url === detailUrl("run-1")) return { body: { run: queued, workerOnline: true, models: MODELS } };
      return null;
    };
  }

  it("Send opens the dialog without POSTing; Cancel closes it, still without a POST", async () => {
    const fetchMock = stubFetchRoutes(idleRoutes());
    mount();

    const dialog = await openDialog();
    expect(dialog).toHaveAccessibleName(/send to ai/i);
    expect(countCalls(fetchMock, TICKET_POST, "POST")).toBe(0);

    fireEvent.click(within(dialog).getByTestId("sa-dialog-cancel"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(countCalls(fetchMock, TICKET_POST, "POST")).toBe(0);
  });

  it("offers the UNDONE items checked; unchecking one scopes the run, keeping all sends no item_ids", async () => {
    let fetchMock = stubFetchRoutes(idleRoutes());
    mount();

    let dialog = await openDialog();
    expect(within(dialog).getByTestId("sa-item-it-1")).toBeChecked();
    expect(within(dialog).getByTestId("sa-item-it-2")).toBeChecked();
    // Done items are never offered.
    expect(within(dialog).queryByTestId("sa-item-it-3")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByTestId("sa-item-it-2"));
    expect(within(dialog).getByTestId("sa-item-it-2")).not.toBeChecked();
    fireEvent.click(within(dialog).getByTestId("sa-dialog-send"));

    await waitFor(() => expect(countCalls(fetchMock, TICKET_POST, "POST")).toBe(1));
    expect(postBody(fetchMock, TICKET_POST)).toEqual({ item_ids: ["it-1"] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    cleanup();
    vi.unstubAllGlobals();

    // All checked = whole ticket: no item_ids key at all (and nothing else
    // either — untouched task, default model).
    fetchMock = stubFetchRoutes(idleRoutes());
    mount();
    dialog = await openDialog();
    fireEvent.click(within(dialog).getByTestId("sa-dialog-send"));
    await waitFor(() => expect(countCalls(fetchMock, TICKET_POST, "POST")).toBe(1));
    expect(postBody(fetchMock, TICKET_POST)).toEqual({});
  });

  it("prefills the task from the SELECTED items until the operator edits it; edited text is sent as task_text", async () => {
    const fetchMock = stubFetchRoutes(idleRoutes());
    mount();

    const dialog = await openDialog();
    const task = within(dialog).getByTestId("sa-task");
    expect(task).toHaveValue(DEFAULT_TASK);

    // Selection changes re-compose the prefill…
    fireEvent.click(within(dialog).getByTestId("sa-item-it-1"));
    expect(task).toHaveValue(`Title: ${TITLE}\nChecklist:\n1. Fix the footer link`);

    // …until the operator types: from then on the text is theirs.
    fireEvent.change(task, { target: { value: "Just fix the footer link, nothing else." } });
    fireEvent.click(within(dialog).getByTestId("sa-item-it-1"));
    expect(within(dialog).getByTestId("sa-item-it-1")).toBeChecked();
    expect(task).toHaveValue("Just fix the footer link, nothing else.");

    fireEvent.click(within(dialog).getByTestId("sa-dialog-send"));
    await waitFor(() => expect(countCalls(fetchMock, TICKET_POST, "POST")).toBe(1));
    // Both items are selected again → whole ticket → no item_ids.
    expect(postBody(fetchMock, TICKET_POST)).toEqual({ task_text: "Just fix the footer link, nothing else." });
  });

  it("title-only ticket: hides the items section and prefills the placeholder checklist line", async () => {
    stubFetchRoutes(idleRoutes());
    mount({ items: [ITEMS[2]] }); // the one item is already done

    const dialog = await openDialog();
    expect(dialog.querySelector('[data-testid^="sa-item-"]')).toBeNull();
    expect(within(dialog).queryByText(/changes to include/i)).not.toBeInTheDocument();
    expect(within(dialog).getByTestId("sa-task")).toHaveValue(
      `Title: ${TITLE}\nChecklist:\n(no checklist items — the title is the whole request)`,
    );
    expect(within(dialog).getByTestId("sa-dialog-send")).toBeEnabled();
  });

  it("disables Send with a hint once every item is unchecked", async () => {
    const fetchMock = stubFetchRoutes(idleRoutes());
    mount();

    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByTestId("sa-item-it-1"));
    fireEvent.click(within(dialog).getByTestId("sa-item-it-2"));

    const send = within(dialog).getByTestId("sa-dialog-send");
    expect(send).toBeDisabled();
    expect(within(dialog).getByText(/select at least one change/i)).toBeInTheDocument();
    fireEvent.click(send);
    await act(async () => {});
    expect(countCalls(fetchMock, TICKET_POST, "POST")).toBe(0);
  });

  it("model: lists the published labels after the default; a choice is POSTed as model, the default is omitted", async () => {
    let fetchMock = stubFetchRoutes(idleRoutes());
    mount();

    let dialog = await openDialog();
    const select = within(dialog).getByTestId("sa-model");
    const names = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["Antigravity default", "Gemini 3.7 Flash", "Claude Sonnet 4.6"]);
    expect(within(dialog).queryByText(/model list appears once the worker publishes it/i)).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: "claude-sonnet-4-6" } });
    fireEvent.click(within(dialog).getByTestId("sa-dialog-send"));
    await waitFor(() => expect(countCalls(fetchMock, TICKET_POST, "POST")).toBe(1));
    expect(postBody(fetchMock, TICKET_POST)).toEqual({ model: "claude-sonnet-4-6" });

    cleanup();
    vi.unstubAllGlobals();

    // Nothing published yet → only the default, plus the note.
    fetchMock = stubFetchRoutes(idleRoutes({ listExtra: { models: [] } }));
    mount();
    dialog = await openDialog();
    expect(within(within(dialog).getByTestId("sa-model")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Antigravity default",
    ]);
    expect(within(dialog).getByText(/model list appears once the worker publishes it/i)).toBeInTheDocument();
  });

  it("lead mode: lists from the lead route, reads 'AI edit site', requires the task, POSTs task_text to the lead route", async () => {
    const fetchMock = stubFetchRoutes(idleRoutes());
    mountLead();

    const send = await screen.findByTestId("sa-send");
    expect(send).toHaveTextContent("AI edit site");
    expect(countCalls(fetchMock, LEAD_POST)).toBe(1);
    expect(countCalls(fetchMock, /\/api\/tickets\//)).toBe(0);

    fireEvent.click(send);
    const dialog = screen.getByRole("dialog");
    // No ticket → no items section, ever.
    expect(dialog.querySelector('[data-testid^="sa-item-"]')).toBeNull();
    expect(within(dialog).queryByText(/changes to include/i)).not.toBeInTheDocument();

    const task = within(dialog).getByTestId("sa-task");
    expect(task).toHaveValue("");
    expect(task).toHaveAttribute("placeholder", expect.stringMatching(/describe the change you want/i));
    expect(within(dialog).getByTestId("sa-dialog-send")).toBeDisabled();

    fireEvent.change(task, { target: { value: "Turn the hero banner green." } });
    expect(within(dialog).getByTestId("sa-dialog-send")).toBeEnabled();
    fireEvent.click(within(dialog).getByTestId("sa-dialog-send"));

    await waitFor(() => expect(countCalls(fetchMock, LEAD_POST, "POST")).toBe(1));
    expect(postBody(fetchMock, LEAD_POST)).toEqual({ task_text: "Turn the hero banner green." });
    expect(countCalls(fetchMock, /\/api\/tickets\//, "POST")).toBe(0);
    expect(await screen.findByText(/waiting for the agent worker/i)).toBeInTheDocument();
  });

  it("lead mode: gates only on canResolve + websiteLink (no ticket status), and the deployed note points at the board", async () => {
    const deployed = runRow({ status: "deployed", ticket_id: null });
    const routes = (url: string, init?: RequestInit): Reply | null => {
      if (url === LEAD_LIST_URL && method(init) === "GET") return { body: { runs: [deployed], models: MODELS } };
      return null;
    };
    stubFetchRoutes(routes);
    mountLead();

    expect(await screen.findByRole("link", { name: HOST })).toBeInTheDocument();
    expect(screen.getByText(/snapshots on the deployments board/i)).toBeInTheDocument();
    expect(screen.queryByText(/website updates/i)).not.toBeInTheDocument();
    // Deployed lead runs offer the next edit right away.
    expect(screen.getByTestId("sa-send")).toBeInTheDocument();

    cleanup();
    vi.unstubAllGlobals();

    stubFetchRoutes(routes);
    mountLead({ canResolve: false });
    expect(await screen.findByRole("link", { name: HOST })).toBeInTheDocument();
    expect(screen.queryByTestId("sa-send")).not.toBeInTheDocument();
  });

  it("shows the chosen model's label while running, and the scope while in review", async () => {
    const running = runRow({ status: "running", files: {}, output_tail: "▮ working", model: "claude-sonnet-4-6" });
    stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [running], models: MODELS } };
      if (url === detailUrl("run-1")) return { body: { run: running, workerOnline: true, models: MODELS } };
      return null;
    });
    mount();

    const meta = await screen.findByTestId("sa-run-meta");
    expect(meta).toHaveTextContent("Claude Sonnet 4.6");
    expect(meta).not.toHaveTextContent("claude-sonnet-4-6");
    expect(meta).not.toHaveTextContent(/scope/i); // whole-ticket run: no scope line

    cleanup();
    vi.unstubAllGlobals();

    // An id the worker no longer publishes falls back to the raw id.
    const review = runRow({ item_ids: ["it-1"], model: "gemini-9-preview" });
    stubFetchRoutes((url, init) => {
      if (url === LIST_URL && method(init) === "GET") return { body: { runs: [review], models: MODELS } };
      if (url === detailUrl("run-1")) return { body: { run: review, workerOnline: true, models: MODELS } };
      return null;
    });
    mount();
    const meta2 = await screen.findByTestId("sa-run-meta");
    expect(meta2).toHaveTextContent("Scope: 1 of 3 changes");
    expect(meta2).toHaveTextContent("gemini-9-preview");
  });

  it("a 422 from create toasts the server's text and keeps the dialog open", async () => {
    const fetchMock = stubFetchRoutes(
      idleRoutes({ post: { status: 422, body: { error: "Item it-2 is already done." } } }),
    );
    mount();

    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByTestId("sa-dialog-send"));

    await waitFor(() => expect(countCalls(fetchMock, TICKET_POST, "POST")).toBe(1));
    expect(await screen.findByRole("status")).toHaveTextContent("Item it-2 is already done.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByTestId("sa-dialog-send")).toBeEnabled();
  });
});
