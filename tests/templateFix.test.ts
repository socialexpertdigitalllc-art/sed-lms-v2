// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { extractDemoTokens } from "@/lib/template-engine/demoTokens";
import { runTemplateHealthChecks, type HealthReport } from "@/lib/template-engine/health";
import {
  applyFixEdits,
  assessImprovement,
  assessFixability,
  blankedFiles,
  parseFixProposal,
  planTemplateFix,
  tokenFilesOf,
} from "@/lib/template-engine/fix";
import type { TemplateManifest } from "@/lib/template-engine/types";

const severity = (r: HealthReport, id: string) => r.checks.find((c) => c.id === id)?.severity;

// ---------------------------------------------------------------------------
// Fixtures. A poison template: the demo business is named with an ordinary word
// ("Comfort", which appears in the ordinary-copy corpus), so demo_tokens_poison
// fails — and it is the ONLY failure, so it is cleanly fixable.
// ---------------------------------------------------------------------------

const CSS = `:root{ --primary:#1f6f5c; --primary-dark:#14503f; }
body{ color:#111; background:#fff; }
.btn{ background:var(--primary); color:#fff; }
.btn:hover{ background:var(--primary-dark); }`;

const poisonPage = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title} - Comfort Heating &amp; Air</title>
<link rel="stylesheet" href="style.css"></head>
<body>
  <header class="site-header">
    <a class="brand" href="index.html"><img src="images/logo.svg" alt="Comfort Heating &amp; Air"></a>
    <nav class="nav"><ul>
      <li><a href="index.html">Home</a></li>
      <li><a href="about.html">About</a></li>
    </ul></nav>
  </header>
  <main>${body}</main>
  <footer class="site-footer"><p>Comfort Heating &amp; Air, (720) 555-0199</p></footer>
</body>
</html>`;

const POISON_FILES: Record<string, string> = {
  "index.html": poisonPage("Home", `<h1>Furnace and AC work</h1><img src="images/hero.jpg" alt="A furnace">`),
  "about.html": poisonPage("About Us", `<h2>Our story</h2><img src="images/crew.jpg" alt="The crew">`),
  "style.css": CSS,
};

const MANIFEST = {
  pages: [
    { file: "index.html", title: "Home", kind: "home" },
    { file: "about.html", title: "About Us", kind: "about" },
  ],
  css: ["style.css"],
  js: [],
  components: null,
  assets: [],
  imageFiles: [],
  totalBytes: 2048,
} as unknown as TemplateManifest;

function healthOf(files: Record<string, string>): HealthReport {
  return runTemplateHealthChecks({
    files,
    demoTokens: extractDemoTokens(tokenFilesOf(files)),
    manifest: MANIFEST,
    now: "2026-01-01T00:00:00.000Z",
  });
}

// ---------------------------------------------------------------------------
// applyFixEdits — patch-apply-to-copy
// ---------------------------------------------------------------------------

describe("applyFixEdits", () => {
  it("applies a literal find/replace across all text files and reports the changes", () => {
    const { files, changes } = applyFixEdits(POISON_FILES, [{ find: "Comfort", replace: "Vantera" }]);
    expect(files["index.html"]).toContain("Vantera Heating");
    expect(files["index.html"]).not.toContain("Comfort");
    // style.css never contained "Comfort", so it is unchanged and not reported.
    expect(changes.map((c) => c.file).sort()).toEqual(["about.html", "index.html"]);
  });

  it("never mutates the input map", () => {
    const before = POISON_FILES["index.html"];
    applyFixEdits(POISON_FILES, [{ find: "Comfort", replace: "Vantera" }]);
    expect(POISON_FILES["index.html"]).toBe(before);
  });

  it("restricts a find/replace to one file when `file` is given", () => {
    const { files } = applyFixEdits(POISON_FILES, [{ file: "about.html", find: "Comfort", replace: "Vantera" }]);
    expect(files["about.html"]).not.toContain("Comfort");
    expect(files["index.html"]).toContain("Comfort");
  });

  it("appends only to an existing file, and never invents a file", () => {
    const { files, changes } = applyFixEdits(POISON_FILES, [
      { file: "style.css", append: "\n:root{ --brand:#2b6cb0; }" },
      { file: "does-not-exist.html", append: "<p>nope</p>" },
      { file: "nowhere.css", find: "x", replace: "y" },
    ]);
    expect(files["style.css"]).toContain("--brand:#2b6cb0");
    expect(files["does-not-exist.html"]).toBeUndefined();
    expect(changes.map((c) => c.file)).toEqual(["style.css"]);
  });

  it("uses literal (not regex) replacement, so $ and \\ in the replacement are inert", () => {
    const { files } = applyFixEdits({ "a.html": "<p>TOKEN</p>" }, [{ find: "TOKEN", replace: "$& \\1 price" }]);
    expect(files["a.html"]).toBe("<p>$& \\1 price</p>");
  });
});

// ---------------------------------------------------------------------------
// assessImprovement + blankedFiles — the apply gate
// ---------------------------------------------------------------------------

const report = (checks: { id: string; severity: "pass" | "info" | "warn" | "fail" }[]): HealthReport => ({
  status: "pass",
  checkedAt: "",
  checks: checks.map((c) => ({ id: c.id, label: c.id, severity: c.severity, detail: "", hint: "" })),
});

describe("assessImprovement", () => {
  it("is an improvement when a prior fail is resolved and no new fail appears", () => {
    const before = report([{ id: "demo_tokens_poison", severity: "fail" }, { id: "theme_applicable", severity: "warn" }]);
    const after = report([{ id: "demo_tokens_poison", severity: "pass" }, { id: "theme_applicable", severity: "warn" }]);
    const imp = assessImprovement(before, after);
    expect(imp.improved).toBe(true);
    expect(imp.resolvedFails).toEqual(["demo_tokens_poison"]);
    expect(imp.newFails).toEqual([]);
  });

  it("is NOT an improvement when the edit introduces a new fail", () => {
    const before = report([{ id: "demo_tokens_poison", severity: "fail" }, { id: "structure_parsable", severity: "pass" }]);
    const after = report([{ id: "demo_tokens_poison", severity: "pass" }, { id: "structure_parsable", severity: "fail" }]);
    const imp = assessImprovement(before, after);
    expect(imp.improved).toBe(false);
    expect(imp.newFails).toEqual(["structure_parsable"]);
  });

  it("is NOT an improvement when only a warn is resolved (no prior fail cleared)", () => {
    const before = report([{ id: "theme_applicable", severity: "warn" }, { id: "demo_tokens_poison", severity: "pass" }]);
    const after = report([{ id: "theme_applicable", severity: "pass" }, { id: "demo_tokens_poison", severity: "pass" }]);
    expect(assessImprovement(before, after).improved).toBe(false);
  });

  it("reports a severity regression even when a fail was also resolved", () => {
    const before = report([{ id: "demo_tokens_poison", severity: "fail" }, { id: "image_slots", severity: "pass" }]);
    const after = report([{ id: "demo_tokens_poison", severity: "pass" }, { id: "image_slots", severity: "warn" }]);
    const imp = assessImprovement(before, after);
    expect(imp.regressions).toContain("image_slots");
    expect(imp.improved).toBe(true); // fail resolved, no NEW fail — warn regression is surfaced, not blocking here
  });
});

describe("blankedFiles", () => {
  it("flags a file that went whitespace-only", () => {
    expect(blankedFiles({ "a.css": "body{}", "b.js": "x" }, { "a.css": "   ", "b.js": "x" })).toEqual(["a.css"]);
  });
  it("ignores a file that was already empty", () => {
    expect(blankedFiles({ "a.css": "" }, { "a.css": "" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assessFixability — what the feature declines
// ---------------------------------------------------------------------------

describe("assessFixability", () => {
  it("is fixable when the poison token is the failing check", () => {
    const f = assessFixability(healthOf(POISON_FILES));
    expect(f.fixable).toBe(true);
    expect(f.targets).toContain("demo_tokens_poison");
  });

  it("bundles theme in when it is also degraded", () => {
    // No usable colour variables and no non-neutral hex → theme warns.
    const files = { ...POISON_FILES, "style.css": `body{ color:#111; } .btn{ background:#222; }` };
    const f = assessFixability(healthOf(files));
    expect(f.fixable).toBe(true);
    expect(f.targets).toEqual(["demo_tokens_poison", "theme_applicable"]);
  });

  it("declines a template whose only failure is non-fixable (structure)", () => {
    const files = { "broken.html": "just words, no markup", "style.css": CSS };
    const before = runTemplateHealthChecks({ files, demoTokens: [], manifest: null });
    expect(before.status).toBe("fail");
    const f = assessFixability(before);
    expect(f.fixable).toBe(false);
    expect(f.reason).toContain("structure_parsable");
  });

  it("declines when there is no build-blocking failure at all (a theme warn alone)", () => {
    const clean = report([{ id: "demo_tokens_poison", severity: "pass" }, { id: "theme_applicable", severity: "warn" }]);
    const f = assessFixability(clean);
    expect(f.fixable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseFixProposal
// ---------------------------------------------------------------------------

describe("parseFixProposal", () => {
  it("parses a fenced JSON reply and keeps only valid edits", () => {
    const raw =
      "```json\n" +
      JSON.stringify({
        summary: "rename",
        edits: [
          { find: "Comfort", replace: "Vantera" },
          { file: "only-a-file.html" }, // no find/replace/append → dropped
          { file: "style.css", append: ":root{--brand:#2b6cb0;}" },
        ],
      }) +
      "\n```";
    const p = parseFixProposal(raw);
    expect(p?.summary).toBe("rename");
    expect(p?.edits).toHaveLength(2);
  });

  it("returns null when nothing usable is present", () => {
    expect(parseFixProposal("sorry, I can't help")).toBeNull();
    expect(parseFixProposal(JSON.stringify({ summary: "x", edits: [] }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// planTemplateFix — the whole flow, with a MOCKED model
// ---------------------------------------------------------------------------

describe("planTemplateFix (mocked model)", () => {
  const opts = { manifest: MANIFEST, now: "2026-01-01T00:00:00.000Z" as const };

  it("resolves the poison token and reports improved=true without writing anything", async () => {
    const callModel = vi.fn(async () =>
      JSON.stringify({ summary: "Renamed Comfort to Vantera", edits: [{ find: "Comfort", replace: "Vantera" }] })
    );
    const preview = await planTemplateFix({
      files: POISON_FILES,
      demoTokens: extractDemoTokens(tokenFilesOf(POISON_FILES)),
      callModel,
      ...opts,
    });

    expect(severity(preview.before, "demo_tokens_poison")).toBe("fail");
    expect(severity(preview.after, "demo_tokens_poison")).toBe("pass");
    expect(preview.improved).toBe(true);
    expect(preview.improvement.resolvedFails).toEqual(["demo_tokens_poison"]);
    // Only the two pages changed; the input is untouched (proof it patched a copy).
    expect(Object.keys(preview.proposedFiles).sort()).toEqual(["about.html", "index.html"]);
    expect(POISON_FILES["index.html"]).toContain("Comfort");
  });

  it("refuses (improved=false) when the edit would blank a file, even though the fail is resolved", async () => {
    const callModel = vi.fn(async () =>
      JSON.stringify({
        summary: "rename but nuke the stylesheet",
        edits: [
          { find: "Comfort", replace: "Vantera" },
          { file: "style.css", find: CSS, replace: "" },
        ],
      })
    );
    const preview = await planTemplateFix({
      files: POISON_FILES,
      demoTokens: extractDemoTokens(tokenFilesOf(POISON_FILES)),
      callModel,
      ...opts,
    });

    // The fail IS resolved on paper…
    expect(preview.improvement.improved).toBe(true);
    // …but the blank guard vetoes it, so the operator can never apply it.
    expect(preview.blanked).toContain("style.css");
    expect(preview.improved).toBe(false);
  });

  it("does not call the model for a non-fixable template", async () => {
    const callModel = vi.fn(async () => "{}");
    const preview = await planTemplateFix({
      files: { "broken.html": "no markup here", "style.css": CSS },
      demoTokens: [],
      callModel,
      manifest: null,
      now: opts.now,
    });
    expect(preview.fixable).toBe(false);
    expect(callModel).not.toHaveBeenCalled();
    expect(preview.reason).toContain("structure_parsable");
  });

  it("surfaces a reason when the model returns nothing usable", async () => {
    const callModel = vi.fn(async () => "I cannot do that");
    const preview = await planTemplateFix({
      files: POISON_FILES,
      demoTokens: extractDemoTokens(tokenFilesOf(POISON_FILES)),
      callModel,
      ...opts,
    });
    expect(preview.improved).toBe(false);
    expect(preview.reason).toMatch(/usable set of edits/);
  });
});
