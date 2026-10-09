import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useStickToBottom } from "@/components/assistant/useStickToBottom";

/**
 * Following a chat as it grows: stick to the newest words, stop when the
 * user opens something to read, and only offer "jump to latest" when there
 * is actually something below. Layout is faked: jsdom has none.
 */

let resized: (() => void) | null = null;

function Thread() {
  const { scrollRef, contentRef, onScroll, onClickCapture, atBottom } = useStickToBottom();
  return (
    <div>
      <div ref={scrollRef} onScroll={onScroll} onClickCapture={onClickCapture} data-testid="scroller">
        <div ref={contentRef}>
          <button type="button" aria-expanded={false}>
            Worked for 12s
          </button>
        </div>
      </div>
      {atBottom ? null : <button type="button">Latest message</button>}
    </div>
  );
}

function setGeometry(el: HTMLElement, g: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: g.scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: g.clientHeight });
  if (g.scrollTop !== undefined) el.scrollTop = g.scrollTop;
}

beforeEach(() => {
  resized = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resized = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("following a growing chat", () => {
  it("keeps to the bottom while it grows", () => {
    render(<Thread />);
    const el = screen.getByTestId("scroller");
    setGeometry(el, { scrollHeight: 2000, clientHeight: 500, scrollTop: 0 });
    act(() => resized?.());
    expect(el.scrollTop).toBe(2000);
    expect(screen.queryByRole("button", { name: "Latest message" })).not.toBeInTheDocument();
  });

  it("stops following when something is opened, and offers the jump only if there is more below", async () => {
    render(<Thread />);
    const el = screen.getByTestId("scroller");

    // Everything fits: opening the details changes nothing to jump to.
    setGeometry(el, { scrollHeight: 400, clientHeight: 500, scrollTop: 0 });
    await userEvent.click(screen.getByRole("button", { name: "Worked for 12s" }));
    act(() => resized?.());
    expect(screen.queryByRole("button", { name: "Latest message" })).not.toBeInTheDocument();

    // Long chat, reader at the bottom: opening the details pushes the end down —
    // the view stays put and the jump appears.
    setGeometry(el, { scrollHeight: 1500, clientHeight: 500, scrollTop: 1000 });
    await userEvent.click(screen.getByRole("button", { name: "Worked for 12s" }));
    setGeometry(el, { scrollHeight: 1700, clientHeight: 500 });
    act(() => resized?.());
    expect(el.scrollTop).toBe(1000);
    expect(screen.getByRole("button", { name: "Latest message" })).toBeInTheDocument();
  });
});
