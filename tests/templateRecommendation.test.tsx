import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TemplateRecommendation } from "@/components/leads/TemplateRecommendation";
import { templateCoverUrl, templatePreviewUrl } from "@/components/site-builder/TemplateCard";
import { emptyNewLead, validateNewLead, buildLeadPayload } from "@/lib/leads/newLeadForm";
import { createLeadSchema } from "@/lib/leads/schema";

/**
 * Sales picks a template WITH the client, from pictures. The in-service switch
 * on the operator's board is the whole gate — an off template is absent here,
 * not greyed out, so nobody asks why they cannot pick it.
 */

const TEMPLATES = [
  { id: "t-1", name: "Plumber Pro", page_files: ["index.html", "about.html"], asset_files: ["css/a.css"], cover_image_path: "t-1/cover.png" },
  { id: "t-2", name: "Roofer Bold", page_files: ["index.html"], asset_files: [], cover_image_path: "t-2/cover.jpg" },
];

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ templates: TEMPLATES }) }));
  vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe("TemplateRecommendation", () => {
  it("asks the API for IN-SERVICE templates only", async () => {
    render(<TemplateRecommendation value="" onChange={vi.fn()} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/site-builder/templates?in_service=1");
  });

  it("shows each template as a card with its cover and page/asset counts", async () => {
    render(<TemplateRecommendation value="" onChange={vi.fn()} />);
    expect(await screen.findByText("Plumber Pro")).toBeInTheDocument();

    const cover = screen.getByAltText("Plumber Pro cover") as HTMLImageElement;
    expect(cover.getAttribute("src")).toBe(templateCoverUrl("t-1"));
    expect(screen.getByText("2 pages")).toBeInTheDocument();
    expect(screen.getByText("1 asset")).toBeInTheDocument();
  });

  it("offers a preview that opens in a NEW tab", async () => {
    render(<TemplateRecommendation value="" onChange={vi.fn()} />);
    await screen.findByText("Plumber Pro");

    const links = screen.getAllByRole("link", { name: /preview in new tab/i });
    expect(links[0]).toHaveAttribute("href", templatePreviewUrl("t-1"));
    expect(links[0]).toHaveAttribute("target", "_blank");
    // Without this a template preview could reach back into the opener.
    expect(links[0].getAttribute("rel")).toContain("noopener");
  });

  it("selects a template, and clicking the selected one clears it", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<TemplateRecommendation value="" onChange={onChange} />);
    await screen.findByText("Plumber Pro");

    fireEvent.click(screen.getByRole("button", { name: "Select Plumber Pro" }));
    expect(onChange).toHaveBeenCalledWith("t-1");

    rerender(<TemplateRecommendation value="t-1" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Select Plumber Pro" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("marks the chosen card as selected", async () => {
    render(<TemplateRecommendation value="t-2" onChange={vi.fn()} />);
    await screen.findByText("Roofer Bold");
    expect(screen.getByRole("button", { name: "Select Roofer Bold" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Select Plumber Pro" })).toHaveAttribute("aria-pressed", "false");
  });

  it("tells the agent to consult their closer", async () => {
    render(<TemplateRecommendation value="" onChange={vi.fn()} />);
    expect(await screen.findByText(/check with your closer/i)).toBeInTheDocument();
  });

  it("says so when nothing is in service, rather than showing an empty grid", async () => {
    fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ templates: [] }) }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    render(<TemplateRecommendation value="" onChange={vi.fn()} />);
    expect(await screen.findByText(/no templates are in service yet/i)).toBeInTheDocument();
  });

  it("survives the API failing", async () => {
    fetchSpy = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    render(<TemplateRecommendation value="" onChange={vi.fn()} />);
    expect(await screen.findByText(/could not load the templates/i)).toBeInTheDocument();
  });
});

describe("template selection is optional on the lead form", () => {
  function filled() {
    return {
      ...emptyNewLead("Ready"),
      business_name: "Acme",
      business_phone: "(252) 401-2775",
      business_email: "a@b.com",
      platform: "Google",
      business_profile_link: "https://x.test",
      has_service_areas: "No" as const,
      services: ["Roofing"],
      client_experience: "5",
      color_scheme: "navy, gold",
      follow_up_time: new Date(Date.now() + 86_400_000).toISOString().slice(0, 16),
      price_quoted: "500",
      comments: "ok",
      rating: 7,
      fresh_or_followup: "Fresh",
    };
  }

  it("does not block submission when no template is chosen", () => {
    expect(validateNewLead(filled()).recommended_template_id).toBeUndefined();
  });

  it("passes once one is chosen", () => {
    const f = { ...filled(), recommended_template_id: "3f1e5a1e-0000-4000-8000-000000000000" };
    expect(validateNewLead(f).recommended_template_id).toBeUndefined();
  });

  it("carries the id into the payload, and the schema accepts it", () => {
    const id = "3f1e5a1e-0000-4000-8000-000000000000";
    const payload = buildLeadPayload({ ...filled(), recommended_template_id: id });
    expect(payload.recommended_template_id).toBe(id);
    expect(createLeadSchema.safeParse(payload).success).toBe(true);
  });

  it("sends null rather than an empty string when somehow unset", () => {
    expect(buildLeadPayload(filled()).recommended_template_id).toBeNull();
  });

  it("rejects a non-uuid template id at the schema boundary", () => {
    const parsed = createLeadSchema.safeParse({
      business_name: "Acme",
      status: "Ready",
      recommended_template_id: "not-a-uuid",
    });
    expect(parsed.success).toBe(false);
  });
});
