import { describe, it, expect } from "vitest";
import { resolveClickTarget, trackBatchSchema } from "@/lib/activity/track";

function el(html: string): Element {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild as Element;
}

describe("resolveClickTarget", () => {
  it("labels a button by its text", () => {
    const r = resolveClickTarget(el("<button>Generate</button>"));
    expect(r).toEqual({ label: "Generate", meta: {} });
  });
  it("prefers data-track and captures href + leadId", () => {
    const a = el('<a href="/leads/123" data-track="Open lead" data-lead-id="123">Acme</a>');
    expect(resolveClickTarget(a)).toEqual({ label: "Open lead", meta: { href: "/leads/123", leadId: "123" } });
  });
  it("resolves the nearest interactive ancestor", () => {
    const span = el('<button data-track="Tab: Queue"><span>Queue</span></button>').querySelector("span")!;
    expect(resolveClickTarget(span)?.label).toBe("Tab: Queue");
  });
  it("returns null for non-interactive clicks", () => {
    expect(resolveClickTarget(el("<div>just text</div>"))).toBeNull();
  });
  it("collapses whitespace and caps long labels", () => {
    const r = resolveClickTarget(el(`<button>  ${"x".repeat(200)}  </button>`));
    expect(r!.label.length).toBe(80);
  });
});

describe("trackBatchSchema", () => {
  it("accepts a valid batch", () => {
    const ok = trackBatchSchema.safeParse({ events: [{ type: "page_view", path: "/leads" }] });
    expect(ok.success).toBe(true);
  });
  it("rejects an unknown type and oversized batches", () => {
    expect(trackBatchSchema.safeParse({ events: [{ type: "scroll" }] }).success).toBe(false);
    expect(trackBatchSchema.safeParse({ events: Array(51).fill({ type: "click" }) }).success).toBe(false);
  });
});
