// @vitest-environment node
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { cleanLogo, flattenOnWhite } from "@/lib/logos/cleanup";
import { brandColors } from "@/lib/logos/brief";

/**
 * A drawn logo becomes a file a website can use: background gone (letter holes
 * too, so no white boxes on a dark header), soft edges with no white halo,
 * cropped with an even margin — and measured (horizontal? brand colours?).
 */

const W = 1536;
const H = 640;
const svg = (body: string, bg = "#ffffff") =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${bg}"/>${body}</svg>`);
// A navy ring (an "O": a hole in the middle) and an orange bar beside it.
const LOGO = `<circle cx="400" cy="320" r="100" fill="none" stroke="#1e3a8a" stroke-width="40"/><rect x="560" y="260" width="600" height="120" fill="#ea580c"/>`;

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  return { at, width: info.width, height: info.height };
}

describe("cleanLogo", () => {
  it("removes a white background (and the hole in the O), crops with a margin, keeps the artwork exact", async () => {
    const jpg = await sharp(svg(LOGO)).jpeg({ quality: 85 }).toBuffer();
    const r = await cleanLogo(jpg, brandColors("navy, orange, white"));
    expect(r).toMatchObject({ transparent: true, background: "removed", horizontal: true });
    // artwork spans x 280..1160, y 200..440 → about 880 × 240, plus the margin
    expect(r.width).toBeGreaterThan(880);
    expect(r.width).toBeLessThan(1000);
    expect(r.height).toBeGreaterThan(240);
    expect(r.height).toBeLessThan(320);
    expect(r.aspect).toBeGreaterThan(3);
    const p = await pixels(r.png);
    expect(p.at(0, 0)[3]).toBe(0); // corner: transparent
    const pad = Math.round((r.height - 240) / 2);
    expect(p.at(pad + 120, pad + 120)[3]).toBe(0); // the middle of the O: transparent
    const orange = p.at(pad + (860 - 280), pad + 120); // inside the bar (x 860 of the original)
    expect(orange[3]).toBe(255);
    expect(Math.abs(orange[0] - 0xea)).toBeLessThan(12);
    expect(r.colors.present).toEqual(["#1e3a8a", "#ea580c"]);
    expect(r.colors.offPalette).toBe(0);
  });

  it("an off-white, slightly blotchy background (how image models draw 'white') still comes off cleanly", async () => {
    const blotches = Array.from({ length: 40 }, (_, i) => `<rect x="${(i * 211) % 1400}" y="${(i * 97) % 560}" width="90" height="70" fill="#efefec"/>`).join("");
    const jpg = await sharp(svg(blotches + LOGO, "#fafaf7")).jpeg({ quality: 70 }).toBuffer();
    const r = await cleanLogo(jpg, brandColors("navy, orange"));
    expect(r.background).toBe("removed");
    expect(r.width).toBeLessThan(1000); // cropped to the artwork, not the whole picture
    expect(r.height).toBeLessThan(320);
    expect((await pixels(r.png)).at(2, 2)[3]).toBe(0);
  });

  it("smooth edges are un-mixed from the white: no light halo on a dark page", async () => {
    const r = await cleanLogo(await sharp(svg(`<circle cx="760" cy="320" r="150" fill="#1e3a8a"/>`)).png().toBuffer(), []);
    const { data, info } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
    let rim = 0;
    let light = 0;
    for (let i = 0; i < info.width * info.height * 4; i += 4) {
      const a = data[i + 3];
      if (a > 0 && a < 255) {
        rim++;
        if (data[i] > 120 && data[i + 1] > 120) light++; // a whitish edge pixel
      }
    }
    expect(rim).toBeGreaterThan(50);
    expect(light / rim).toBeLessThan(0.05);
  });

  it("missing brand colours and off-palette artwork are reported", async () => {
    const r = await cleanLogo(await sharp(svg(`<rect x="300" y="250" width="900" height="140" fill="#16a34a"/>`)).png().toBuffer(), brandColors("navy, orange"));
    expect(r.colors.present).toEqual([]);
    expect(r.colors.missing).toEqual(["#1e3a8a", "#ea580c"]);
    expect(r.colors.offPalette).toBeGreaterThan(0.9);
  });

  it("a square, stacked logo isn't horizontal", async () => {
    const r = await cleanLogo(await sharp(svg(`<rect x="600" y="120" width="300" height="400" fill="#1e3a8a"/>`)).png().toBuffer(), []);
    expect(r.horizontal).toBe(false);
  });

  it("a dark or busy background is left as drawn", async () => {
    const dark = await cleanLogo(await sharp(svg(LOGO, "#0f172a")).png().toBuffer(), []);
    expect(dark).toMatchObject({ transparent: false, background: "dark", width: W, height: H });
    const busy = await cleanLogo(
      await sharp(svg(`${LOGO}<rect x="0" y="0" width="${W}" height="${H / 2}" fill="#ef4444"/>`)).png().toBuffer(),
      [],
    );
    expect(busy).toMatchObject({ transparent: false, background: "busy" });
  });

  it("a blank picture is an error", async () => {
    await expect(cleanLogo(await sharp(svg("")).png().toBuffer(), [])).rejects.toThrow(/blank/);
  });

  it("flattenOnWhite: the same logo on solid white", async () => {
    const r = await cleanLogo(await sharp(svg(LOGO)).png().toBuffer(), []);
    const flat = await pixels(await flattenOnWhite(r.png));
    expect(flat.at(0, 0)).toEqual([255, 255, 255, 255]);
  });
});
