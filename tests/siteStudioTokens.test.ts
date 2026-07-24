import { describe, it, expect } from "vitest";
import {
  idToken, slotToken, imgToken, linkToken, TITLE_TOKEN, NAV_TITLE, NAV_HREF,
  repeatMarker, navMarker, findTokens, escapeHtml, sanitizeInline,
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
});
