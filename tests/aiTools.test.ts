import { describe, it, expect } from "vitest";
import { parseFiles, extractHTML, countImages } from "@/lib/ai-tools/parse";
import { makeZip, zipBytes } from "@/lib/ai-tools/zip";
import { buildPrompt } from "@/lib/ai-tools/prompt";
import { EMPTY_INPUT } from "@/lib/ai-tools/prompt";
import { computeAiKpis, byTool, generationsOverTime } from "@/lib/ai-tools/analytics";
import { mapLeadToInput } from "@/lib/ai-tools/leadPrefill";
import { TOOLS, TOOL_IDS, isToolId, isPublicToolId } from "@/lib/ai-tools/config";
import type { AiGeneration } from "@/lib/ai-tools/types";

const ml = (p: Partial<AiGeneration>): AiGeneration => ({
  id: Math.random().toString(36).slice(2),
  tool: "webcraft",
  agent_id: null,
  lead_id: null,
  business_name: null,
  model: null,
  total_time_ms: null,
  input_time_ms: null,
  ai_time_ms: null,
  num_pages: null,
  num_files: null,
  page_types: null,
  tokens_used: null,
  cost_usd: null,
  status: "success",
  word_count: null,
  image_count: null,
  pexels_count: null,
  complexity_score: null,
  errors: null,
  file_path: null,
  created_at: new Date().toISOString(),
  ...p,
});

describe("parseFiles", () => {
  it("extracts multiple delimited files", () => {
    const raw = `PAGES TO GENERATE: 2
[FILE: index.html]
<!DOCTYPE html><html><body>home</body></html>
[END_FILE]
[FILE: about.html]
<!DOCTYPE html><html><body>about</body></html>
[END_FILE]`;
    const files = parseFiles(raw);
    expect(files).toHaveLength(2);
    expect(files[0].name).toBe("index.html");
    expect(files[1].name).toBe("about.html");
    expect(files[0].code).toContain("home");
  });

  it("falls back to a single file when no delimiters are present", () => {
    const raw = "Sure! <!DOCTYPE html><html><body>x</body></html> done";
    const files = parseFiles(raw);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("index.html");
    expect(files[0].code).toContain("<body>x</body>");
  });

  it("strips markdown fences wrapping a file body", () => {
    const raw = "[FILE: index.html]\n```html\n<!DOCTYPE html><html></html>\n```\n[END_FILE]";
    const files = parseFiles(raw);
    expect(files[0].code.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(files[0].code).not.toContain("```");
  });

  it("returns empty when there is no html at all", () => {
    expect(parseFiles("no code here")).toHaveLength(0);
  });

  it("extractHTML prefers a fenced block", () => {
    expect(extractHTML("```html\n<html>a</html>\n```")).toBe("<html>a</html>");
  });

  it("counts images", () => {
    expect(countImages([{ name: "i", code: "<img><img/>" }])).toBe(2);
  });
});

describe("makeZip", () => {
  it("produces zip bytes with the right signatures", () => {
    const files = [
      { name: "index.html", code: "<html>1</html>" },
      { name: "about.html", code: "<html>2</html>" },
    ];
    const bytes = zipBytes(files);
    expect(bytes.length).toBeGreaterThan(0);
    // local file header signature "PK\x03\x04"
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // end-of-central-directory signature "PK\x05\x06" near the tail
    const tail = bytes.slice(-22);
    expect([tail[0], tail[1], tail[2], tail[3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    // makeZip wraps the same bytes in a Blob
    expect(makeZip(files).size).toBe(bytes.length);
  });
});

describe("buildPrompt", () => {
  it("injects business details and the file delimiter format", () => {
    const p = buildPrompt({ ...EMPTY_INPUT, name: "Acme Roofing", pages: "3" });
    expect(p).toContain("Acme Roofing");
    expect(p).toContain("[FILE: index.html]");
    expect(p).toContain("[END_FILE]");
    expect(p).toContain("3-page website");
    expect(p.trim().endsWith("START GENERATING NOW.")).toBe(true);
  });
  it("applies fallbacks for empty fields", () => {
    const p = buildPrompt({ ...EMPTY_INPUT, name: "" });
    expect(p).toContain("Business Name: (not provided)");
  });
  it("renders derived experience and references", () => {
    const p = buildPrompt({ ...EMPTY_INPUT, exp: "12", r1: "https://a.com", r2: "https://b.com" });
    expect(p).toContain("Experience: 12 Years");
    expect(p).toContain("https://a.com\nhttps://b.com");
    expect(p).toContain("giving you 2 sites"); // ref_count
  });
  it("falls back to the default page list when names are blank", () => {
    const p = buildPrompt({ ...EMPTY_INPUT, pages: "3" });
    expect(p).toContain("Home, About, Services");
  });
});

describe("ai analytics", () => {
  it("computes kpis and success rate", () => {
    const rows = [
      ml({ status: "success", num_pages: 5, tokens_used: 1000, cost_usd: 0.002, total_time_ms: 4000 }),
      ml({ status: "failed", num_pages: 0 }),
      ml({ status: "success", num_pages: 3, tokens_used: 500, total_time_ms: 2000 }),
    ];
    const k = computeAiKpis(rows);
    expect(k.total).toBe(3);
    expect(k.success).toBe(2);
    expect(k.failed).toBe(1);
    expect(k.successRate).toBeCloseTo(2 / 3);
    expect(k.totalPages).toBe(8);
    expect(k.totalTokens).toBe(1500);
    expect(k.avgTimeSec).toBeCloseTo(3);
  });

  it("groups by tool", () => {
    const rows = [ml({ tool: "webcraft" }), ml({ tool: "deepseek" }), ml({ tool: "webcraft" })];
    const t = byTool(rows);
    expect(t.find((x) => x.name === "webcraft")?.value).toBe(2);
    expect(t.find((x) => x.name === "deepseek")?.value).toBe(1);
  });

  it("buckets generations over a trailing window", () => {
    const now = new Date("2026-06-22T12:00:00Z");
    const series = generationsOverTime([ml({ created_at: now.toISOString() })], 7, now);
    expect(series).toHaveLength(7);
    expect(series[series.length - 1].value).toBe(1);
  });
});

describe("mapLeadToInput", () => {
  it("maps configured lead columns to generator fields with join rules", () => {
    const f = mapLeadToInput({
      business_name: "Acme",
      business_phone: "555",
      services: ["Roofing", "Gutters"],
      num_webpages: 6,
      specify_pages: ["Home", "About"],
      color_scheme: "green",
      image_links: ["a", "b"],
    });
    expect(f.name).toBe("Acme");
    expect(f.phone).toBe("555");
    expect(f.services).toBe("Roofing, Gutters");
    expect(f.pages).toBe("6");
    expect(f.pageNames).toBe("Home, About");
    expect(f.imgs).toBe("a\nb"); // newline join
  });
  it("skips variables with no lead_column and null lead values", () => {
    const f = mapLeadToInput({ business_name: "Acme", color_scheme: null });
    expect(f.name).toBe("Acme");
    expect("color" in f).toBe(false);
    expect("hero" in f).toBe(false); // hero has no lead_column
  });
  it("respects a custom variable set", () => {
    const f = mapLeadToInput({ business_name: "X" }, [
      { key: "name", label: "n", type: "text", fallback: "", lead_column: "business_name", join: ", " },
    ]);
    expect(f).toEqual({ name: "X" });
  });
});

describe("isPublicToolId", () => {
  it("accepts the standalone generators", () => {
    expect(isPublicToolId("webcraft")).toBe(true);
    expect(isPublicToolId("deepseek")).toBe(true);
  });

  it("rejects internal providers, so they get no generate/save endpoint", () => {
    expect(TOOLS.gemini.internal).toBe(true);
    expect(isToolId("gemini")).toBe(true); // still a real provider
    expect(isPublicToolId("gemini")).toBe(false); // but not a public one
  });

  it("rejects unknown tools", () => {
    expect(isPublicToolId("nope")).toBe(false);
  });

  it("keeps every public tool reachable from the generator grid", () => {
    // The /ai-tools grid renders exactly the non-internal tools.
    expect(TOOL_IDS.filter((id) => !TOOLS[id].internal)).toEqual(["webcraft", "deepseek"]);
  });
});
