import { describe, it, expect } from "vitest";
import {
  idToken, slotToken, imgToken, linkToken, TITLE_TOKEN, NAV_TITLE, NAV_HREF,
  repeatMarker, navMarker, findTokens, escapeHtml, sanitizeInline,
  escapeJsString, escapeCssString,
} from "@/lib/site-studio/tokens";

describe("token builders", () => {
  it("builds each token kind", () => {
    expect(idToken("phone")).toBe("{{id:phone}}");
    expect(slotToken("index_s1")).toBe("{{slot:index_s1}}");
    expect(imgToken("index_i1")).toBe("{{img:index_i1}}");
    expect(linkToken("about")).toBe("{{link:about}}");
    expect(TITLE_TOKEN).toBe("{{title}}");
    expect(repeatMarker("r1")).toBe("<!--@repeat:r1-->");
    expect(navMarker("n1")).toBe("<!--@nav:n1-->");
  });
});

describe("findTokens", () => {
  it("finds every token and marker in a string", () => {
    const html = `<a href="{{link:about}}">{{slot:s1}}</a>${navMarker("n1")}<title>${TITLE_TOKEN}</title>${NAV_TITLE}${NAV_HREF}`;
    const kinds = findTokens(html).map((t) => t.kind).sort();
    expect(kinds).toEqual(["link", "nav", "nav_href", "nav_title", "slot", "title"]);
  });
  it("returns empty for token-free html", () => {
    expect(findTokens("<p>plain</p><!-- normal comment -->")).toEqual([]);
  });
});

describe("escapeHtml", () => {
  it("escapes the five specials", () => {
    expect(escapeHtml(`<a b="c">&'`)).toBe("&lt;a b=&quot;c&quot;&gt;&amp;&#39;");
  });
});

describe("sanitizeInline", () => {
  it("keeps allowed inline tags, strips others", () => {
    expect(sanitizeInline("Fast <strong>same-day</strong> fix")).toBe("Fast <strong>same-day</strong> fix");
    expect(sanitizeInline(`Hi <script>x()</script><div>there</div>`)).toBe("Hi x()there");
  });
  it("neutralizes parser-differential payloads (malformed tags read as text)", () => {
    expect(sanitizeInline("<svg/onload=alert(1)>")).toBe("&lt;svg/onload=alert(1)&gt;");
    expect(sanitizeInline("<b/onmouseover=alert(1)>click</b>")).toBe("&lt;b/onmouseover=alert(1)&gt;click");
  });
  it("does not double-escape entities in legitimate text", () => {
    expect(sanitizeInline("Bread &amp; butter")).toBe("Bread &amp; butter");
  });
  it("keeps span and small as safe inline tags", () => {
    expect(sanitizeInline("Hi <span>there</span> <small>x</small>")).toBe("Hi <span>there</span> <small>x</small>");
  });
  it("strips attributes from inline tags even when the tag itself is allowed", () => {
    expect(sanitizeInline('<span onclick="x()">hi</span>')).toBe("<span>hi</span>");
  });
});

/**
 * Regression coverage for the asset-identity leak this pass closes: an
 * identity value (business name, phone, …) substituted unescaped into a
 * text asset (.js/.css) can corrupt the surrounding syntax outright rather
 * than just misrender — a JS/CSS syntax error breaks the ENTIRE deployed
 * site, not just one field. Each test below both checks the exact escaped
 * string AND proves the escaped output, dropped into a real string literal,
 * parses/evaluates without throwing.
 */
describe("escapeJsString", () => {
  it("escapes an apostrophe so it can't close a single-quoted string early", () => {
    const value = "Bob's Plumbing & Sons";
    expect(escapeJsString(value)).toBe("Bob\\'s Plumbing & Sons");
    // eslint-disable-next-line no-new-func
    const fn = new Function(`const NAME = '${escapeJsString(value)}'; return NAME;`);
    expect(fn()).toBe(value);
  });

  it("escapes a double quote so it can't close a double-quoted string early", () => {
    const value = `Joe's "The Best" Diner`;
    // eslint-disable-next-line no-new-func
    const fn = new Function(`const NAME = "${escapeJsString(value)}"; return NAME;`);
    expect(fn()).toBe(value);
  });

  it("escapes backslashes before quotes, and in the right order (backslash first)", () => {
    const value = `back\\slash then 'quote`;
    // eslint-disable-next-line no-new-func
    const fn = new Function(`const NAME = '${escapeJsString(value)}'; return NAME;`);
    expect(fn()).toBe(value);
  });

  it("escapes a backtick so it can't close a template literal early", () => {
    const value = "weird `backtick` name";
    // eslint-disable-next-line no-new-func
    const fn = new Function(`const NAME = \`${escapeJsString(value)}\`; return NAME;`);
    expect(fn()).toBe(value);
  });

  it("escapes a raw newline, which is a syntax error inside a JS string literal", () => {
    const value = "line one\nline two";
    // eslint-disable-next-line no-new-func
    const fn = new Function(`const NAME = '${escapeJsString(value)}'; return NAME;`);
    expect(fn()).toBe(value);
  });

  it("neutralizes </script> so an inlined value can't close a surrounding <script> tag", () => {
    expect(escapeJsString("</script><script>alert(1)</script>")).toBe(
      "<\\/script><script>alert(1)<\\/script>",
    );
  });

  it("escapes U+2028/U+2029, which are literal statement terminators even inside a JS string", () => {
    const value = `line one\u2028line two\u2029line three`;
    expect(escapeJsString(value)).toBe("line one\\u2028line two\\u2029line three");
    // eslint-disable-next-line no-new-func
    const fn = new Function(`const NAME = '${escapeJsString(value)}'; return NAME;`);
    expect(fn()).toBe(value);
  });

  it("a hostile value combining several of the above still round-trips through eval", () => {
    const value = `Bob's "Best" \\Plumbing\`s\u2028 & Sons\nInc.`;
    // eslint-disable-next-line no-new-func
    const fn = new Function(`const NAME = '${escapeJsString(value)}'; return NAME;`);
    expect(fn()).toBe(value);
  });
});

/**
 * Minimal CSS double-quoted-string-content parser, scoped to exactly the
 * escape forms `escapeCssString` produces (`\X` as a literal escaped
 * character, `\A ` as the CSS escape for a literal newline) — enough to
 * verify round-tripping without pulling in a full CSS parser dependency.
 */
function parseCssDqStringContent(escaped: string): string {
  let out = "";
  for (let i = 0; i < escaped.length; i++) {
    if (escaped[i] === "\\") {
      if (escaped[i + 1] === "A" && escaped[i + 2] === " ") { out += "\n"; i += 2; continue; }
      out += escaped[i + 1];
      i += 1;
      continue;
    }
    out += escaped[i];
  }
  return out;
}

describe("escapeCssString", () => {
  it("escapes an apostrophe so it can't close a single-quoted CSS string early", () => {
    const value = "Bob's Plumbing & Sons";
    expect(escapeCssString(value)).toBe("Bob\\'s Plumbing & Sons");
    expect(parseCssDqStringContent(escapeCssString(value))).toBe(value);
  });

  it("escapes both quote styles so a value can't close either single- or double-quoted CSS strings early", () => {
    const value = `Joe's "The Best" Diner`;
    const escaped = escapeCssString(value);
    expect(escaped).toBe(`Joe\\'s \\"The Best\\" Diner`);
    // wrapped in CSS double quotes, a real parser reading this string
    // literal recovers exactly the original value — the embedded quotes
    // never acted as delimiters
    expect(parseCssDqStringContent(escaped)).toBe(value);
  });

  it("escapes a backslash before quotes (backslash first, same as the JS escape)", () => {
    expect(escapeCssString(`back\\slash`)).toBe("back\\\\slash");
    expect(parseCssDqStringContent(escapeCssString(`back\\slash`))).toBe("back\\slash");
  });

  it("escapes a raw newline as the CSS \\A string-escape, which is invalid unescaped in a CSS string", () => {
    const value = "line one\nline two";
    expect(escapeCssString(value)).toBe("line one\\A line two");
    expect(parseCssDqStringContent(escapeCssString(value))).toBe(value);
  });

  it("a hostile value combining quotes, a backslash, and a newline round-trips through a CSS string", () => {
    const value = `Bob's "Best" \\Plumbing & Sons\nInc.`;
    const css = `.badge::before { content: "${escapeCssString(value)}"; }`;
    const contentMatch = css.match(/content: "([\s\S]*)"; \}$/);
    expect(contentMatch).not.toBeNull();
    expect(parseCssDqStringContent(contentMatch![1])).toBe(value);
  });
});
