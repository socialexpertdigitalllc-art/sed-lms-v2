import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { RecommendedTemplateField } from "@/components/leads/RecommendedTemplateField";
import { HeroVideoGallery, EMPTY_HERO_VIDEO } from "@/components/hero-videos/HeroVideoGallery";
import { invalidateHeroVideos } from "@/components/hero-videos/useHeroVideos";

/**
 * A video-hero template (SD Home) cannot be recommended without its hero
 * video: picking it opens the gallery, and only the gallery's confirmation
 * saves — template and video together.
 */

const plain = { id: "t-1", name: "Roof Smart", page_files: ["index.html"], asset_files: [], cover_image_path: null, in_service: true };
const sdHome = { ...plain, id: "t-sd", name: "SD Home", hero_video: true };
const VIDEOS = [
  { id: "v-k1", name: "Kitchen Remodel", category: "Kitchen Remodel", media_url: "https://m.test/k1.mp4", duration_ms: 37_700, width: 1920, height: 1080 },
  { id: "v-k2", name: "Kitchen Remodel 2", category: "Kitchen Remodel", media_url: "https://m.test/k2.mp4", duration_ms: 17_100, width: 1920, height: 1080 },
  { id: "v-r1", name: "Roofing", category: "Roofing", media_url: "https://m.test/r1.mp4", duration_ms: 26_700, width: 1920, height: 1080 },
];

beforeEach(() => invalidateHeroVideos());
afterEach(() => vi.unstubAllGlobals());

function stubFetch() {
  const spy = vi.fn(async (url: string) => {
    const body = url.startsWith("/api/site-builder/hero-videos")
      ? { videos: VIDEOS }
      : url.includes("in_service=1")
        ? { templates: [plain, sdHome] }
        : { template: plain };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", spy as unknown as typeof fetch);
  return spy;
}

describe("HeroVideoGallery", () => {
  it("opens on the lead's trade, filters by category, and confirms the picked video", async () => {
    stubFetch();
    const onConfirm = vi.fn();
    render(<HeroVideoGallery value={EMPTY_HERO_VIDEO} leadCategory="Roofing" onConfirm={onConfirm} onClose={() => {}} />);

    // Lead category "Roofing" → the Roofing filter is active, kitchens hidden.
    await screen.findByText("Roofing", { selector: "h3" });
    expect(screen.queryByText("Kitchen Remodel 2")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Kitchen Remodel/ }));
    expect(await screen.findByText("Kitchen Remodel 2")).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: /use this video/i });
    expect(confirm).toBeDisabled();
    const card = screen.getByText("Kitchen Remodel 2").closest("div.flex.flex-col") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: /use this video/i }));
    expect(onConfirm).toHaveBeenCalledWith({ videoId: "v-k2", request: false, note: "" });
  });

  it("requests a new video with what it should show", async () => {
    stubFetch();
    const onConfirm = vi.fn();
    render(<HeroVideoGallery value={EMPTY_HERO_VIDEO} onConfirm={onConfirm} onClose={() => {}} />);
    await screen.findByText("Kitchen Remodel 2");

    fireEvent.click(screen.getByRole("button", { name: /request a new video/i }));
    fireEvent.change(screen.getByLabelText(/what the new video should show/i), { target: { value: "  solar panels on a tile roof " } });
    fireEvent.click(screen.getByRole("button", { name: /request new video/i }));
    expect(onConfirm).toHaveBeenCalledWith({ videoId: null, request: true, note: "solar panels on a tile roof" });
  });

  it("offers no request option to the developer", async () => {
    stubFetch();
    render(<HeroVideoGallery value={EMPTY_HERO_VIDEO} allowRequest={false} onConfirm={() => {}} onClose={() => {}} />);
    await screen.findByText("Kitchen Remodel 2");
    expect(screen.queryByRole("button", { name: /request a new video/i })).toBeNull();
  });
});

describe("RecommendedTemplateField + video-hero template", () => {
  it("picking SD Home opens the gallery and saves nothing until a video is confirmed", async () => {
    stubFetch();
    const onChange = vi.fn(async () => {});
    render(<RecommendedTemplateField templateId="t-1" canEdit onChange={onChange} leadCategory="Kitchen Remodel" />);
    await screen.findByText("Roof Smart");

    fireEvent.click(screen.getByRole("button", { name: /change/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Select SD Home" }));
    expect(await screen.findByRole("dialog", { name: /choose the hero video/i })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    const card = (await screen.findByText("Kitchen Remodel 2")).closest("div.flex.flex-col") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: /use this video/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("t-sd", { videoId: "v-k2", request: false, note: "" }));
  });

  it("cancelling the gallery keeps the old template", async () => {
    stubFetch();
    const onChange = vi.fn(async () => {});
    render(<RecommendedTemplateField templateId="t-1" canEdit onChange={onChange} />);
    await screen.findByText("Roof Smart");
    fireEvent.click(screen.getByRole("button", { name: /change/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Select SD Home" }));
    const dialog = await screen.findByRole("dialog", { name: /choose the hero video/i });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });
});
