import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TemplatesBoard } from "@/components/site-builder/TemplatesBoard";

/**
 * Mount smoke tests, same idiom as tests/siteStudioBoard.test.tsx: render the
 * real component against a stubbed fetch, no network.
 */

function stubFetch(handler: (url: string) => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return { ok: true, json: async () => handler(url) } as Response;
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TemplatesBoard", () => {
  it("renders the empty state when there are no templates", async () => {
    stubFetch(() => ({ templates: [] }));
    render(<TemplatesBoard />);
    expect(await screen.findByText(/no templates yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/template name/i)).toBeInTheDocument();
  });

  it("renders a card with the template's name and page count", async () => {
    stubFetch(() => ({
      templates: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          name: "Plumber Pro",
          storage_path: "11111111-1111-1111-1111-111111111111/source.zip",
          page_files: ["index.html", "about.html"],
          asset_files: ["style.css"],
          created_by: null,
          created_at: "2026-07-25T00:00:00.000Z",
        },
      ],
    }));
    render(<TemplatesBoard />);
    const heading = await screen.findByText("Plumber Pro");
    const card = heading.closest("div.rounded-lg");
    expect(card).toBeTruthy();
    expect(card!.textContent).toMatch(/2 pages/i);
    expect(card!.textContent).toMatch(/1 asset/i);
  });

  it("asks for confirmation before deleting, and does not delete on cancel", async () => {
    stubFetch(() => ({
      templates: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          name: "Roofer Rex",
          storage_path: "x/source.zip",
          page_files: ["index.html"],
          asset_files: [],
          created_by: null,
          created_at: "2026-07-25T00:00:00.000Z",
        },
      ],
    }));
    render(<TemplatesBoard />);
    await screen.findByText("Roofer Rex");
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: /delete roofer rex/i }));
    expect(await screen.findByText(/delete "roofer rex"\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByText(/delete "roofer rex"\?/i)).not.toBeInTheDocument());
    // still shown — nothing was removed by cancelling
    expect(screen.getByText("Roofer Rex")).toBeInTheDocument();
  });
});
