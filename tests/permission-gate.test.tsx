import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PermissionProvider } from "@/providers/PermissionProvider";
import { PermissionGate } from "@/components/shared/PermissionGate";

describe("PermissionGate", () => {
  it("renders children when permission present", () => {
    render(
      <PermissionProvider value={["leads.edit"]}>
        <PermissionGate perm="leads.edit">OK</PermissionGate>
      </PermissionProvider>
    );
    expect(screen.getByText("OK")).toBeInTheDocument();
  });

  it("renders fallback when permission absent", () => {
    render(
      <PermissionProvider value={[]}>
        <PermissionGate perm="leads.edit" fallback="NO">
          OK
        </PermissionGate>
      </PermissionProvider>
    );
    expect(screen.getByText("NO")).toBeInTheDocument();
  });
});
