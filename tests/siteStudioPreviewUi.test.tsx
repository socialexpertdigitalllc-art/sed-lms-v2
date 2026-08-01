import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RunPreview, SlotEditor, resolveClickTarget } from "@/components/site-studio/RunPreview";
import { ThemePanel } from "@/components/site-studio/ThemePanel";
import { ToastProvider } from "@/components/common/Toast";
import { DeploymentsBoard, type BoardRow } from "@/components/site-studio/DeploymentsBoard";
import type { TemplateManifest } from "@/lib/site-studio/schema";
import type { StudioRunRow } from "@/lib/site-studio/run/types";
import type { RunContentDoc } from "@/lib/site-studio/run/applyWritten";

/**
 * Mount smoke tests, 2b/3b precedent (tests/siteStudioBoard.test.tsx,
 * tests/siteStudioCockpit.test.tsx): no real network, and — unlike the
 * cockpit's own tests — no fetch mocking is needed at all here, because
 * none of these assertions trigger a request: `RunPreview` takes its `run`
 * as a prop (no internal load), and `SlotEditor`/`ThemePanel` are mounted
 * directly, the same way `ImagePicker` is tested standalone in
 * siteStudioCockpit.test.tsx, rather than by simulating a real click
 * through the preview iframe (jsdom does not execute the iframe's own
 * navigation, so nothing inside it is reachable the way a browser click
 * would be — see RunPreview.tsx's own note on this).
 */

function runFixture(overrides: Partial<StudioRunRow> = {}): StudioRunRow {
  return {
    id: "run-1",
    lead_id: "lead-1",
    template_id: "tmpl-1",
    template_version: 1,
    status: "ready",
    options: {},
    content_doc: {
      identity: { business_name: "Ace Plumbing" },
      theme: { brand: "#112233" },
      pages: [
        {
          page_id: "index",
          output: "index.html",
          nav_title: "Home",
          title: "Welcome",
          slots: { hero_text: "We fix pipes fast.", hero_image: "img/a.jpg" },
          repeats: {},
        },
        {
          page_id: "svc",
          output: "services/plumbing.html",
          title: "Plumbing",
          slots: { svc_text: "About plumbing" },
          repeats: {},
        },
      ],
      provenance: [
        { title: { written_by: "ai" }, slots: { hero_text: { written_by: "operator" } }, repeats: {} },
        { title: { written_by: "ai" }, slots: { svc_text: { written_by: "ai" } }, repeats: {} },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    steps: {},
    client_photos: [],
    site_slug: "ace-plumbing-abc123",
    zip_path: "runs/run-1/site.zip",
    deployed_url: null,
    error: null,
    paused: false,
    created_by: null,
    created_at: "2026-07-25T00:00:00.000Z",
    updated_at: "2026-07-26T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Phase 4c: gallery/card images almost always sit inside a repeat, and a
 * click on one used to just toast "not supported" — `ImagePicker` only knew
 * a flat pageIndex/slotId. `resolveClickTarget` is the pure decision behind
 * every preview click (text or image, flat or repeat-row); these test it
 * directly rather than through a real click, since jsdom doesn't execute the
 * preview iframe's own navigation (see RunPreview.tsx's own note on this).
 */
describe("resolveClickTarget", () => {
  function docFixture(): RunContentDoc {
    return {
      identity: {},
      theme: {},
      pages: [
        {
          page_id: "gallery",
          title: "Gallery",
          slots: { hero_img: "img/hero.jpg", hero_alt: "A hero" },
          repeats: {
            cards: [
              { card_img: "img/card1.jpg", card_alt: "Card one", card_text: "First" },
              { card_img: "img/card2.jpg", card_alt: "Card two", card_text: "Second" },
            ],
          },
        },
      ],
      provenance: [
        {
          slots: { hero_text: { written_by: "operator" } },
          repeats: { cards: { "1": { card_text: { written_by: "operator" } } } },
        },
      ],
    };
  }

  it("resolves a flat page-level text click", () => {
    const next = resolveClickTarget(docFixture(), "0:hero_alt", false, null);
    expect(next).toEqual({ kind: "text", pageIndex: 0, slotId: "hero_alt", value: "A hero", operatorOwned: false });
  });

  it("resolves a flat page-level image click, picking up its paired alt slot", () => {
    const next = resolveClickTarget(docFixture(), "0:hero_img", true, "0:hero_alt");
    expect(next).toEqual({
      kind: "image", pageIndex: 0, slotId: "hero_img", altSlotId: "hero_alt", altValue: "A hero",
    });
  });

  it("resolves a repeat-row TEXT click, scoped to that row only", () => {
    const next = resolveClickTarget(docFixture(), "0:cards#1:card_text", false, null);
    expect(next).toEqual({
      kind: "text", pageIndex: 0, slotId: "card_text", value: "Second", operatorOwned: true,
      repeat: { repeatId: "cards", rowIndex: 1 },
    });
  });

  it("resolves a repeat-row IMAGE click — this is the fix: it used to be unsupported", () => {
    const next = resolveClickTarget(docFixture(), "0:cards#1:card_img", true, "0:cards#1:card_alt");
    expect(next).toEqual({
      kind: "image", pageIndex: 0, slotId: "card_img", altSlotId: "card_alt", altValue: "Card two",
      repeat: { repeatId: "cards", rowIndex: 1 },
    });
  });

  it("ignores an alt key from a DIFFERENT row than the image itself", () => {
    const next = resolveClickTarget(docFixture(), "0:cards#1:card_img", true, "0:cards#0:card_alt");
    expect(next).toEqual({
      kind: "image", pageIndex: 0, slotId: "card_img", altSlotId: undefined, altValue: "",
      repeat: { repeatId: "cards", rowIndex: 1 },
    });
  });

  it("ignores a flat alt key for a repeat-row image (shape mismatch)", () => {
    const next = resolveClickTarget(docFixture(), "0:cards#1:card_img", true, "0:hero_alt");
    expect(next?.kind).toBe("image");
    if (next?.kind !== "image") return;
    expect(next.altSlotId).toBeUndefined();
  });

  it("returns null for a malformed key", () => {
    expect(resolveClickTarget(docFixture(), "not-a-key", false, null)).toBeNull();
  });

  it("returns null for an out-of-range page index", () => {
    expect(resolveClickTarget(docFixture(), "9:hero_img", true, null)).toBeNull();
  });

  it("returns null for a repeat row that doesn't exist in the doc", () => {
    expect(resolveClickTarget(docFixture(), "0:cards#9:card_img", true, null)).toBeNull();
  });
});

describe("RunPreview", () => {
  it("renders the preview iframe with the page index and version query", () => {
    render(<RunPreview run={runFixture()} onRunUpdated={() => {}} />);
    const frame = screen.getByTitle("Site preview") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe(
      `/api/site-studio/runs/run-1/preview?page=0&v=${encodeURIComponent("2026-07-26T00:00:00.000Z")}`,
    );
  });

  it("renders one page control per doc page", () => {
    render(<RunPreview run={runFixture()} onRunUpdated={() => {}} />);
    expect(screen.getAllByTestId("ss-page-tab")).toHaveLength(2);
    expect(screen.getByText(/home/i)).toBeInTheDocument();
    expect(screen.getByText(/services\/plumbing\.html/)).toBeInTheDocument();
  });

  it("the width toggle changes the iframe's container width, not its src", () => {
    render(<RunPreview run={runFixture()} onRunUpdated={() => {}} />);
    const wrap = screen.getByTestId("ss-preview-frame");
    const frame = screen.getByTitle("Site preview") as HTMLIFrameElement;
    const originalSrc = frame.getAttribute("src");
    expect(wrap).toHaveStyle({ width: "100%" });

    fireEvent.click(screen.getByRole("button", { name: /mobile width/i }));
    expect(wrap).toHaveStyle({ width: "375px" });
    expect(frame.getAttribute("src")).toBe(originalSrc);

    fireEvent.click(screen.getByRole("button", { name: /desktop width/i }));
    expect(wrap).toHaveStyle({ width: "100%" });
  });

  it("shows the Deploy button only when the run is ready", () => {
    const { rerender } = render(<RunPreview run={runFixture({ status: "ready" })} onRunUpdated={() => {}} />);
    expect(screen.getByRole("button", { name: /deploy/i })).toBeEnabled();

    rerender(<RunPreview run={runFixture({ status: "rendering" })} onRunUpdated={() => {}} />);
    expect(screen.queryByRole("button", { name: /deploy/i })).not.toBeInTheDocument();
  });

  /**
   * Task 9 shipped `POST /api/site-studio/runs/[id]/deploy` a while ago, but
   * this button stayed a permanently-disabled stub with a stale "Task 9
   * hasn't shipped" comment until now — the whole deploy feature was
   * unreachable from the UI even though the backend worked. These replace
   * the old "is disabled" test with real behaviour: confirm -> POST -> button
   * disabled in flight -> success shows the URL / failure toasts verbatim.
   * No live DirectAdmin call — `fetch` is stubbed throughout.
   */
  describe("Deploy button", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stubConfirm(result = true) {
      const confirmSpy = vi.fn(() => result);
      vi.stubGlobal("confirm", confirmSpy);
      return confirmSpy;
    }

    it("does nothing (no fetch) when the operator declines the confirmation", async () => {
      const confirmSpy = stubConfirm(false);
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      render(<RunPreview run={runFixture({ status: "ready" })} onRunUpdated={() => {}} />);

      fireEvent.click(screen.getByRole("button", { name: /deploy/i }));

      expect(confirmSpy).toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("disables the button while the deploy request is in flight, and re-enables on completion", async () => {
      stubConfirm(true);
      let resolveFetch: (v: unknown) => void = () => {};
      const pending = new Promise((resolve) => { resolveFetch = resolve; });
      vi.stubGlobal("fetch", vi.fn(() => pending));
      render(<RunPreview run={runFixture({ status: "ready" })} onRunUpdated={() => {}} />);

      const deployBtn = screen.getByRole("button", { name: /deploy/i });
      fireEvent.click(deployBtn);
      await waitFor(() => expect(deployBtn).toBeDisabled());

      resolveFetch({ ok: true, json: async () => ({ url: "https://ace-plumbing.dmviral.com", clearWarning: null }) });
      await waitFor(() => expect(deployBtn).toBeEnabled());
    });

    it("on success, shows the returned URL as an external link", async () => {
      stubConfirm(true);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ url: "https://ace-plumbing.dmviral.com", sub: "ace-plumbing", reused: false, clearWarning: null }),
        })),
      );
      render(<RunPreview run={runFixture({ status: "ready" })} onRunUpdated={() => {}} />);

      fireEvent.click(screen.getByRole("button", { name: /deploy/i }));

      const link = await screen.findByRole("link", { name: /ace-plumbing\.dmviral\.com/ });
      expect(link).toHaveAttribute("href", "https://ace-plumbing.dmviral.com");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    });

    it("on failure, toasts the server's message verbatim (e.g. the 409 cross-lead guard)", async () => {
      stubConfirm(true);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: false,
          json: async () => ({ error: "This subdomain is already live under a different lead (lead-9)." }),
        })),
      );
      render(
        <ToastProvider>
          <RunPreview run={runFixture({ status: "ready" })} onRunUpdated={() => {}} />
        </ToastProvider>,
      );

      fireEvent.click(screen.getByRole("button", { name: /deploy/i }));

      expect(await screen.findByText("This subdomain is already live under a different lead (lead-9).")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("surfaces a 502 upstream failure verbatim, distinct from a 409", async () => {
      stubConfirm(true);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: false,
          json: async () => ({ error: "DirectAdmin upload failed: disk full" }),
        })),
      );
      render(
        <ToastProvider>
          <RunPreview run={runFixture({ status: "ready" })} onRunUpdated={() => {}} />
        </ToastProvider>,
      );

      fireEvent.click(screen.getByRole("button", { name: /deploy/i }));

      expect(await screen.findByText("DirectAdmin upload failed: disk full")).toBeInTheDocument();
    });

    it("surfaces clearWarning as its own toast alongside a successful deploy", async () => {
      stubConfirm(true);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            url: "https://ace-plumbing.dmviral.com",
            clearWarning: "clearing the old docroot failed: permission denied — the live site may mix two builds",
          }),
        })),
      );
      render(
        <ToastProvider>
          <RunPreview run={runFixture({ status: "ready" })} onRunUpdated={() => {}} />
        </ToastProvider>,
      );

      fireEvent.click(screen.getByRole("button", { name: /deploy/i }));

      expect(
        await screen.findByText("clearing the old docroot failed: permission denied — the live site may mix two builds"),
      ).toBeInTheDocument();
      expect(await screen.findByRole("link", { name: /ace-plumbing\.dmviral\.com/ })).toBeInTheDocument();
    });
  });
});

describe("SlotEditor", () => {
  it("shows the revert button only when the field is operator-owned", () => {
    const { rerender } = render(
      <SlotEditor
        title="hero_text"
        value="We fix pipes fast."
        operatorOwned={true}
        onSave={async () => {}}
        onRevert={async () => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /revert to ai/i })).toBeInTheDocument();

    rerender(
      <SlotEditor
        title="svc_text"
        value="About plumbing"
        operatorOwned={false}
        onSave={async () => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /revert to ai/i })).not.toBeInTheDocument();
  });
});

const manifestFixture: TemplateManifest = {
  engine: 3,
  name: "plumberpro",
  version: 1,
  identity: { business_name: "PlumberPro" },
  theme: { mode: "css_vars", roles: { brand: { hex: "#112233" }, accent: { var: "--accent", hex: "#445566" } } },
  nav: [],
  pages: [
    { id: "index", file: "index.html", kind: "home", stampable: false, title_sample: "Home", slots: [], repeats: [] },
  ],
};

describe("ThemePanel", () => {
  it("renders one color input per manifest-declared role", () => {
    render(
      <ThemePanel
        runId="run-1"
        manifest={manifestFixture}
        theme={{ brand: "#112233", accent: "#445566" }}
        onRunUpdated={() => {}}
      />,
    );
    expect(screen.getByLabelText("Theme role brand")).toBeInTheDocument();
    expect(screen.getByLabelText("Theme role accent")).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="color"]')).toHaveLength(2);
  });

  it("renders nothing when the template declares no theme roles", () => {
    const noRoles: TemplateManifest = { ...manifestFixture, theme: { mode: "none", roles: {} } };
    const { container } = render(
      <ThemePanel runId="run-1" manifest={noRoles} theme={{}} onRunUpdated={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * DeploymentsBoard mount-smoke (Phase 4a Task 10, 2b/3b precedent per
 * tests/siteStudioBoard.test.tsx / siteStudioCockpit.test.tsx): fetch is
 * stubbed per URL/query, no real network. Covers rendering canned rows, the
 * status filter re-requesting with the right `?status=`, and that a
 * `v2_import` row (the shape Phase 4b's cutover seeds) shows its own badge
 * rather than being mistaken for a studio-authored deployment.
 */
function boardRowFixture(overrides: Partial<BoardRow> = {}): BoardRow {
  return {
    id: "dep-1",
    subdomain: "ace-plumbingv1",
    url: "https://ace-plumbingv1.dmviral.com",
    status: "live",
    origin: "studio",
    category: "ready",
    leadId: "lead-1",
    leadName: "Ace Plumbing",
    leadStatus: "Ready",
    deployedAt: "2026-07-26T00:00:00.000Z",
    isCustomDomain: false,
    ...overrides,
  };
}

function stubDeploymentsFetch(handler: (url: string) => { rows: BoardRow[] }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      return {
        ok: true,
        json: async () => ({ counts: {}, daDomain: "dmviral.com", hostingWarning: null, ...handler(url) }),
      } as Response;
    }),
  );
  return calls;
}

describe("DeploymentsBoard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mount() {
    return render(
      <ToastProvider>
        <DeploymentsBoard />
      </ToastProvider>,
    );
  }

  it("renders rows from canned data — business name, URL, status, and deployed time", async () => {
    stubDeploymentsFetch(() => ({ rows: [boardRowFixture()] }));
    mount();

    expect(await screen.findByText("Ace Plumbing")).toBeInTheDocument();
    expect(screen.getByText("ace-plumbingv1.dmviral.com")).toBeInTheDocument();
    expect(screen.getByText("live")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ace-plumbingv1\.dmviral\.com/ })).toHaveAttribute(
      "href",
      "https://ace-plumbingv1.dmviral.com",
    );
  });

  it("the view tabs re-request with the matching ?view= and swap the rows shown", async () => {
    const calls = stubDeploymentsFetch((url) => {
      if (url.includes("view=live")) {
        return {
          rows: [
            boardRowFixture({
              id: "dep-2",
              subdomain: null,
              url: "https://oldroofing.com",
              category: "live",
              isCustomDomain: true,
              leadName: "Old Roofing",
            }),
          ],
        };
      }
      return { rows: [boardRowFixture()] };
    });
    mount();
    expect(await screen.findByText("Ace Plumbing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Live Websites/ }));

    await waitFor(() => expect(screen.getByText("Old Roofing")).toBeInTheDocument());
    expect(screen.queryByText("Ace Plumbing")).not.toBeInTheDocument();
    expect(calls.some((u) => u.includes("view=live"))).toBe(true);
  });

  it("shows a v2_import row's origin badge and an untracked hosting subdomain row", async () => {
    stubDeploymentsFetch(() => ({
      rows: [
        boardRowFixture({ id: "dep-3", origin: "v2_import", leadName: "Legacy Diner" }),
        boardRowFixture({
          id: null,
          subdomain: "mystery-site",
          url: "https://mystery-site.dmviral.com",
          status: "untracked",
          origin: null,
          category: "other",
          leadId: null,
          leadName: null,
          leadStatus: null,
          deployedAt: null,
        }),
      ],
    }));
    mount();

    expect(await screen.findByText("Legacy Diner")).toBeInTheDocument();
    expect(screen.getByText("v2 import")).toBeInTheDocument();
    expect(screen.getByText("mystery-site")).toBeInTheDocument();
    expect(screen.getAllByText("untracked").length).toBeGreaterThan(0);
  });

  it("bulk-selecting subdomains shows the delete bar with the count", async () => {
    stubDeploymentsFetch(() => ({
      rows: [
        boardRowFixture(),
        boardRowFixture({ id: "dep-2", subdomain: "beta-sitev1", url: "https://beta-sitev1.dmviral.com", leadName: "Beta Site" }),
      ],
    }));
    mount();
    expect(await screen.findByText("Ace Plumbing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all subdomains" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete selected/ })).toBeInTheDocument();
  });
});
