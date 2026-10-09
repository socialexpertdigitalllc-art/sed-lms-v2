import { describe, it, expect } from "vitest";
import { parseInline, parseMarkdown, safeHref } from "@/lib/assistant/markdown";
import { parseChartSpec } from "@/lib/assistant/chart";

describe("inline markdown", () => {
  it("parses emphasis, code, strikethrough and links", () => {
    expect(parseInline("**6** more, *soon*, `code`, ~~old~~")).toEqual([
      { kind: "strong", children: [{ kind: "text", text: "6" }] },
      { kind: "text", text: " more, " },
      { kind: "em", children: [{ kind: "text", text: "soon" }] },
      { kind: "text", text: ", " },
      { kind: "code", text: "code" },
      { kind: "text", text: ", " },
      { kind: "del", children: [{ kind: "text", text: "old" }] },
    ]);
  });

  it("links leads internally and refuses unsafe schemes", () => {
    expect(parseInline("[Acme Plumbing](/leads/123)")).toEqual([
      { kind: "link", href: "/leads/123", children: [{ kind: "text", text: "Acme Plumbing" }] },
    ]);
    // javascript: renders as its text, never as a link.
    expect(parseInline("[click](javascript:alert(1))")).toEqual([{ kind: "text", text: "click" }, { kind: "text", text: ")" }]);
    expect(safeHref("//evil.com")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
  });

  it("leaves snake_case and lone asterisks alone", () => {
    expect(parseInline("price_quoted and close_rate")).toEqual([{ kind: "text", text: "price_quoted and close_rate" }]);
    expect(parseInline("5 * 3 = 15")).toEqual([{ kind: "text", text: "5 * 3 = 15" }]);
  });

  it("keeps line breaks", () => {
    expect(parseInline("a\nb")).toEqual([{ kind: "text", text: "a" }, { kind: "br" }, { kind: "text", text: "b" }]);
  });
});

describe("block markdown", () => {
  it("parses a typical analysis reply", () => {
    const blocks = parseMarkdown(
      [
        "## This month",
        "You closed **4** deals.",
        "",
        "| Agent | Closed | Rate |",
        "|:--|--:|:-:|",
        "| Sam | 3 | 60% |",
        "| Ali | 1 | 20% |",
        "",
        "- Call before noon",
        "  - their time, not ours",
        "- Drop stale leads",
        "",
        "1. First",
        "2. Second",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "table", "list", "list"]);
    const table = blocks[2] as Extract<(typeof blocks)[number], { kind: "table" }>;
    expect(table.align).toEqual(["left", "right", "center"]);
    expect(table.rows).toHaveLength(2);
    const bullets = blocks[3] as Extract<(typeof blocks)[number], { kind: "list" }>;
    expect(bullets.items).toHaveLength(2);
    expect(bullets.items[0].children[0]).toMatchObject({ kind: "list" });
    expect(blocks[4]).toMatchObject({ kind: "list", ordered: true, start: 1 });
  });

  it("tolerates a fence that has not finished streaming", () => {
    const blocks = parseMarkdown('Here:\n```chart\n{"type":"bar","data":[');
    expect(blocks[1]).toEqual({ kind: "code", lang: "chart", text: '{"type":"bar","data":[', closed: false });
  });

  it("parses quotes and rules without hanging", () => {
    expect(parseMarkdown("> quoted\n> more\n\n---\nafter").map((b) => b.kind)).toEqual(["quote", "hr", "paragraph"]);
  });

  it("never produces HTML from HTML input", () => {
    const blocks = parseMarkdown("<script>alert(1)</script>");
    expect(blocks).toEqual([{ kind: "paragraph", content: [{ kind: "text", text: "<script>alert(1)</script>" }] }]);
  });
});

describe("chart specs", () => {
  it("accepts a single-series chart", () => {
    const spec = parseChartSpec('{"type":"bar","title":"Closed","data":[{"label":"Aug","value":12},{"label":"Sep","value":"17"}]}');
    expect(spec).toMatchObject({ type: "bar", title: "Closed", series: ["value"], rows: [{ label: "Aug", values: { value: 12 } }, { label: "Sep", values: { value: 17 } }] });
  });

  it("accepts multiple series and infers them when unnamed", () => {
    const spec = parseChartSpec('{"type":"line","data":[{"label":"Aug","closed":12,"dropped":"$4"}]}');
    expect(spec).toMatchObject({ series: ["closed", "dropped"], rows: [{ values: { closed: 12, dropped: 4 } }] });
  });

  it("refuses what it cannot draw honestly", () => {
    expect(parseChartSpec("{oops")).toEqual({ error: "The chart data is not valid JSON." });
    expect(parseChartSpec('{"type":"radar","data":[{"label":"a","value":1}]}')).toEqual({ error: 'Unknown chart type "radar".' });
    expect(parseChartSpec('{"type":"bar","data":[]}')).toEqual({ error: "The chart has no data." });
    expect(parseChartSpec('{"type":"bar","data":[{"label":"a","value":"lots"}]}')).toMatchObject({ error: expect.stringMatching(/no numeric values|no number/) });
  });
});
