import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SocialProfilesRow } from "@/components/leads/SocialProfilesRow";

/**
 * A lead submitted with no social profiles — the common case on a first
 * call — had no way to gain them afterwards. This row is that way.
 */

const PROFILES = [
  { platform: "Facebook", url: "https://fb.com/acme", label: null },
  { platform: "Other", url: "https://pin.it/acme", label: "Pinterest" },
];

describe("SocialProfilesRow", () => {
  it("lists existing profiles as links, labelled by network (or the Other name)", () => {
    render(<SocialProfilesRow profiles={PROFILES} canEdit={false} onSave={vi.fn()} />);
    expect(screen.getByText("Facebook")).toBeInTheDocument();
    expect(screen.getByText("Pinterest")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://fb.com/acme" })).toHaveAttribute("target", "_blank");
  });

  it("offers no editor without the edit permission", () => {
    render(<SocialProfilesRow profiles={[]} canEdit={false} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /edit social profiles/i })).not.toBeInTheDocument();
  });

  it("opens on an EMPTY field with one blank row ready to fill, and saves the cleaned list", async () => {
    const onSave = vi.fn(async () => {});
    render(<SocialProfilesRow profiles={[]} canEdit onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: /edit social profiles/i }));
    const editor = screen.getByTestId("social-profiles-editor");
    const urls = within(editor).getAllByLabelText(/social profile url/i);
    expect(urls).toHaveLength(1);

    fireEvent.change(urls[0], { target: { value: " https://instagram.com/acme " } });
    fireEvent.change(within(editor).getByLabelText(/social platform 1/i), { target: { value: "Instagram" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([{ platform: "Instagram", url: "https://instagram.com/acme", label: null }]);
    await waitFor(() => expect(screen.queryByTestId("social-profiles-editor")).not.toBeInTheDocument());
  });

  it("seeds the editor with the existing rows", () => {
    render(<SocialProfilesRow profiles={PROFILES} canEdit onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /edit social profiles/i }));
    const editor = screen.getByTestId("social-profiles-editor");
    expect(within(editor).getAllByLabelText(/social profile url/i)).toHaveLength(2);
    expect(within(editor).getByLabelText(/other network name/i)).toHaveValue("Pinterest");
  });

  it("saves null, not an empty array, when every row is removed", async () => {
    const onSave = vi.fn(async () => {});
    render(<SocialProfilesRow profiles={PROFILES} canEdit onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit social profiles/i }));
    // Re-query after each click: the list re-keys as rows go, so a button
    // captured up front is detached by the time it is clicked.
    for (let guard = 0; guard < 5; guard++) {
      const [remove] = screen.queryAllByRole("button", { name: /remove social profile/i });
      if (!remove) break;
      fireEvent.click(remove);
    }
    expect(screen.queryAllByLabelText(/social profile url/i)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
  });

  it("cancel discards the draft and saves nothing", () => {
    const onSave = vi.fn();
    render(<SocialProfilesRow profiles={PROFILES} canEdit onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit social profiles/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId("social-profiles-editor")).not.toBeInTheDocument();
    expect(screen.getByText("Facebook")).toBeInTheDocument();
  });

  it("stays in edit mode and shows the reason when the save is refused", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("You can only modify your own leads.");
    });
    render(<SocialProfilesRow profiles={PROFILES} canEdit onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /edit social profiles/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/only modify your own leads/i)).toBeInTheDocument();
    expect(screen.getByTestId("social-profiles-editor")).toBeInTheDocument();
  });
});
