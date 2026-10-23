import { contrast, deepenFor } from "@/lib/site-builder/palette";
import { normalizeHex } from "@/lib/leads/colorScheme";
import { loadSharp } from "./cleanup";
import { fontInfo } from "./fontList";
import { applyCase, fallbackFonts, fontsFor, missingChars, setText, type SetText } from "./typeset";
import type { BadgeShape, LetterCase, LogoLayout } from "./design";

/**
 * A horizontal logo, put together in code: the symbol (drawn by the image
 * model, background removed) or a badge with the initials, beside the
 * business name typeset in a real font. Spacing, sizes and alignment follow
 * the usual lockup proportions. The name is outlines from the font file, so
 * it is always spelled exactly right and every letter is properly formed.
 */


export interface LockupInput {
  layout: LogoLayout;
  /** One or two lines that together are exactly the words on the logo. */
  lines: string[];
  font: string;
  letterCase: LetterCase;
  /** Extra letter spacing on the main line, in ems (0–0.3). */
  tracking: number;
  nameColor: string;
  subColor: string;
  /** One line only: the first word in nameColor, the rest in subColor. */
  twoTone: boolean;
  /** The symbol (transparent PNG, cropped to the artwork). */
  icon?: { png: Buffer; width: number; height: number } | null;
  /** Symbol size relative to the standard (0.7–1.4). */
  iconScale?: number;
  badge?: { shape: BadgeShape; color: string; initials: string } | null;
}

export interface Lockup {
  png: Buffer;
  svg: string;
  width: number;
  height: number;
}

const MAIN_SIZE = 200;
const STOP_WORDS = new Set(["and", "&", "the", "of", "llc", "inc", "co", "co.", "a"]);

/** "Garcia's Roofing & Repair" → "GR". PURE. */
export function initialsFor(text: string): string {
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
  if (!words.length) return (text.trim()[0] ?? "").toUpperCase();
  return words
    .slice(0, words.length === 1 ? 1 : 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/** A colour that reads on white (light ones are deepened). PURE. */
export function inkOnWhite(hex: string, fallback = "#111827"): string {
  const h = normalizeHex(hex) ?? fallback;
  return contrast(h, "#ffffff") >= 2.4 ? h : deepenFor(h, 3);
}

/** White on any fill it reads on (as a designer would), else near-black. PURE. */
export function textOn(fill: string): string {
  return contrast("#ffffff", fill) >= 2.2 ? "#ffffff" : "#111827";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function badgeShape(shape: BadgeShape, x: number, y: number, s: number, fill: string): string {
  const f = esc(fill);
  if (shape === "circle") return `<circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s / 2}" fill="${f}"/>`;
  if (shape === "rounded") return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.22}" fill="${f}"/>`;
  if (shape === "hexagon") {
    const cx = x + s / 2;
    const cy = y + s / 2;
    const r = s / 2;
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    });
    return `<polygon points="${pts.join(" ")}" fill="${f}"/>`;
  }
  // shield
  const w = s * 0.86;
  const x0 = x + (s - w) / 2;
  return `<path d="M${x0} ${y}H${x0 + w}V${y + s * 0.5}C${x0 + w} ${y + s * 0.78} ${x0 + w * 0.72} ${y + s * 0.92} ${x0 + w / 2} ${y + s}C${x0 + w * 0.28} ${y + s * 0.92} ${x0} ${y + s * 0.78} ${x0} ${y + s * 0.5}Z" fill="${f}"/>`;
}

type Piece = { d: string; color: string; set: SetText; dx: number; dy: number };

/** Build the lockup's SVG (and its size). PURE apart from reading font files. */
export async function lockupSvg(input: LockupInput): Promise<{ svg: string; width: number; height: number }> {
  const info = fontInfo(input.font);
  const faces = await fontsFor(info.key);
  const fallback = await fallbackFonts();
  const letterCase: LetterCase = info.capsOnly ? "upper" : input.letterCase;
  const tracking = info.script ? 0 : Math.max(0, Math.min(0.3, input.tracking || 0));
  const nameColor = inkOnWhite(input.nameColor);
  const subColor = inkOnWhite(input.subColor, nameColor);
  const lines = input.lines.filter((l) => l.trim()).slice(0, 2);
  const line1Text = applyCase(lines[0] ?? "", letterCase);
  const line2Text = lines[1] ? applyCase(lines[1], info.script ? "as-is" : "upper") : "";

  // Line 1 (two-tone splits it into the first word and the rest).
  const mainFace = missingChars(faces.main, line1Text).length ? fallback.main : faces.main;
  const pieces: Piece[] = [];
  const firstSpace = line1Text.indexOf(" ");
  if (input.twoTone && !line2Text && firstSpace > 0) {
    const a = setText(mainFace, line1Text.slice(0, firstSpace + 1), MAIN_SIZE, tracking);
    const b = setText(mainFace, line1Text.slice(firstSpace + 1), MAIN_SIZE, tracking, a.width + tracking * MAIN_SIZE);
    pieces.push({ d: a.d, color: nameColor, set: a, dx: 0, dy: 0 }, { d: b.d, color: subColor, set: b, dx: 0, dy: 0 });
  } else {
    const a = setText(mainFace, line1Text, MAIN_SIZE, tracking);
    pieces.push({ d: a.d, color: nameColor, set: a, dx: 0, dy: 0 });
  }
  const l1 = {
    top: Math.min(...pieces.map((p) => p.set.inkTop)),
    bottom: Math.max(...pieces.map((p) => p.set.inkBottom)),
    left: Math.min(...pieces.map((p) => p.set.inkLeft)),
    right: Math.max(...pieces.map((p) => p.set.inkRight)),
    cap: pieces[0].set.capHeight,
  };

  // Line 2: smaller, spaced capitals in the companion face, never wider than line 1 unless it must be.
  let block = { top: l1.top, bottom: Math.max(l1.bottom, 0), left: l1.left, right: l1.right };
  if (line2Text) {
    const face = missingChars(faces.companion, line2Text).length ? fallback.companion : faces.companion;
    const subTracking = info.script ? 0.06 : 0.16;
    let size = MAIN_SIZE * 0.36;
    let s2 = setText(face, line2Text, size, subTracking);
    const width1 = l1.right - l1.left;
    const width2 = s2.inkRight - s2.inkLeft;
    if (width2 > width1 && width1 > 0) {
      size = Math.max(MAIN_SIZE * 0.22, size * (width1 / width2));
      s2 = setText(face, line2Text, size, subTracking);
    }
    const baseline2 = Math.max(l1.bottom, 0) + MAIN_SIZE * 0.17 + s2.capHeight;
    const dx = input.layout === "wordmark" ? (l1.left + l1.right) / 2 - (s2.inkLeft + s2.inkRight) / 2 : l1.left - s2.inkLeft;
    pieces.push({ d: s2.d, color: subColor, set: s2, dx, dy: baseline2 });
    block = {
      top: l1.top,
      bottom: Math.max(l1.bottom, baseline2 + s2.inkBottom),
      left: Math.min(l1.left, s2.inkLeft + dx),
      right: Math.max(l1.right, s2.inkRight + dx),
    };
  }

  // The symbol or badge, to the left, sized to the name.
  const scale = Math.max(0.7, Math.min(1.4, input.iconScale ?? 1));
  const markHeight = (line2Text ? (block.bottom - block.top) * 1.12 : l1.cap * 2.5) * scale;
  const centreY = line2Text ? (block.top + block.bottom) / 2 : (l1.top + 0) / 2;
  const parts: string[] = [];
  let minX = block.left;
  let minY = block.top;
  let maxY = block.bottom;

  if (input.layout === "icon-left" && input.icon) {
    let h = markHeight;
    let w = h * (input.icon.width / input.icon.height);
    if (w > h * 1.8) {
      w = h * 1.8;
      h = w / (input.icon.width / input.icon.height);
    }
    const x = block.left - w - h * 0.3;
    const y = centreY - h / 2;
    parts.push(`<image x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" preserveAspectRatio="none" xlink:href="data:image/png;base64,${input.icon.png.toString("base64")}"/>`);
    minX = x;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + h);
  } else if (input.layout === "badge-left" && input.badge) {
    const s = markHeight;
    const x = block.left - s - s * 0.26;
    const y = centreY - s / 2;
    parts.push(badgeShape(input.badge.shape, x, y, s, input.badge.color));
    const initials = applyCase(input.badge.initials || "?", "upper");
    const face = missingChars(faces.main, initials).length ? fallback.main : faces.main;
    let size = (s * 0.42) / (face.capHeight / face.unitsPerEm);
    let t = setText(face, initials, size, 0.02);
    const maxW = s * (input.badge.shape === "shield" ? 0.5 : 0.6);
    if (t.inkRight - t.inkLeft > maxW) {
      size *= maxW / (t.inkRight - t.inkLeft);
      t = setText(face, initials, size, 0.02);
    }
    const cx = x + s / 2;
    const cy = y + s * (input.badge.shape === "shield" ? 0.46 : 0.5);
    const tx = cx - (t.inkLeft + t.inkRight) / 2;
    const ty = cy - (t.inkTop + t.inkBottom) / 2;
    parts.push(`<path transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)})" d="${t.d}" fill="${esc(textOn(input.badge.color))}"/>`);
    minX = x;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + s);
  }

  for (const p of pieces) {
    parts.push(`<path transform="translate(${p.dx.toFixed(2)} ${p.dy.toFixed(2)})" d="${p.d}" fill="${esc(p.color)}"/>`);
  }

  const maxX = block.right;
  const pad = (maxY - minY) * 0.1;
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const k = Math.min(2, 2400 / width);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.round(width * k)}" height="${Math.round(height * k)}" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}">` +
    `<g transform="translate(${(pad - minX).toFixed(2)} ${(pad - minY).toFixed(2)})">${parts.join("")}</g></svg>`;
  return { svg, width: Math.round(width * k), height: Math.round(height * k) };
}

/** The lockup as a transparent PNG. */
export async function composeLockup(input: LockupInput): Promise<Lockup> {
  const { svg, width, height } = await lockupSvg(input);
  const sharp = await loadSharp();
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  return { png, svg, width, height };
}
