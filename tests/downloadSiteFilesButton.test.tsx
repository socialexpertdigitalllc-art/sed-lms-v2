import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DownloadSiteFilesButton } from "@/components/common/DownloadSiteFilesButton";
import { ToastProvider } from "@/components/common/Toast";
import { DeploymentsBoard, type BoardRow } from "@/components/site-studio/DeploymentsBoard";

/**
 * The "download latest website files" icon (deployments board / ticket screen /
 * lead screen). jsdom can't save files, so the success path asserts the
 * blob-anchor mechanics (createObjectURL + anchor click with the server-named
 * file) rather than a real download.
 */

const createObjectURL = vi.fn(() => "blob:mock");
const revokeObjectURL = vi.fn();
let anchorClick: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  anchorClick.mockRestore();
  vi.unstubAllGlobals();
});

function mountButton(site = "https://greenlawn.dmviral.com") {
  return render(
    <ToastProvider>
      <DownloadSiteFilesButton site={site} />
    </ToastProvider>,
  );
}

describe("DownloadSiteFilesButton", () => {
  it("downloads the zip under the server-provided filename", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({
          "Content-Disposition": 'attachment; filename="greenlawn.dmviral.com-files-2026-08-13.zip"',
        }),
        blob: async () => new Blob(["zipbytes"]),
      })) as unknown as typeof fetch,
    );

    mountButton();
    fireEvent.click(screen.getByRole("button", { name: /download the latest files of greenlawn/i }));

    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/site-studio/deployments/download?site=" + encodeURIComponent("https://greenlawn.dmviral.com"),
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("surfaces the server's error as a toast instead of navigating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        headers: new Headers(),
        json: async () => ({ error: "elsewhere.com is not hosted on the company hosting, so its files cannot be downloaded here." }),
      })) as unknown as typeof fetch,
    );

    mountButton("https://elsewhere.com");
    fireEvent.click(screen.getByRole("button", { name: /download the latest files of elsewhere\.com/i }));

    expect(await screen.findByText(/not hosted on the company hosting/)).toBeInTheDocument();
    expect(anchorClick).not.toHaveBeenCalled();
  });
});

/** Board integration: the icon shows on live staging AND custom-domain rows. */
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

describe("DeploymentsBoard download icons", () => {
  it("offers a download on live staging and custom-domain rows, none on protected rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          counts: {},
          daDomain: "dmviral.com",
          hostingWarning: null,
          rows: [
            boardRowFixture(),
            boardRowFixture({
              id: "dep-2",
              subdomain: null,
              url: "https://client.com",
              isCustomDomain: true,
              leadName: "Client Co",
              origin: "manual",
              category: "live",
            }),
            boardRowFixture({
              id: null,
              subdomain: null,
              url: "https://sedlms.com",
              isCustomDomain: true,
              protected: true,
              leadName: null,
              leadId: null,
              leadStatus: null,
              origin: null,
              category: "other",
            }),
          ],
        }),
      })) as unknown as typeof fetch,
    );

    render(
      <ToastProvider>
        <DeploymentsBoard />
      </ToastProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "Download the latest files of ace-plumbingv1.dmviral.com" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download the latest files of client.com" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download the latest files of sedlms\.com/i })).not.toBeInTheDocument();
    expect(screen.getByText("Protected")).toBeInTheDocument();
  });
});
