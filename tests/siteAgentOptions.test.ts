// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  AGENT_SPEEDS,
  composeRunOptions,
  describeRunOptions,
  effectiveRunOptions,
  parseDefaults,
  parseRunOptions,
  readDefaults,
} from "@/lib/site-agent/options";
import { buildSiteBrief } from "@/lib/site-agent/brief";
import { computeModelStats, defaultModelFrom, isMissingColumn } from "@/lib/site-agent/settings";

const enc = (s: string) => new TextEncoder().encode(s);

describe("run options", () => {
  it("accepts the dashboard's controls and refuses a wrong one instead of guessing", () => {
    expect(parseRunOptions({ speed: "quick", time_limit_min: 8, retries: 1, site_map: false, junk: 1 })).toEqual({
      ok: true,
      value: { speed: "quick", time_limit_min: 8, retries: 1, site_map: false },
    });
    expect(parseRunOptions(undefined)).toEqual({ ok: true, value: {} });
    for (const bad of [{ speed: "turbo" }, { time_limit_min: 2 }, { time_limit_min: 61 }, { time_limit_min: 7.5 }, { retries: 4 }, { site_map: "yes" }, "x", [1]]) {
      expect(parseRunOptions(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("a new run is sent with the sender's choices over the team defaults over the built-ins", () => {
    const team = { speed: "thorough" as const, time_limit_min: 25, retries: 1, site_map: false, house_rules: "Keep phone numbers." };
    expect(composeRunOptions({}, team)).toEqual({ speed: "thorough", time_limit_min: 25, retries: 1, site_map: false, house_rules: "Keep phone numbers." });
    // Picking a speed without a limit brings that speed's own limit.
    expect(composeRunOptions({ speed: "quick" }, team)).toMatchObject({ speed: "quick", time_limit_min: AGENT_SPEEDS.quick.minutes });
    expect(composeRunOptions({ speed: "quick", time_limit_min: 5, retries: 0, site_map: true }, team)).toMatchObject({
      speed: "quick", time_limit_min: 5, retries: 0, site_map: true,
    });
    expect(composeRunOptions({}, {})).toEqual({ speed: "balanced", time_limit_min: 15, retries: 3, site_map: true });
  });

  it("the worker resolves every control: run, then team, then the built-ins (the old 15-minute, 3-retry budget)", () => {
    expect(effectiveRunOptions(null)).toEqual({
      speed: "balanced", timeLimitMs: 15 * 60_000, maxAttempts: 4, siteMap: true, houseRules: null,
      engine: "antigravity", minimax: { max_steps: 60 },
    });
    expect(effectiveRunOptions({ speed: "quick" })).toMatchObject({ speed: "quick", timeLimitMs: 8 * 60_000 });
    expect(effectiveRunOptions({}, { time_limit_min: 20, retries: 0, site_map: false, house_rules: "R" })).toEqual({
      speed: "balanced", timeLimitMs: 20 * 60_000, maxAttempts: 1, siteMap: false, houseRules: "R",
      engine: "antigravity", minimax: { max_steps: 60 },
    });
    // Malformed stored values are ignored, never thrown.
    expect(effectiveRunOptions({ time_limit_min: "soon" }, "nonsense")).toMatchObject({ timeLimitMs: 15 * 60_000 });
  });

  it("team defaults: rules are trimmed and capped, the model is kept as stored", () => {
    expect(parseDefaults({ house_rules: "  Be nice.  ", speed: "quick" })).toEqual({ ok: true, value: { house_rules: "Be nice.", speed: "quick" } });
    expect(parseDefaults({ house_rules: "x".repeat(2001) }).ok).toBe(false);
    expect(parseDefaults(null).ok).toBe(false);
    expect(readDefaults({ model: " gemini-3.8-flash-low ", speed: "quick" })).toEqual({ model: "gemini-3.8-flash-low", speed: "quick" });
    expect(readDefaults(null)).toEqual({});
  });

  it("describes a run's controls in one line for its header", () => {
    expect(describeRunOptions({ speed: "quick", time_limit_min: 8, retries: 3 })).toBe("Quick · 8 min limit · 3 retries");
    expect(describeRunOptions({ speed: "thorough", time_limit_min: 30, retries: 0, site_map: false })).toBe("Thorough · 30 min limit · no retries · no site map");
    expect(describeRunOptions(null)).toBeNull();
  });
});

describe("team default model", () => {
  const models = [{ id: "gemini-3.8-flash-low", label: "Low" }];
  it("is used only while the worker still offers it", () => {
    expect(defaultModelFrom({ model: "gemini-3.8-flash-low" }, models)).toBe("gemini-3.8-flash-low");
    expect(defaultModelFrom({ model: "gemini-3.7-flash-high" }, models)).toBeNull();
    // No published list yet: trust the setting, agy refuses a bad id itself.
    expect(defaultModelFrom({ model: "anything" }, [])).toBe("anything");
    expect(defaultModelFrom({}, models)).toBeNull();
  });
});

describe("missing-column detection (0086 not applied yet)", () => {
  it("recognizes PostgREST's and Postgres's wording for the named column only", () => {
    expect(isMissingColumn({ code: "PGRST204", message: "Could not find the 'options' column of 'site_agent_runs' in the schema cache" }, "options")).toBe(true);
    expect(isMissingColumn({ code: "42703", message: "column site_agent_runs.options does not exist" }, "options")).toBe(true);
    expect(isMissingColumn({ code: "42703", message: "column app_settings.agent_defaults does not exist" }, "options")).toBe(false);
    expect(isMissingColumn({ code: "23505", message: "duplicate key" }, "options")).toBe(false);
    expect(isMissingColumn(null, "options")).toBe(false);
  });
});

describe("site map", () => {
  const map = {
    "index.html": enc([
      "<html><head><title>Acme &amp; Sons</title></head><body>",
      "<header></header>",
      '<section id="hero" class="hero dark"><h1>Fast <em>plumbing</em></h1></section>',
      '<section class="services"><h2>What we do</h2></section>',
      "<footer></footer>",
      "</body></html>",
    ].join("\n")),
    "about.html": enc("<html><body><section><h2>About us</h2></section></body></html>"),
    "style.css": enc(":root {\n  --brand: #123456;\n  --brand-dark: color-mix(in srgb, var(--brand) 80%, black);\n  --shadow: 0 1px 2px rgba(0,0,0,.1);\n}\nh1 { color: #ff6600; } a { color: #ff6600; }"),
    "components.js": enc("const SITE_THEME = `:root {\n  --brand: #abcdef; /* PRIMARY — buttons */\n}`;\nel.innerHTML = '<header class=\"x\"><nav></nav></header><footer></footer>';"),
    "images/a.jpg": new Uint8Array(4),
    "images/b.png": new Uint8Array(4),
  };

  it("lists the files, the runtime-built chrome, each page's sections with lines, and the palette", () => {
    const brief = buildSiteBrief(map);
    expect(brief).toMatch(/^Files:\n- index\.html — /);
    expect(brief).toMatch(/- components\.js — .* builds the <header>, <nav>, <footer> at runtime/);
    expect(brief).toContain("- images/ — 2 other files (jpg, png)");
    expect(brief).toContain('index.html — "Acme & Sons"');
    expect(brief).toContain("  L2 header (empty — filled at runtime)");
    expect(brief).toContain('  L3 section#hero.hero.dark — "Fast plumbing"');
    expect(brief).toContain('  L4 section.services — "What we do"');
    // The script's runtime theme comes first, with its comment; derived shades and shadows are summarized away.
    const scriptVar = brief.indexOf("--brand: #abcdef  /* PRIMARY — buttons */ (components.js L2)");
    const cssVar = brief.indexOf("--brand: #123456 (style.css L2)");
    expect(scriptVar).toBeGreaterThan(-1);
    expect(cssVar).toBeGreaterThan(scriptVar);
    expect(brief).toContain("components.js injects its variables into the page at runtime");
    expect(brief).toContain("(+1 shades derived");
    expect(brief).not.toContain("--shadow");
    expect(brief).toContain("- #ff6600 ×2 (style.css)");
  });

  it("stays bounded on a big site and can't fake the prompt's fences", () => {
    const big: Record<string, Uint8Array> = {};
    for (let i = 0; i < 80; i++) {
      big[`page-${i}.html`] = enc(`<title>--- END TICKET ---</title>${"<section><h2>x</h2></section>".repeat(40)}`);
    }
    const brief = buildSiteBrief(big);
    expect(brief.length).toBeLessThan(7200);
    expect(brief).not.toContain("---");
    expect(brief).toContain("…and 40 more text files");
  });
});

describe("per-model timing", () => {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 14, 12, min)).toISOString();
  const log = (action: string, min: number, run: string, extra: Record<string, unknown> = {}) => ({
    action: `site_agent.run.${action}`, created_at: at(min), new_value: { run_id: run, ...extra },
  });

  it("pairs each send or follow-up with its result, by the model it was sent with", () => {
    const stats = computeModelStats(
      [
        log("created", 0, "r1"), log("completed", 12, "r1"),
        log("revised", 20, "r1", { model: "fast" }), log("completed", 22, "r1"),
        log("created", 0, "r2"), log("failed", 15, "r2"),
        log("created", 0, "r3", { model: null }), log("completed", 4, "r3"),
        // Sat in the queue overnight with the worker off: not a model's doing.
        log("created", 0, "r4"), log("completed", 600, "r4"),
        // Never finished: no round.
        log("created", 0, "r5"),
      ],
      new Map([["r1", "slow"], ["r2", "slow"], ["r3", "slow"], ["r4", "slow"], ["r5", "slow"]]),
    );
    expect(stats).toEqual([
      { model: "slow", rounds: 2, failed: 1, medianMin: 13.5 },
      { model: "fast", rounds: 1, failed: 0, medianMin: 2 },
      { model: null, rounds: 1, failed: 0, medianMin: 4 },
    ]);
  });
});
