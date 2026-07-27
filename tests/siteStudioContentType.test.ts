import { describe, it, expect } from "vitest";
import { contentTypeFor } from "@/lib/site-studio/service/contentType";

describe("contentTypeFor", () => {
  it("maps common web types", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("css/style.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("img/a.jpg")).toBe("image/jpeg");
    expect(contentTypeFor("img/a.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("font.woff2")).toBe("font/woff2");
    expect(contentTypeFor("data.json")).toBe("application/json");
    expect(contentTypeFor("unknown.xyz")).toBe("application/octet-stream");
  });
});
