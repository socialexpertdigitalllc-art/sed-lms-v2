// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ToastProvider } from "@/components/common/Toast";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/hooks/useLiveLeads", () => ({ syncLeadsNow: vi.fn() }));

import { SiteReviewBox } from "@/components/leads/SiteReviewBox";

const URL_ = "https://acme.dmviral.com";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

function show(props: Partial<Parameters<typeof SiteReviewBox>[0]> = {}) {
  return render(
    <ToastProvider>
      <SiteReviewBox leadId="lead-1" review={{ url: URL_, published_at: "2026-11-13T10:00:00Z" }} isDeveloper hasFinishedLink={false} {...props} />
    </ToastProvider>,
  );
}

describe("SiteReviewBox", () => {
  it("sales see that the developer is finishing it — and never the link", () => {
    const { container } = show({ isDeveloper: false, review: { url: null, published_at: "2026-11-13T10:00:00Z" } });
    expect(screen.getByText(/being finalized by the developer/i)).toBeTruthy();
    expect(container.innerHTML).not.toContain("dmviral");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("an update to a finished site reads as an update", () => {
    show({ isDeveloper: false, review: { url: null, published_at: "2026-11-13T10:00:00Z" }, hasFinishedLink: true });
    expect(screen.getByText(/finishing an update/i)).toBeTruthy();
  });

  it("developers see the link and finalize it after confirming", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, url: URL_ }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    show();
    expect(screen.getByRole("link", { name: new RegExp(URL_) }).getAttribute("href")).toBe(URL_);
    fireEvent.click(screen.getByRole("button", { name: /finalize website/i }));
    expect(fetchMock).not.toHaveBeenCalled(); // asks first
    fireEvent.click(screen.getByRole("button", { name: /yes, finalize/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/leads/lead-1/site-review/finalize", { method: "POST" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("a refused finalize says why and keeps the box", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Only a developer can finalize a website." }), { status: 403 })));
    show();
    fireEvent.click(screen.getByRole("button", { name: /finalize website/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, finalize/i }));
    await waitFor(() => expect(screen.getByText(/only a developer can finalize/i)).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
