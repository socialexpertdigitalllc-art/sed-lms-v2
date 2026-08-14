import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UploadSiteFilesButton } from "@/components/common/UploadSiteFilesButton";
import { ToastProvider } from "@/components/common/Toast";

/**
 * The upload icon's whole job is uploading to the RIGHT site: the confirm
 * dialog must name the bound host before anything is sent, cancel must send
 * nothing, and the POST must target the bound site — never a picked one.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(onUploaded?: () => void) {
  const utils = render(
    <ToastProvider>
      <UploadSiteFilesButton site="https://greenlawn.dmviral.com" onUploaded={onUploaded} />
    </ToastProvider>,
  );
  const pick = () => {
    const input = utils.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["zipbytes"], "fixed.zip", { type: "application/zip" })] } });
  };
  return { ...utils, pick };
}

describe("UploadSiteFilesButton", () => {
  it("confirms with the target host named, then posts the file to that site", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, files: 4 }),
    }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    const onUploaded = vi.fn();

    const { pick } = mount(onUploaded);
    fireEvent.click(screen.getByRole("button", { name: "Upload updated files to greenlawn.dmviral.com" }));
    pick();

    // dialog names the host in title and confirm button
    expect(screen.getByRole("dialog", { name: /greenlawn\.dmviral\.com/ })).toBeInTheDocument();
    expect(screen.getByText("fixed.zip")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Upload to greenlawn.dmviral.com" }));

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "/api/site-studio/deployments/override?site=" + encodeURIComponent("https://greenlawn.dmviral.com"),
    );
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
    expect(await screen.findByText(/now live on greenlawn\.dmviral\.com/)).toBeInTheDocument();
  });

  it("cancel sends nothing", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);

    const { pick } = mount();
    pick();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces the server's refusal as a toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        json: async () => ({ error: "the zip has no index.html at its root — this does not look like a website" }),
      })) as unknown as typeof fetch,
    );

    const { pick } = mount();
    pick();
    fireEvent.click(screen.getByRole("button", { name: /^Upload to /
    }));

    expect(await screen.findByText(/no index\.html/)).toBeInTheDocument();
  });
});
