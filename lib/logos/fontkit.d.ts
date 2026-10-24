/** The small part of fontkit (no bundled types) the logo typesetter uses. */
declare module "fontkit" {
  export interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }
  export interface Path {
    toSVG(): string;
    scale(sx: number, sy?: number): Path;
    translate(x: number, y: number): Path;
    readonly bbox: BBox;
  }
  export interface Glyph {
    id: number;
    path: Path;
    advanceWidth: number;
    /** The characters this glyph draws (two or more for a ligature). */
    codePoints: number[];
  }
  export interface GlyphPosition {
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
  }
  export interface GlyphRun {
    glyphs: Glyph[];
    positions: GlyphPosition[];
  }
  export interface Font {
    unitsPerEm: number;
    ascent: number;
    descent: number;
    capHeight: number;
    familyName: string;
    layout(text: string, features?: string[] | Record<string, boolean>): GlyphRun;
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  export function create(buffer: Buffer | Uint8Array, postscriptName?: string): Font;
}
