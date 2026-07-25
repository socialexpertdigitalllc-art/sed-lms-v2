import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SiteStudioBoard } from "@/components/site-studio/SiteStudioBoard";
import { ReviewDrawer } from "@/components/site-studio/ReviewDrawer";

/**
 * Mount smoke tests. The board and drawer are only ever exercised behind a
 * login, so a crash-on-mount (bad import, null deref on a list row that has no
 * manifest, missing primitive) would otherwise reach an operator before anyone
 * noticed. These render the real components against a stubbed fetch.
 */

const listRow = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Plumber Pro",
  status: "needs_review",
  version: 1,
  niche_tags: ["plumbing"],
  // list rows deliberately carry NO manifest — the board derives hasManifest
  // from compiled_at, and the card must not claim "not compiled"
  diagnostics: [{ level: "warn", code: "identity_name_heuristic", message: "heuristic name" }],
  compiled_at: "2026-07-25T00:00:00.000Z",
  identity_enriched_at: null,
  semantics_enriched_at: null,
  certified_at: null,
  created_at: "2026-07-25T00:00:00.000Z",
  updated_at: "2026-07-25T00:00:00.000Z",
};

const detailRow = {
  ...listRow,
  manifest: {
    engine: 3, name: "plumberpro", version: 1,
    identity: { business_name: "PlumberPro" },
    theme: { mode: "none", roles: {} },
    nav: [],
    pages: [
      { id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home", slots: [], repeats: [] },
    ],
  },
};

function stubFetch(handler: (url: string) => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return { ok: true, json: async () => handler(url) } as Response;
  }));
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SiteStudioBoard", () => {
  it("renders the empty state when there are no templates", async () => {
    stubFetch(() => ({ templates: [] }));
    render(<SiteStudioBoard />);
    expect(await screen.findByText(/no templates yet/i)).toBeInTheDocument();
    // the upload affordance is always available
    expect(screen.getByLabelText(/template name/i)).toBeInTheDocument();
  });

  it("renders a card for a compiled list row without claiming it is uncompiled", async () => {
    stubFetch(() => ({ templates: [listRow] }));
    render(<SiteStudioBoard />);
    const heading = await screen.findByText("Plumber Pro");
    // scope to the card itself — "Needs review" also appears as a filter chip
    const card = heading.closest("div.rounded-lg");
    expect(card).toBeTruthy();
    expect(card!.textContent).toMatch(/needs review/i);
    // regression guard: a list row has no manifest, but compiled_at is set, so
    // the card must NOT render the "not compiled" copy
    expect(card!.textContent).not.toMatch(/not compiled/i);
    // and it offers Review (not Details) because a package exists
    expect(screen.getByRole("button", { name: /^review$/i })).toBeInTheDocument();
  });

  it("filters the grid by search query", async () => {
    stubFetch(() => ({ templates: [listRow] }));
    render(<SiteStudioBoard />);
    await screen.findByText("Plumber Pro");
    const search = screen.getByLabelText(/search templates/i) as HTMLInputElement;
    // typing a non-matching query hides the card
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(search, { target: { value: "roofing" } });
    await waitFor(() => expect(screen.queryByText("Plumber Pro")).not.toBeInTheDocument());
  });
});

describe("ReviewDrawer", () => {
  it("renders the checklist and both preview panes for a compiled template", async () => {
    stubFetch(() => ({ template: detailRow }));
    render(<ReviewDrawer templateId={detailRow.id} onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText("Plumber Pro")).toBeInTheDocument();
    // the flagged diagnostic appears in the checklist
    expect(screen.getByText("identity_name_heuristic")).toBeInTheDocument();
    // side-by-side: original + compiled iframes, both sandboxed
    const frames = await waitFor(() => {
      const found = document.querySelectorAll("iframe");
      expect(found.length).toBe(2);
      return found;
    });
    for (const f of Array.from(frames)) {
      expect(f.getAttribute("sandbox")).toBe("");
    }
    expect(Array.from(frames).some((f) => (f.getAttribute("src") ?? "").includes("/original/"))).toBe(true);
    expect(Array.from(frames).some((f) => (f.getAttribute("src") ?? "").includes("/preview/"))).toBe(true);
  });

  it("offers Certify for a clean needs_review template", async () => {
    stubFetch(() => ({ template: { ...detailRow, diagnostics: [] } }));
    render(<ReviewDrawer templateId={detailRow.id} onClose={() => {}} onChanged={() => {}} />);
    const certify = await screen.findByRole("button", { name: /certify template/i });
    expect(certify).not.toBeDisabled();
  });

  it("disables Certify when a blocker is present", async () => {
    stubFetch(() => ({
      template: { ...detailRow, diagnostics: [{ level: "blocker", code: "roundtrip_mismatch", message: "broke" }] },
    }));
    render(<ReviewDrawer templateId={detailRow.id} onClose={() => {}} onChanged={() => {}} />);
    const certify = await screen.findByRole("button", { name: /certify template/i });
    expect(certify).toBeDisabled();
  });
});
