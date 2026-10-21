import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TaskBanner, taskHeadline } from "@/components/assistant/TaskBanner";
import { TurnView } from "@/components/assistant/TurnView";
import { liveTurn, turnsFromMessages } from "@/lib/assistant/turns";
import type { TaskView } from "@/lib/assistant/tasks";
import type { UiMessage } from "@/lib/assistant/view";

/** The chat shows a background task as it goes: a banner with Stop, and each run as a divider. */

const view = (over: Partial<TaskView> = {}): TaskView => ({
  id: "T1",
  goal: "Categorise every lead",
  progress: "412 of 822 categorised; next: August leads",
  status: "running",
  runs: 5,
  max_runs: 40,
  changes: 412,
  next_run_at: new Date().toISOString(),
  last_run_at: new Date().toISOString(),
  last_error: null,
  finished_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  working: true,
  ...over,
});

describe("TaskBanner", () => {
  it("running: how far it got, that it carries on without the page, and Stop task", async () => {
    const onStop = vi.fn(async () => ({ ok: true }));
    render(<TaskBanner task={view()} onStop={onStop} />);
    const banner = screen.getByTestId("task-banner");
    expect(banner.textContent).toMatch(/Working in the background/);
    expect(banner.textContent).toMatch(/run 5 of up to 40 · 412 changes/);
    expect(banner.textContent).toMatch(/412 of 822 categorised/);
    expect(banner.textContent).toMatch(/you can close this page/);
    fireEvent.click(screen.getByRole("button", { name: /Stop task/ }));
    await waitFor(() => expect(onStop).toHaveBeenCalled());
  });

  it("finished, waiting for the person, stopped — each says so and can be dismissed", () => {
    expect(taskHeadline(view({ status: "done" }))).toBe("Background task finished");
    expect(taskHeadline(view({ status: "blocked" }))).toBe("The background task needs you");
    expect(taskHeadline(view({ status: "running", working: false }))).toBe("Carrying on in the background");
    render(<TaskBanner task={view({ status: "stopped", last_error: "Made no changes in its last 2 runs", finished_at: new Date().toISOString() })} onStop={vi.fn()} />);
    expect(screen.getByTestId("task-banner").textContent).toMatch(/Made no changes in its last 2 runs/);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("task-banner")).toBeNull();
  });

  it("a stop that fails says why", async () => {
    render(<TaskBanner task={view()} onStop={vi.fn(async () => ({ ok: false, error: "Could not reach the server." }))} />);
    fireEvent.click(screen.getByRole("button", { name: /Stop task/ }));
    expect(await screen.findByText("Could not reach the server.")).toBeTruthy();
  });
});

describe("a background run in the thread", () => {
  it("shows as a divider, not as words the person typed — and offers no edit or regenerate", () => {
    const rows = [
      { id: "q1", turn_id: "q1", role: "user", content: "[Background task — run 3] Carry on with the task: …", meta: { task: { id: "T1", run: 3 } }, created_at: new Date().toISOString() },
      { id: "a1", turn_id: "q1", role: "assistant", content: "This run categorised 40 more.", meta: null, created_at: new Date().toISOString() },
    ] as unknown as UiMessage[];
    const [turn] = turnsFromMessages(rows);
    expect(turn.task).toEqual({ id: "T1", run: 3 });
    render(<TurnView turn={turn} assistantName="SED AI" latest onEdit={vi.fn()} onRegenerate={vi.fn()} />);
    expect(screen.getByTestId("background-run").textContent).toMatch(/Background task · run 3/);
    expect(screen.queryByText(/Carry on with the task/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit question" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Regenerate" })).toBeNull();
    expect(screen.getByText("This run categorised 40 more.")).toBeTruthy();
  });

  it("a question the person typed still shows as their bubble", () => {
    render(<TurnView turn={{ ...liveTurn("q", "How far is it?"), status: "done" }} assistantName="SED AI" />);
    expect(screen.getByText("How far is it?")).toBeTruthy();
    expect(screen.queryByTestId("background-run")).toBeNull();
  });
});
