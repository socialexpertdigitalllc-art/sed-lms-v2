import { colorDistance, luminance, rgbToHex } from "@/lib/site-builder/palette";
import { isInk, type BrandColor } from "./brief";

/**
 * Turn a drawn logo (a wide picture on a plain light background) into a logo
 * file a website can use: background removed (a transparent PNG), cropped to
 * the artwork with an even margin. Also measures it — is it horizontal, and is
 * it in the lead's colours — so the best designs can be shown first.
 *
 * Background removal, for a picture on a plain light background:
 *  - every pixel close to the background colour becomes transparent — the
 *    surrounding background AND the holes inside letters (the inside of an
 *    "O"), which would otherwise show as white boxes on a dark header;
 *  - the 2-pixel rim of the artwork is "un-mixed" from the background
 *    (colour-to-alpha), so the edges stay smooth with no white halo;
 *  - everything else is kept exactly.
 * A white detail drawn INSIDE a shape goes transparent too — so Accept also
 * offers the logo on a white background (flattenOnWhite).
 *
 * A picture whose background isn't plain, or is dark, is left as drawn (and
 * ranked lower: the prompt asks for plain white).
 */

/** At most this far from the background colour (0–255, any channel) = background. */
const BG_TOLERANCE = 26;
/** Border pixels that must match the background for it to count as plain. */
const PLAIN_SHARE = 0.92;
/** The artwork's rim that is un-mixed from the background. */
const RIM_PX = 2;
/** Pixels at least this opaque decide the crop. */
const CROP_ALPHA = 40;
/** Wider than tall by at least this = horizontal. */
export const HORIZONTAL_MIN = 1.7;

export interface ColorReport {
  /** Brand colours clearly present (hex). */
  present: string[];
  /** Brand ink colours not found. */
  missing: string[];
  /** Share of the artwork in colours that are none of the brand's (0–1; greys and black excluded). */
  offPalette: number;
  /** The artwork's main colours (hex, most used first). */
  dominant: string[];
}

export interface CleanLogo {
  png: Buffer;
  width: number;
  height: number;
  /** Width ÷ height of the artwork. */
  aspect: number;
  horizontal: boolean;
  /** The background was plain and light, and was removed. */
  transparent: boolean;
  /** Why it wasn't, when it wasn't. */
  background: "removed" | "busy" | "dark";
  colors: ColorReport;
}

const maxDiff = (d: Buffer | Uint8Array, i: number, b: [number, number, number]) =>
  Math.max(Math.abs(d[i] - b[0]), Math.abs(d[i + 1] - b[1]), Math.abs(d[i + 2] - b[2]));

/** The border's colour and whether the border is (almost) all that colour. PURE. */
export function borderBackground(data: Uint8Array, width: number, height: number): { color: [number, number, number]; plain: boolean } {
  const samples: number[] = [];
  const push = (x: number, y: number) => samples.push((y * width + x) * 4);
  for (let x = 0; x < width; x += 2) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 2) {
    push(0, y);
    push(width - 1, y);
  }
  const median = (k: number) => {
    const v = samples.map((i) => data[i + k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const color: [number, number, number] = [median(0), median(1), median(2)];
  const matching = samples.filter((i) => maxDiff(data, i, color) <= BG_TOLERANCE).length;
  return { color, plain: matching / samples.length >= PLAIN_SHARE };
}

/** Colour-to-alpha against a background colour, in place on one RGBA pixel. */
function unmix(d: Uint8Array, i: number, b: [number, number, number]) {
  let a = 0;
  for (let k = 0; k < 3; k++) {
    const c = d[i + k];
    const bg = b[k];
    const ak = c > bg ? (c - bg) / (255 - bg || 1) : c < bg ? (bg - c) / (bg || 1) : 0;
    if (ak > a) a = ak;
  }
  if (a <= 0.004) {
    d[i + 3] = 0;
    return;
  }
  for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, Math.round((d[i + k] - b[k]) / a + b[k])));
  d[i + 3] = Math.round(a * 255);
}

/**
 * Remove the background in place. Returns the mask of the artwork's solid
 * interior (not background, not rim) for colour measuring. PURE (on the buffer).
 */
export function removeBackground(data: Uint8Array, width: number, height: number, bg: [number, number, number]): Uint8Array {
  const n = width * height;
  // 0 = artwork, 1 = background, 2 = rim
  const kind = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (maxDiff(data, p * 4, bg) <= BG_TOLERANCE) kind[p] = 1;
  // The rim: artwork pixels within RIM_PX of the background.
  let frontier: number[] = [];
  for (let p = 0; p < n; p++) if (kind[p] === 1) frontier.push(p);
  for (let step = 0; step < RIM_PX; step++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (kind[q] === 0) {
            kind[q] = 2;
            next.push(q);
          }
        }
      }
    }
    frontier = next;
  }
  const solid = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (kind[p] === 1) {
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
    } else if (kind[p] === 2) {
      unmix(data, i, bg);
    } else {
      solid[p] = 1;
    }
  }
  return solid;
}

/** The crop box of everything at least CROP_ALPHA opaque, or null for an empty picture. PURE. */
export function artworkBox(data: Uint8Array, width: number, height: number): { left: number; top: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < CROP_ALPHA) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** How the artwork's colours compare with the brand's. PURE. */
export function measureColors(data: Uint8Array, mask: Uint8Array, brand: BrandColor[]): ColorReport {
  // Count in a 4-bit-per-channel grid, then compare each bin once.
  const bins = new Map<number, number>();
  let total = 0;
  for (let p = 0; p < mask.length; p += 2) {
    if (!mask[p]) continue;
    const i = p * 4;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    bins.set(key, (bins.get(key) ?? 0) + 1);
    total++;
  }
  const binHex = (key: number) => rgbToHex([((key >> 8) & 15) * 17, ((key >> 4) & 15) * 17, (key & 15) * 17]);
  const ink = brand.filter((c) => c.role !== "light");
  const hits = new Map<string, number>();
  let off = 0;
  let chromatic = 0;
  const groups: { hex: string; count: number }[] = [];
  for (const [key, count] of bins) {
    const hex = binHex(key);
    let best: string | null = null;
    let bestD = 0.14;
    for (const c of ink) {
      const d = colorDistance(hex, c.hex);
      if (d < bestD) {
        bestD = d;
        best = c.hex;
      }
    }
    if (best) hits.set(best, (hits.get(best) ?? 0) + count);
    if (isInk(hex)) {
      chromatic += count;
      if (!best && luminance(hex) > 0.06) off += count;
    }
    const near = groups.find((g) => colorDistance(g.hex, hex) < 0.08);
    if (near) near.count += count;
    else groups.push({ hex, count });
  }
  const present = ink.filter((c) => (hits.get(c.hex) ?? 0) / Math.max(1, total) >= 0.02).map((c) => c.hex);
  return {
    present,
    missing: ink.map((c) => c.hex).filter((h) => !present.includes(h)),
    offPalette: chromatic ? Math.round((off / chromatic) * 100) / 100 : 0,
    dominant: groups
      .sort((a, b) => b.count - a.count)
      .filter((g) => g.count / Math.max(1, total) >= 0.03)
      .slice(0, 4)
      .map((g) => g.hex),
  };
}

type Sharp = typeof import("sharp");
export async function loadSharp(): Promise<Sharp> {
  const mod = await import("sharp");
  return ((mod as unknown as { default?: Sharp }).default ?? mod) as Sharp;
}

/** Clean one drawn logo. Throws on an unreadable or empty picture. */
export async function cleanLogo(input: Buffer, brand: BrandColor[]): Promise<CleanLogo> {
  const sharp = await loadSharp();
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const px = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const bg = borderBackground(px, width, height);
  const light = luminance(rgbToHex(bg.color)) >= 0.75;
  const background: CleanLogo["background"] = !bg.plain ? "busy" : !light ? "dark" : "removed";

  let mask: Uint8Array;
  let box: { left: number; top: number; width: number; height: number };
  if (background === "removed") {
    mask = removeBackground(px, width, height, bg.color);
    const found = artworkBox(px, width, height);
    if (!found) throw new Error("The picture came back blank.");
    box = found;
  } else {
    // Kept as drawn: measure everything that isn't the border colour.
    mask = new Uint8Array(width * height);
    for (let p = 0; p < mask.length; p++) if (maxDiff(px, p * 4, bg.color) > BG_TOLERANCE) mask[p] = 1;
    box = { left: 0, top: 0, width, height };
  }

  const colors = measureColors(px, mask, brand);
  const pad = background === "removed" ? Math.max(16, Math.round(Math.min(box.height, box.width) * 0.12)) : 0;
  const png = await sharp(Buffer.from(px.buffer, px.byteOffset, px.byteLength), { raw: { width, height, channels: 4 } })
    .extract(box)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  const aspect = Math.round((box.width / box.height) * 100) / 100;
  return {
    png,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
    aspect,
    horizontal: aspect >= HORIZONTAL_MIN,
    transparent: background === "removed",
    background,
    colors,
  };
}

/** The same logo on solid white (for Accept → "White background"). */
export async function flattenOnWhite(png: Buffer): Promise<Buffer> {
  const sharp = await loadSharp();
  return sharp(png).flatten({ background: "#ffffff" }).png({ compressionLevel: 9 }).toBuffer();
}
