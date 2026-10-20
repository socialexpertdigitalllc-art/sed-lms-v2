import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionModePicker } from "@/components/assistant/PermissionModePicker";
import { PERMISSION_MODES } from "@/lib/assistant/actions/permissions";
import type { ActPermissionsView } from "@/components/assistant/useActPermissions";

/** The permission-mode switch by the message box. */

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const view = (over: Partial<ActPermissionsView> = {}): ActPermissionsView => ({
  mode: "ask",
  effective: "ask",
  cap: "auto",
  modes: PERMISSION_MODES.map((m) => ({ ...m, allowed: true })),
  allow: [],
  ...over,
});

describe("PermissionModePicker", () => {
  it("shows the mode in force and switches to another", async () => {
    const onChange = vi.fn();
    render(<PermissionModePicker view={view()} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Ask first/ }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Auto-run safe changes/ }));
    expect(onChange).toHaveBeenCalledWith("auto_safe");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("modes above the company limit can't be picked", async () => {
    const onChange = vi.fn();
    render(<PermissionModePicker view={view({ cap: "auto_safe", modes: PERMISSION_MODES.map((m) => ({ ...m, allowed: m.mode !== "auto" })) })} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Ask first/ }));
    const auto = screen.getByRole("menuitemradio", { name: /Auto-run all but high-impact/ });
    expect(auto).toBeDisabled();
    expect(auto).toHaveTextContent(/admin has limited/);
  });

  it("links to the full settings, counting what is always allowed", async () => {
    render(<PermissionModePicker view={view({ effective: "auto", mode: "auto", allow: [{ key: "lead.create", title: "Create a lead", group: "Leads" }] })} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^Auto/ }));
    expect(screen.getByRole("link", { name: /Manage \(1 always allowed\)/ })).toHaveAttribute("href", "/assistant/actions?tab=permissions");
  });
});

describe("PermissionAskCard — SED AI asked once for a higher mode", () => {
  it("one click switches and carries the job on; or keep asking", async () => {
    const { PermissionAskCard } = await import("@/components/assistant/PermissionAskCard");
    const onDecide = vi.fn();
    const { rerender } = render(<PermissionAskCard mode="auto" reason="to categorise 802 leads" current="ask" canDecide onDecide={onDecide} />);
    expect(screen.getByText(/to categorise 802 leads/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Switch and continue/ }));
    expect(onDecide).toHaveBeenCalledWith("auto");
    await userEvent.click(screen.getByRole("button", { name: /Keep asking me/ }));
    expect(onDecide).toHaveBeenLastCalledWith(null);

    // Once switched, it just says so.
    rerender(<PermissionAskCard mode="auto" reason={null} current="auto" canDecide onDecide={onDecide} />);
    expect(screen.getByText(/Switched — the job carries on/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Switch and continue/ })).toBeNull();

    // An older turn (or while answering): no buttons.
    rerender(<PermissionAskCard mode="auto" reason={null} current="ask" canDecide={false} onDecide={onDecide} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
