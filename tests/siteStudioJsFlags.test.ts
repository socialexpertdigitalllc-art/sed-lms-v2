import { describe, it, expect } from "vitest";
import { parse } from "node-html-parser";
import { flagJs } from "@/lib/site-studio/compiler/jsflags";
import { Inventory } from "@/lib/site-studio/compiler/inventory";

const enc = (s: string) => new TextEncoder().encode(s);
const inv = (html: string, assets: Record<string, string> = {}): Inventory => ({
  pages: [{ file: "index.html", id: "index", kind: "home", root: parse(html) }],
  assets: Object.fromEntries(Object.entries(assets).map(([k, v]) => [k, enc(v)])),
  diagnostics: [],
});

describe("flagJs", () => {
  it("flags DOM-writing inline scripts", () => {
    const d = flagJs(inv(`<body><script>document.getElementById("x").innerHTML = "<nav>...</nav>";</script></body>`), {});
    expect(d.some((x) => x.code === "js_renders_dom" && x.level === "warn")).toBe(true);
  });
  it("flags identity echoes inside js/css assets as a blocker (not a warning) — by the time this runs, compile.ts has already tokenized every occurrence it safely could, so anything still found here is a residual leak", () => {
    const d = flagJs(inv("<body></body>", { "app.js": `var phone = "(512) 555-0147";` }), { phone: "(512) 555-0147" });
    const diag = d.find((x) => x.code === "asset_identity_echo");
    expect(diag?.level).toBe("blocker");
    expect(diag?.message).not.toMatch(/Phase 2/);
    expect(diag?.message).toMatch(/app\.js/);
  });
  it("silent on clean templates", () => {
    expect(flagJs(inv("<body><p>Hi</p></body>", { "app.js": "console.log(1)" }), { phone: "(512) 555-0147" })).toEqual([]);
  });
  it("flags jQuery injection idioms in assets", () => {
    const d = flagJs(inv("<body></body>", { "app.js": `$("#menu").html(navHtml);` }), {});
    expect(d.some((x) => x.code === "js_renders_dom" && x.level === "warn")).toBe(true);
  });
  it("flags phone echoed with different separators via digit-normalized matching, as a blocker", () => {
    const d = flagJs(inv("<body></body>", { "app.js": `var p="512.555.0147";` }), { phone: "(512) 555-0147" });
    expect(d.some((x) => x.code === "asset_identity_echo" && x.level === "blocker")).toBe(true);
  });
  it("flags email echoed with different case, as a blocker", () => {
    const d = flagJs(inv("<body></body>", { "app.js": `var e="HELP@PLUMBERPRO.COM";` }), { email: "help@plumberpro.com" });
    expect(d.some((x) => x.code === "asset_identity_echo" && x.level === "blocker")).toBe(true);
  });
});
