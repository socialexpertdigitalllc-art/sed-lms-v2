import { describe, it, expect } from "vitest";
import { parseOps, applyOps, residualImageRefs } from "@/lib/template-engine/editOps";

describe("parseOps", () => {
  it("extracts ops from a ```json fenced block with surrounding prose", () => {
    const text = 'Here are the edits:\n```json\n{"ops":[{"find":"<h1>Old</h1>","replace":"<h1>New</h1>"}]}\n```\nDone!';
    expect(parseOps(text)).toEqual([{ find: "<h1>Old</h1>", replace: "<h1>New</h1>" }]);
  });

  it("accepts a bare array with prose before and junk after", () => {
    const text = 'Sure! Here you go: [{"find":"a","replace":"b"}] hope that helps';
    expect(parseOps(text)).toEqual([{ find: "a", replace: "b" }]);
  });

  it("returns [] for junk with no JSON", () => {
    expect(parseOps("I could not produce any edits, sorry.")).toEqual([]);
    expect(parseOps("")).toEqual([]);
  });

  it("drops entries lacking non-empty string find/replace and keeps file when present", () => {
    const text = JSON.stringify({
      ops: [
        { find: "", replace: "b" },
        { find: "a" },
        { replace: "b" },
        { find: 3, replace: "x" },
        "junk",
        42,
        { find: "a", replace: "c", file: "x.html" },
      ],
    });
    expect(parseOps(text)).toEqual([{ file: "x.html", find: "a", replace: "c" }]);
  });

  it("caps at 200 ops", () => {
    const big = JSON.stringify({ ops: Array.from({ length: 250 }, (_, i) => ({ find: `f${i}`, replace: `r${i}` })) });
    expect(parseOps(big)).toHaveLength(200);
  });
});

describe("applyOps", () => {
  it("applies an exact match (first occurrence only)", () => {
    const res = applyOps("x xylophone x", [{ find: "x", replace: "y" }]);
    expect(res.html).toBe("y xylophone x");
    expect(res.applied).toBe(1);
    expect(res.missed).toEqual([]);
  });

  it("falls back to a whitespace-normalized fuzzy match", () => {
    const html = "<div>\n    <h1>   Welcome    Home   </h1>\n</div>";
    const res = applyOps(html, [{ find: "<h1> Welcome Home </h1>", replace: "<h1>Hi</h1>" }]);
    expect(res.applied).toBe(1);
    expect(res.html).toBe("<div>\n    <h1>Hi</h1>\n</div>");
  });

  it("fuzzy match escapes regex specials in the find string", () => {
    const html = "<a href=\"x\">Call\n   (555) 123*456</a>";
    const res = applyOps(html, [{ find: "Call (555) 123*456", replace: "Call (999) 000-0000" }]);
    expect(res.applied).toBe(1);
    expect(res.html).toContain("(999) 000-0000");
  });

  it("reports misses without changing the html", () => {
    const res = applyOps("<p>hello</p>", [{ find: "<h2>nope</h2>", replace: "x" }]);
    expect(res.applied).toBe(0);
    expect(res.html).toBe("<p>hello</p>");
    expect(res.missed).toEqual([{ find: "<h2>nope</h2>", replace: "x" }]);
  });

  it("applies ops sequentially on the evolving html", () => {
    const res = applyOps("aaa", [
      { find: "aaa", replace: "bbb" },
      { find: "bbb", replace: "ccc" },
    ]);
    expect(res.html).toBe("ccc");
    expect(res.applied).toBe(2);
  });
});

describe("residualImageRefs", () => {
  it("flags leftover template image refs, ignoring http/data URLs and available images", () => {
    const files = {
      "index.html": [
        '<img src="images/old-hero.jpg" alt="">',
        '<img src="images/old-hero.jpg" alt="dup">',
        '<img src="https://cdn.example.com/x.png">',
        '<img src="data:image/png;base64,AAA=">',
        '<source src="images/gone.png">',
        '<img src="images/new.jpg">',
        '<a href="images/not-an-img-tag.jpg">x</a>',
        "<div style=\"background:url('images/bg-old.jpeg')\"></div>",
      ].join("\n"),
      "css/style.css": ".hero{background:url(../images/css-old.png)} .ok{background:url('images/new.jpg')} .ext{background:url(https://x.com/a.png)}",
      "js/main.js": 'const x = "images/not-scanned.png";',
    };
    const res = residualImageRefs(files, new Set(["new.jpg"]));
    expect(res.sort()).toEqual(
      [
        "index.html: images/old-hero.jpg",
        "index.html: images/gone.png",
        "index.html: images/bg-old.jpeg",
        "css/style.css: ../images/css-old.png",
      ].sort()
    );
  });

  it("ignores refs that are not image files", () => {
    const files = { "index.html": '<source src="video/clip.mp4"><img src="page.html">' };
    expect(residualImageRefs(files, new Set())).toEqual([]);
  });

  it("returns [] when everything is accounted for", () => {
    const files = {
      "index.html": '<img src="images/a.jpg">',
      "css/style.css": "b{background:url(images/b.png)}",
    };
    expect(residualImageRefs(files, new Set(["a.jpg", "b.png"]))).toEqual([]);
  });
});
