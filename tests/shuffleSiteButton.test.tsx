import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShuffleSiteButton } from "@/components/common/ShuffleSiteButton";
import { ToastProvider } from "@/components/common/Toast";

/**
 * A shuffle deletes the old address, so the icon's whole job is moving the
 * RIGHT site: the confirm dialog must name the bound host before anything
 * happens, cancel must send nothing, and the POST must target the bound site.
 */

afterEach(() => vi.unstubAllGlobals());

function mount(onShuffled?: (url: string) => void) {
  return render(
    <ToastProvider>
      <ShuffleSiteButton site="https://greenlawn.dmviral.com" onShuffled={onShuffled} />
    </ToastProvider>,
  );
}

describe("ShuffleSiteButton", () => {
  it("confirms with the host named, posts to that site, reports the new address", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, url: "https://greenlawnv2.dmviral.com" }),
    }));
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    const onShuffled = vi.fn();

    mount(onShuffled);
    fireEvent.click(screen.getByRole("button", { name: "Shuffle greenlawn.dmviral.com to a new subdomain" }));
    expect(screen.getByRole("dialog", { name: /greenlawn\.dmviral\.com/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Shuffle greenlawn.dmviral.com" }));

    await waitFor(() => expect(onShuffled).toHaveBeenCalledWith("https://greenlawnv2.dmviral.com"));
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/site-studio/deployments/shuffle?site=" + encodeURIComponent("https://greenlawn.dmviral.com"));
    expect(init.method).toBe("POST");
    expect(await screen.findByText(/now live at greenlawnv2\.dmviral\.com/)).toBeInTheDocument();
  });

  it("cancel sends nothing", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Shuffle greenlawn/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces the server's reason when the shuffle is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: "Only a live site can be shuffled" }) })),
    );
    const onShuffled = vi.fn();
    mount(onShuffled);
    fireEvent.click(screen.getByRole("button", { name: /Shuffle greenlawn/ }));
    fireEvent.click(screen.getByRole("button", { name: "Shuffle greenlawn.dmviral.com" }));
    expect(await screen.findByText("Only a live site can be shuffled")).toBeInTheDocument();
    expect(onShuffled).not.toHaveBeenCalled();
  });
});
