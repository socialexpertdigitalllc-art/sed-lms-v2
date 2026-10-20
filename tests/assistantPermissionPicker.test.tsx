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
