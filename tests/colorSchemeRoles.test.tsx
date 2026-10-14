import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ColorSwatchRow } from "@/components/leads/ColorSchemeField";
import { schemeRoles } from "@/lib/site-builder/palette";

/**
 * The lead form says how the generated site will use each colour: in order,
 * primary, secondary, complementary; white and light colours the background;
 * black the dark areas.
 */
describe("schemeRoles", () => {
  it("names each colour's job, in the order given", () => {
    expect(schemeRoles("#0C5AA0, #F24F24, #2E8B57")).toEqual(["Primary", "Secondary", "Complementary"]);
    expect(schemeRoles("black, red, white")).toEqual(["Dark areas", "Primary", "Background"]);
    expect(schemeRoles("white, navy")).toEqual(["Background", "Primary"]);
    expect(schemeRoles("earthy, orange")).toEqual([null, "Primary"]);
    expect(schemeRoles("")).toEqual([]);
  });
});

describe("ColorSwatchRow", () => {
  it("labels every swatch with its role on the site", () => {
    render(<ColorSwatchRow value="white, #0C5AA0, black" onChange={() => {}} />);
    expect(screen.getByText("Background")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Dark areas")).toBeInTheDocument();
  });
});
