// lib/site-builder/siteTheme.ts
/**
 * Reading and setting a template's SITE THEME — the few base colour variables
 * a Site Builder template derives its whole palette from. In-service templates
 * mark them in the shared components file:
 *
 *   --green: #2f7d32;          /* PRIMARY — buttons, links, icons, highlights *\/
 *   --charcoal-deep: #1f1f1f;  /* DARK — top bar, header, footer backgrounds *\/
 *
 * The values are set in CODE from the lead's colour scheme (palette.ts), once
 * on the template's source before the AI rewrites the file — so the model sees
 * the real palette — and again on the AI's output, so whatever it wrote, the
 * site ships the scheme the lead asked for.
 */
import type { ThemeSlot } from "./palette";

const MARKED_LINE =
  /(--[A-Za-z0-9_-]+)(\s*:\s*)([^;\n]+?)(\s*;[ \t]*\/\*\s*(PRIMARY|SECONDARY|ACCENT|COMPLEMENTARY|DARK)\b[ \t]*[—–:-]*[ \t]*([^*\n]*?)\s*\*\/)/g;

/** The marked base variables, in file order (first occurrence of each name). */
export function parseThemeSlots(source: string): ThemeSlot[] {
  const slots: ThemeSlot[] = [];
  for (const m of source.matchAll(MARKED_LINE)) {
    if (slots.some((s) => s.name === m[1])) continue;
    slots.push({ name: m[1], marker: m[5] as ThemeSlot["marker"], role: m[6].trim(), value: m[3].trim() });
  }
  return slots;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The span of the SITE_THEME template literal, when the file has one. */
function themeBlock(source: string): { start: number; end: number } | null {
  const m = /SITE_THEME\s*=\s*`/.exec(source);
  if (!m) return null;
  const start = m.index + m[0].length;
  const end = source.indexOf("`", start);
  return end > start ? { start, end } : null;
}

/**
 * `source` with each named base variable set to its value. A marked line is
 * rewritten in place, keeping its comment. A variable the AI unmarked is found
 * by name inside the theme block; one it deleted is put back at the top of the
 * block's `:root {`. Idempotent.
 */
export function applyThemeValues(source: string, values: Record<string, string>, slots: ThemeSlot[]): string {
  let out = source;
  for (const [name, value] of Object.entries(values)) {
    const marked = new RegExp(`(?<![\\w-])(${escapeRe(name)})(\\s*:\\s*)([^;\\n]+?)(\\s*;[ \\t]*\\/\\*\\s*(?:PRIMARY|SECONDARY|ACCENT|COMPLEMENTARY|DARK)\\b)`);
    if (marked.test(out)) {
      out = out.replace(marked, (_m, n: string, sep: string, _old: string, rest: string) => `${n}${sep}${value}${rest}`);
      continue;
    }
    const block = themeBlock(out);
    if (!block) continue;
    const inner = out.slice(block.start, block.end);
    const plain = new RegExp(`(?<![\\w-])(${escapeRe(name)}\\s*:\\s*)([^;\\n]+)(;)`);
    if (plain.test(inner)) {
      out = out.slice(0, block.start) + inner.replace(plain, (_m, a: string, _old: string, c: string) => `${a}${value}${c}`) + out.slice(block.end);
      continue;
    }
    const root = /:root\s*\{/.exec(inner);
    if (!root) continue;
    const slot = slots.find((s) => s.name === name);
    const line = `\n  ${name}: ${value};${slot ? ` /* ${slot.marker} — ${slot.role} */` : ""}`;
    const at = block.start + root.index + root[0].length;
    out = out.slice(0, at) + line + out.slice(at);
  }
  return out;
}
