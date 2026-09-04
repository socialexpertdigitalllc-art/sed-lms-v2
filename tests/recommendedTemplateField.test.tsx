import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RecommendedTemplateField } from "@/components/leads/RecommendedTemplateField";

/**
 * The lead screen names the template sales recommended — the id alone on
 * the lead row was invisible to everyone reading the lead.
 */

const tpl = {
  id: "t-1",
  name: "Roof Smart",
  page_files: ["index.html", "about.html"],
  asset_files: ["style.css"],
  cover_image_path: "t-1/cover.png",
  in_service: true,
};

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string) => { status: number; body: unknown }) {
  const spy = vi.fn(async (url: string) => {
    const r = handler(url);
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  });
  vi.stubGlobal("fetch", spy as unknown as typeof fetch);
  return spy;
}

describe("RecommendedTemplateField", () => {
  it("shows the recommended template by name, fetched by id", async () => {
    const spy = stubFetch(() => ({ status: 200, body: { template: tpl } }));
    render(<RecommendedTemplateField templateId="t-1" canEdit={false} onChange={async () => {}} />);
    expect(await screen.findByText("Roof Smart")).toBeInTheDocument();
    expect(spy.mock.calls[0]?.[0]).toBe("/api/site-builder/templates/t-1");
    expect(screen.queryByRole("button", { name: /change/i })).toBeNull(); // read-only viewer
  });

  it("says so plainly when nothing was recommended", () => {
    stubFetch(() => ({ status: 200, body: {} }));
    render(<RecommendedTemplateField templateId={null} canEdit={false} onChange={async () => {}} />);
    expect(screen.getByText(/no template was recommended/i)).toBeInTheDocument();
  });

  it("explains a recommendation whose template was deleted", async () => {
    stubFetch(() => ({ status: 404, body: { error: "Template not found" } }));
    render(<RecommendedTemplateField templateId="gone" canEdit={false} onChange={async () => {}} />);
    expect(await screen.findByText(/no longer exists/i)).toBeInTheDocument();
  });

  it("an editor can remove the recommendation, and can open the picker to change it", async () => {
    stubFetch((url) =>
      url.includes("in_service=1")
        ? { status: 200, body: { templates: [tpl, { ...tpl, id: "t-2", name: "YY Tile" }] } }
        : { status: 200, body: { template: tpl } },
    );
    const onChange = vi.fn(async () => {});
    render(<RecommendedTemplateField templateId="t-1" canEdit onChange={onChange} />);
    await screen.findByText("Roof Smart");

    fireEvent.click(screen.getByRole("button", { name: /change/i }));
    expect(await screen.findByText("YY Tile")).toBeInTheDocument(); // the lead form's picker
    fireEvent.click(screen.getByRole("button", { name: "Select YY Tile" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("t-2"));

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(""));
  });
});
