import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ColorSchemeSwatches } from "@/components/leads/ColorSchemeSwatches";

/** A colour code means nothing at a glance; the dot beside it does. */
describe("ColorSchemeSwatches", () => {
  it("draws one circle per resolvable colour, keeping the text", () => {
    const { container } = render(<ColorSchemeSwatches value="#0C5AA0, #F24F24" />);
    const dots = container.querySelectorAll("span[title]");
    expect(dots).toHaveLength(2);
    expect((dots[0] as HTMLElement).style.backgroundColor).toBe("rgb(12, 90, 160)");
    expect((dots[1] as HTMLElement).style.backgroundColor).toBe("rgb(242, 79, 36)");
    expect(screen.getByText("#0C5AA0, #F24F24")).toBeInTheDocument();
  });

  it("understands colour names and skips words that are not colours", () => {
    const { container } = render(<ColorSchemeSwatches value="navy and orange, earthy" />);
    const dots = [...container.querySelectorAll("span[title]")].map((d) => d.getAttribute("title"));
    expect(dots).toEqual(["navy", "orange"]);
  });

  it("renders nothing for an empty scheme", () => {
    const { container } = render(<ColorSchemeSwatches value="  " />);
    expect(container).toBeEmptyDOMElement();
  });
});
