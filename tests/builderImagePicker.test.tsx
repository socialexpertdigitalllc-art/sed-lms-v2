import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BuilderImagePicker } from "@/components/site-builder/BuilderImagePicker";
import { ToastProvider } from "@/components/common/Toast";
import { isOptimizableImageUrl } from "@/lib/images/hosts";

/**
 * The picker's operator-facing contract (feedback 2026-08-18):
 *  - picking a photo does NOT close the dialog (three hero photos = one open);
 *  - selection is instant and local — no request between click and tick;
 *  - the row's limit is respected, and a single-slot row swaps instead of
 *    refusing;
 *  - committing hands back the whole batch at once and records it in the
 *    background;
 *  - no success popups — only real errors.
 */

const CLIENT_PHOTOS = [
  "https://i.ibb.co/aaa/photo-1.jpg",
  "https://i.ibb.co/bbb/photo-2.jpg",
  "https://i.ibb.co/ccc/photo-3.jpg",
  "https://i.ibb.co/ddd/photo-4.jpg",
];

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ images: [], candidates: [], url: "x" }) }));
  vi.stubGlobal("fetch", fetchSpy as unknown as typeof fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(opts: { maxSelectable?: number; onAdded?: (imgs: { url: string; purpose: string }[]) => void; onClose?: () => void } = {}) {
  const onAdded = opts.onAdded ?? vi.fn();
  const onClose = opts.onClose ?? vi.fn();
  render(
    <ToastProvider>
      <BuilderImagePicker
        leadId="lead-1"
        purposeSuggestions={["Hero", "Gallery"]}
        clientPhotos={CLIENT_PHOTOS}
        maxSelectable={opts.maxSelectable ?? 3}
        onAdded={onAdded}
        onClose={onClose}
      />
    </ToastProvider>,
  );
  return { onAdded, onClose };
}

const photo = (n: number) => screen.getByRole("button", { name: `Client photo ${n}` });

describe("BuilderImagePicker", () => {
  it("opens on the client photos when the lead has them", () => {
    mount();
    expect(photo(1)).toBeInTheDocument();
    expect(screen.getByText("0 of 3 selected")).toBeInTheDocument();
  });

  it("selects several photos without closing or hitting the network, then commits one batch", async () => {
    const onAdded = vi.fn();
    const onClose = vi.fn();
    mount({ onAdded, onClose });

    fireEvent.click(photo(1));
    fireEvent.click(photo(2));
    fireEvent.click(photo(3));

    // still open, nothing sent yet — selection is local state
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^Add 3 images$/ }));

    expect(onAdded).toHaveBeenCalledTimes(1);
    expect(onAdded.mock.calls[0][0].map((i: { url: string }) => i.url)).toEqual([
      CLIENT_PHOTOS[0],
      CLIENT_PHOTOS[1],
      CLIENT_PHOTOS[2],
    ]);
    expect(onAdded.mock.calls[0][0][0].purpose).toBe("Hero");
    expect(onClose).toHaveBeenCalledTimes(1);

    // the library write happens in the background, after the commit
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
    expect(String(fetchSpy.mock.calls[0][0])).toBe("/api/site-builder/images/pick");
  });

  it("holds the row's limit, and clicking a selected photo deselects it", () => {
    mount({ maxSelectable: 2 });
    fireEvent.click(photo(1));
    fireEvent.click(photo(2));
    fireEvent.click(photo(3)); // over the limit — refused
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();

    fireEvent.click(photo(1)); // deselect frees a slot
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    fireEvent.click(photo(3));
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();
  });

  it("a single-slot row swaps the pick instead of refusing it", () => {
    const onAdded = vi.fn();
    mount({ maxSelectable: 1, onAdded });
    fireEvent.click(photo(1));
    fireEvent.click(photo(2));
    expect(screen.getByText("1 of 1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Add 1 image$/ }));
    expect(onAdded.mock.calls[0][0]).toEqual([{ url: CLIENT_PHOTOS[1], purpose: "Hero" }]);
  });

  it("never shows a success popup for a pick", async () => {
    mount();
    fireEvent.click(photo(1));
    fireEvent.click(screen.getByRole("button", { name: /^Add 1 image$/ }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(screen.queryByText(/image added/i)).not.toBeInTheDocument();
  });

  it("surfaces a failed library write as an error, since that IS a real problem", async () => {
    fetchSpy.mockImplementation(async () => ({ ok: false, json: async () => ({ error: "library write failed" }) }));
    mount();
    fireEvent.click(photo(1));
    fireEvent.click(screen.getByRole("button", { name: /^Add 1 image$/ }));
    expect(await screen.findByText(/library write failed/)).toBeInTheDocument();
  });
});

describe("isOptimizableImageUrl", () => {
  it("covers the hosts client photos and stock actually come from", () => {
    expect(isOptimizableImageUrl("https://i.ibb.co/aaa/photo.jpg")).toBe(true);
    expect(isOptimizableImageUrl("https://images.pexels.com/photos/1/x.jpeg")).toBe(true);
    expect(isOptimizableImageUrl("https://lh3.googleusercontent.com/x")).toBe(true);
  });

  it("leaves unknown or malformed hosts to render unoptimized rather than breaking", () => {
    expect(isOptimizableImageUrl("https://cdn.some-client.example/photo.jpg")).toBe(false);
    expect(isOptimizableImageUrl("not a url")).toBe(false);
    expect(isOptimizableImageUrl("")).toBe(false);
    expect(isOptimizableImageUrl(null)).toBe(false);
  });
});
