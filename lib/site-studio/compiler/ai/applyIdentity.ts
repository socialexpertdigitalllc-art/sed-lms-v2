import type { CompiledTemplate } from "../../schema";
import { idToken } from "../../tokens";

export interface IdentityAddition { key: string; value: string }
export interface ApplyIdentityResult {
  template: CompiledTemplate;
  applied: IdentityAddition[];
  skipped: { key: string; value: string; reason: string }[];
}

const KEY_RE = /^[a-z][a-z0-9_]{1,30}$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Word-bounded global replace on a plain string (same lookaround rule the
 *  deterministic identity pass uses — boundaries judged on what surrounds the
 *  match, so names ending in punctuation still work). */
const replaceBounded = (text: string, value: string, token: string): { text: string; hits: number } => {
  const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(value)}(?![A-Za-z0-9])`, "g");
  let hits = 0;
  const out = text.replace(re, () => { hits++; return token; });
  return { text: out, hits };
};

/** HTML-entity-encode the plain-text form of a value (& < >). title_sample is
 *  captured decoded (.text) but slot samples are captured encoded
 *  (.innerHTML), so a value containing these characters tokenizes in one
 *  place and silently not the other unless both forms are matched. */
const encodeEntities = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Apply AI-proposed identity additions to a compiled package. PURE — deep
 * clones, never mutates the input. The caller re-runs verifyTemplate on the
 * result and reverts if the round-trip breaks; this function's own guards are
 * the cheap, obvious ones.
 */
export function applyIdentityAdditions(
  input: CompiledTemplate,
  additions: IdentityAddition[],
): ApplyIdentityResult {
  const template = structuredClone(input);
  const applied: IdentityAddition[] = [];
  const skipped: ApplyIdentityResult["skipped"] = [];

  // Longest value first: additions are applied sequentially against
  // already-mutated text, so a short value ("John") consuming its match
  // before a longer value that contains it ("John Carpenter") is even tried
  // would permanently bake the remainder ("Carpenter") into raw text.
  const ordered = [...additions].sort((a, b) => (b.value ?? "").length - (a.value ?? "").length);

  for (const raw of ordered) {
    const key = (raw.key ?? "").trim();
    const value = (raw.value ?? "").trim();
    const skip = (reason: string) => skipped.push({ key, value, reason });

    if (!KEY_RE.test(key)) { skip("invalid key"); continue; }
    if (key in template.manifest.identity) { skip("key already exists"); continue; }
    if (value.length < 3) { skip("value too short"); continue; }
    if (value.includes("{{") || value.includes("<!--")) { skip("value contains token syntax"); continue; }
    // an all-lowercase single word ("denver", "roofing") is far likelier to be
    // vocabulary or a path segment than identity — real names/places carry a
    // capital, a space, or a digit. AI must quote the VERBATIM casing.
    if (/^[a-z]+$/.test(value)) { skip("value too generic (all-lowercase word)"); continue; }
    if (Object.values(template.manifest.identity).some((v) => v === value)) { skip("value already tokenized"); continue; }

    const token = idToken(key);
    const encoded = encodeEntities(value);
    let hits = 0;
    const sub = (s: string): string => {
      const r = replaceBounded(s, value, token);
      hits += r.hits;
      let out = r.text;
      // also catch the value's HTML-entity-encoded form (slot samples are
      // captured via .innerHTML, title_sample via .text — see encodeEntities)
      if (encoded !== value) {
        const r2 = replaceBounded(out, encoded, token);
        hits += r2.hits;
        out = r2.text;
      }
      return out;
    };

    // hold results until we know the addition lands (hits > 0)
    const pages: Record<string, string> = {};
    for (const [f, html] of Object.entries(template.pages)) pages[f] = sub(html);
    const fragments: Record<string, string> = {};
    for (const [f, html] of Object.entries(template.fragments)) fragments[f] = sub(html);
    const manifest = structuredClone(template.manifest);
    for (const page of manifest.pages) {
      page.title_sample = sub(page.title_sample);
      // image slot samples are FILE PATHS, not prose — never substitute into
      // them, or an unrelated identity edit later silently breaks the asset
      // reference (the real file key never changes to match).
      for (const s of page.slots) { if (s.type === "image") continue; s.sample = sub(s.sample); }
      for (const rep of page.repeats) {
        const imageSlotIds = new Set(rep.slots.filter((s) => s.type === "image").map((s) => s.id));
        for (const s of rep.slots) { if (s.type === "image") continue; s.sample = sub(s.sample); }
        rep.samples = rep.samples.map((row) =>
          Object.fromEntries(Object.entries(row).map(([k, v]) => [k, imageSlotIds.has(k) ? v : sub(v)])));
      }
    }
    for (const region of manifest.nav) {
      if (region.items) for (const it of region.items) it.label = sub(it.label);
    }

    if (hits === 0) { skip("value not found in package"); continue; }

    template.pages = pages;
    template.fragments = fragments;
    template.manifest = manifest;
    template.manifest.identity[key] = value;
    applied.push({ key, value });
  }

  return { template, applied, skipped };
}
