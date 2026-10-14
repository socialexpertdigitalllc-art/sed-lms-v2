// @vitest-environment node
import { existsSync } from "fs";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "@playwright/test";
import { contrastGuardTag } from "@/lib/site-builder/contrastGuard";
import { logoStyleTag } from "@/lib/site-builder/finish";

/**
 * The contrast guard and the logo stylesheet, in a real browser — both depend
 * on layout and computed colours, which only a browser has. Skipped where no
 * Chromium is installed (`npx playwright install chromium`, or point
 * CHROMIUM_PATH at one).
 */

const executable = [
  process.env.CHROMIUM_PATH,
  chromium.executablePath(),
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium"),
].find((p): p is string => !!p && existsSync(p));

/** A 1×1 image: a stand-in photo, and a square logo. */
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
/** Another one — a logo placed under a URL that isn't the lead's. */
const OTHER_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 16px/1.4 sans-serif; background: #fff; color: #222; }
  section { padding: 24px; }
  .btn { display: inline-block; padding: 12px 20px; background: #f3e9d2; color: #fff; }
  .btn-hover { display: inline-block; padding: 12px 20px; background: #f3e9d2; color: #fff; }
  .btn-hover:hover { background: #111; }
  .dark { background: #111; } #dark-heading { color: #1a1a2e; }
  .light { background: #fff; }
  .ok { color: #333; }
  .brand { color: #0c5aa0; }
  .hero { position: relative; height: 260px; background: url(${PIXEL}) center / cover; }
  .hero h1 { color: #fff; margin: 0; }
  .floating { position: absolute; top: 0; left: 0; right: 0; } .floating a { color: #fff; }
  .gold { color: #d4af37; } .white-stars { color: #fff; }
  .num { font-size: 64px; color: #f1f1f1; }
  .grad { background: linear-gradient(#ffffff, #eeeeee); } .grad p { color: #fafafa; }
  .field { background: #fff; color: #fff; border: 1px solid #ccc; }
  .orange-cta { display: inline-block; padding: 12px; background: #ea580c; color: #ffffff; }
  /* A template fading into the site's theme as the page loads. */
  .fade { display: inline-block; padding: 12px; color: #fff; transition: background-color .4s linear; }
  #theme-in { background: #333; } .themed #theme-in { background: #f3e9d2; }
  #theme-out { background: #f5f5f5; } .themed #theme-out { background: #ea580c; }
</style></head><body>
  <section class="light"><a id="light-btn" class="btn" href="#">Get a free quote</a></section>
  <section id="dark" class="dark"><h2 id="dark-heading">Our services</h2></section>
  <section><p id="ok" class="ok">Plain readable body copy.</p><p id="brand" class="brand">A brand-blue link colour</p></section>
  <section class="hero"><header class="floating"><a id="floating-link" href="#">Home</a></header><h1 id="hero-title">Over the photo</h1></section>
  <section><span id="gold" class="gold">★★★★★</span> <span id="white-stars" class="white-stars">★★★★★</span></section>
  <section><span id="num" class="num">01</span></section>
  <section class="grad"><p id="grad-text">Pale text on a pale gradient</p></section>
  <section><input id="field" class="field" value="typed text"></section>
  <section><a id="orange" class="orange-cta" href="#">Call now</a></section>
  <section><a id="hover-btn" class="btn-hover" href="#">Book online</a></section>
  <section><a id="theme-in" class="fade" href="#">Request a quote</a> <a id="theme-out" class="fade" href="#">Call today</a></section>
  <script>
    document.addEventListener("DOMContentLoaded", function () {
      void document.body.offsetHeight;
      document.body.classList.add("themed");
    });
  </script>
  ${contrastGuardTag()}
</body></html>`;

const lum = (rgb: number[]) => {
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
};
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const rgb = (css: string) => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

describe.skipIf(!executable)("the contrast guard, in a real browser", () => {
  let browser: Browser;
  let page: Page;
  const colorOf = (id: string) => page.$eval(`#${id}`, (el) => getComputedStyle(el).color);
  const touched = (id: string) => page.$eval(`#${id}`, (el) => el.hasAttribute("data-sb-ink"));

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: executable });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(PAGE, { waitUntil: "load" });
    await page.waitForTimeout(900);
  }, 30_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("makes white text on a light button readable", async () => {
    expect(await touched("light-btn")).toBe(true);
    expect(ratio(rgb(await colorOf("light-btn")), [0xf3, 0xe9, 0xd2])).toBeGreaterThanOrEqual(4.5);
  });

  it("makes dark text on a dark section readable — not only buttons", async () => {
    expect(ratio(rgb(await colorOf("dark-heading")), [0x11, 0x11, 0x11])).toBeGreaterThanOrEqual(3);
  });

  it("fixes pale text on a pale gradient, and a white-on-white form field", async () => {
    expect(ratio(rgb(await colorOf("grad-text")), [0xf7, 0xf7, 0xf7])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(rgb(await colorOf("field")), [0xff, 0xff, 0xff])).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves readable text exactly as designed — body copy, brand links, white on orange", async () => {
    for (const id of ["ok", "brand", "orange"]) expect(await touched(id), id).toBe(false);
    expect(await colorOf("brand")).toBe("rgb(12, 90, 160)");
  });

  it("leaves text over a photo and inside a floating header alone — it can't know what's behind", async () => {
    expect(await touched("hero-title")).toBe(false);
    expect(await touched("floating-link")).toBe(false);
  });

  it("gold stars stay gold; invisible white stars are fixed; a faint watermark number is by design", async () => {
    expect(await touched("gold")).toBe(false);
    expect(await touched("white-stars")).toBe(true);
    expect(await touched("num")).toBe(false);
  });

  it("REGRESSION (Rosales, Danny Hiott): judges a button once its colours have settled, not mid-fade", async () => {
    // fading INTO a light background: caught once the fade ends
    expect(await touched("theme-in")).toBe(true);
    expect(ratio(rgb(await colorOf("theme-in")), [0xf3, 0xe9, 0xd2])).toBeGreaterThanOrEqual(4.5);
    // fading OUT of one: white on the final orange reads, so it stays white
    expect(await touched("theme-out")).toBe(false);
    expect(await colorOf("theme-out")).toBe("rgb(255, 255, 255)");
  });

  it("re-checks content added later, and restores its own change when the background no longer needs it", async () => {
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.id = "late-btn";
      a.className = "btn";
      a.textContent = "Added later";
      document.body.appendChild(a);
      document.getElementById("dark")!.className = "light";
    });
    await page.waitForTimeout(400);
    expect(await touched("late-btn")).toBe(true);
    // the section went light: the heading's own dark colour reads again
    expect(await touched("dark-heading")).toBe(false);
    expect(await colorOf("dark-heading")).toBe("rgb(26, 26, 46)");
  });

  it("re-checks a fixed button on hover, when its background turns dark under the fixed colour", async () => {
    expect(ratio(rgb(await colorOf("hover-btn")), [0xf3, 0xe9, 0xd2])).toBeGreaterThanOrEqual(4.5);
    await page.hover("#hover-btn");
    await page.waitForTimeout(600);
    expect(ratio(rgb(await colorOf("hover-btn")), [0x11, 0x11, 0x11])).toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(600);
    expect(ratio(rgb(await colorOf("hover-btn")), [0xf3, 0xe9, 0xd2])).toBeGreaterThanOrEqual(4.5);
  });
});

describe.skipIf(!executable)("the logo stylesheet, in a real browser", () => {
  let browser: Browser;
  const LOGO_PAGE = `<!DOCTYPE html><html><head><style>
    header { display: flex; align-items: center; height: 64px; padding: 0 16px; }
    .logo-mark { width: 40px; height: 40px; background: #c00; display: inline-flex; overflow: hidden; }
  </style>${logoStyleTag(PIXEL, "Acme Roofing")}</head><body>
    <header class="main-header"><a class="logo" href="#"><img id="head" src="${PIXEL}" alt="Acme Roofing" style="height:44px;width:auto;display:block"></a></header>
    <nav class="mobile-menu" id="mobileNav"><span class="logo-mark"><img id="mark" src="${PIXEL}" alt="Acme Roofing"></span></nav>
    <main><img id="about" src="${PIXEL}" alt="Acme Roofing" style="height:200px"><img id="photo" src="${PIXEL}" alt="crew at work" style="height:30px"></main>
    <footer><img id="foot" src="${OTHER_PIXEL}" alt="Acme Roofing" style="height:36px;width:auto"></footer>
  </body></html>`;
  const heights = async (width: number) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(LOGO_PAGE, { waitUntil: "load" });
    const h = await page.evaluate(() =>
      Object.fromEntries(["head", "mark", "about", "photo", "foot"].map((id) => [id, document.getElementById(id)!.getBoundingClientRect().height])),
    );
    await page.close();
    return h;
  };

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: executable });
  }, 30_000);
  afterAll(async () => {
    await browser?.close();
  });

  it("header logos 80px on desktop, footer 72px — over inline heights, by URL or by the business name", async () => {
    const h = await heights(1500);
    expect(h.head).toBe(80);
    expect(h.mark).toBe(80);
    expect(h.foot).toBe(72);
    // a logo used on purpose in the page, and other images, are left alone
    expect(h.about).toBe(200);
    expect(h.photo).toBe(30);
  });

  it("56px on a phone — still prominent, never shrunk to a favicon", async () => {
    const h = await heights(375);
    expect(h.head).toBe(56);
    expect(h.foot).toBe(56);
  });
});
