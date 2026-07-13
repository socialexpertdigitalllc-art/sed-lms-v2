import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { parseViewState, pickStoredView } from "@/lib/url/viewState";
import { useViewState } from "@/hooks/useViewState";
import { ViewScopeProvider } from "@/providers/ViewScopeProvider";

// The hook reads Next's pathname + searchParams; drive them from the test.
let mockPath = "/leads";
let mockQs = "";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useSearchParams: () => new URLSearchParams(mockQs),
}));

const DEFAULTS = { q: "", status: "All", page: "0" };

function Harness() {
  const [state, setState] = useViewState(DEFAULTS);
  return (
    <div>
      <span data-testid="q">{state.q}</span>
      <span data-testid="status">{state.status}</span>
      <span data-testid="page">{state.page}</span>
      <button data-testid="set" onClick={() => setState({ q: "cafe", page: "3" })}>
        set
      </button>
    </div>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  mockPath = "/leads";
  mockQs = "";
});

describe("parseViewState", () => {
  it("overlays query params onto defaults, ignoring unknown keys", () => {
    expect(parseViewState(DEFAULTS, "q=cafe&junk=1")).toEqual({ q: "cafe", status: "All", page: "0" });
  });
  it("returns defaults for an empty query", () => {
    expect(parseViewState(DEFAULTS, "")).toEqual(DEFAULTS);
  });
});

describe("pickStoredView", () => {
  it("keeps only known string-valued keys", () => {
    expect(pickStoredView(DEFAULTS, JSON.stringify({ q: "x", page: 3, junk: "y" }))).toEqual({ q: "x" });
  });
  it("is null for missing or malformed payloads", () => {
    expect(pickStoredView(DEFAULTS, null)).toBeNull();
    expect(pickStoredView(DEFAULTS, "{not json")).toBeNull();
    expect(pickStoredView(DEFAULTS, JSON.stringify([1, 2]))).toBeNull();
  });
});

describe("useViewState", () => {
  it("never writes to the URL on state changes", () => {
    const spy = vi.spyOn(window.history, "replaceState");
    const r = render(<Harness />);
    act(() => {
      r.getByTestId("set").click();
    });
    expect(r.getByTestId("q").textContent).toBe("cafe");
    expect(r.getByTestId("page").textContent).toBe("3");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("restores the last-used view after unmount/remount (Back navigation)", () => {
    const r = render(<Harness />);
    act(() => {
      r.getByTestId("set").click();
    });
    r.unmount();

    const r2 = render(<Harness />);
    expect(r2.getByTestId("q").textContent).toBe("cafe");
    expect(r2.getByTestId("page").textContent).toBe("3");
    expect(r2.getByTestId("status").textContent).toBe("All");
  });

  it("applies incoming deep-link params over the stored view and consumes them", () => {
    sessionStorage.setItem("view:anon:/leads", JSON.stringify({ q: "stored", status: "Ready", page: "2" }));
    mockQs = "status=Closed";
    const spy = vi.spyOn(window.history, "replaceState");

    const r = render(<Harness />);
    // deep link wins wholesale (it defines the view; stored one is replaced)
    expect(r.getByTestId("status").textContent).toBe("Closed");
    expect(r.getByTestId("q").textContent).toBe("");
    // consumed: persisted for this path + address bar cleaned exactly once
    expect(JSON.parse(sessionStorage.getItem("view:anon:/leads")!)).toEqual({ q: "", status: "Closed", page: "0" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(null, "", window.location.pathname);
    spy.mockRestore();
  });

  it("keeps views separate per path", () => {
    const r = render(<Harness />);
    act(() => {
      r.getByTestId("set").click();
    });
    r.unmount();

    mockPath = "/pre-leads";
    const r2 = render(<Harness />);
    expect(r2.getByTestId("q").textContent).toBe(""); // untouched path starts at defaults
  });

  it("does NOT share filter state between users on the same browser (the cross-account bleed)", () => {
    // User A sets a filter on /leads…
    const a = render(
      <ViewScopeProvider userId="user-A">
        <Harness />
      </ViewScopeProvider>
    );
    act(() => {
      a.getByTestId("set").click();
    });
    expect(a.getByTestId("q").textContent).toBe("cafe");
    a.unmount();

    // …then user B signs in on the same tab (session storage survives) and must start clean.
    const b = render(
      <ViewScopeProvider userId="user-B">
        <Harness />
      </ViewScopeProvider>
    );
    expect(b.getByTestId("q").textContent).toBe("");
    expect(b.getByTestId("status").textContent).toBe("All");

    // User A's stored filter is untouched under their own key.
    expect(JSON.parse(sessionStorage.getItem("view:user-A:/leads")!)).toMatchObject({ q: "cafe" });
  });
});
