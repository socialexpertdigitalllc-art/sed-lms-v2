import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AreaChip } from "@/components/leads/HeaderChips";

/**
 * The chip popover is PORTALLED to <body> (bug 2026-09-14: rendered
 * absolutely, it was clipped by the lead header's overflow-hidden band and
 * stacked under later .reveal sections).
 */

describe("AreaChip", () => {
  it("opens a body-portalled picker and selects a state", async () => {
    const onSelect = vi.fn();
    const { container } = render(<AreaChip value={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /area/i }));
    const texas = await screen.findByRole("button", { name: "Texas" });
    // Portal: the option list lives OUTSIDE the component's own tree.
    expect(container.contains(texas)).toBe(false);

    fireEvent.click(texas);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("Texas"));
  });

  it("shows the derived state muted when no override is set, with no clear button", () => {
    render(<AreaChip value={null} derived="California" onSelect={vi.fn()} />);
    expect(screen.getByText("California")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /clear area/i })).not.toBeInTheDocument();
  });

  it("an override shows a clear button that selects null", async () => {
    const onSelect = vi.fn();
    render(<AreaChip value="Texas" derived="California" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /clear area/i }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null));
  });

  it("search filters the state list", async () => {
    render(<AreaChip value={null} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /area/i }));
    const input = await screen.findByPlaceholderText(/search area/i);
    fireEvent.change(input, { target: { value: "dako" } });
    expect(screen.getByRole("button", { name: "North Dakota" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "South Dakota" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Texas" })).not.toBeInTheDocument();
  });

  it("renders nothing when read-only with no value at all", () => {
    const { container } = render(<AreaChip value={null} onSelect={vi.fn()} readOnly />);
    expect(container).toBeEmptyDOMElement();
  });
});
