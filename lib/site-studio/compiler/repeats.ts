import { HTMLElement, NodeType } from "node-html-parser";
import { Diagnostic, RepeatDef, SlotDef } from "../schema";
import { repeatMarker, slotToken } from "../tokens";
import { PageSource } from "./inventory";
import { isSlottableLeaf } from "./slots";

const signature = (el: HTMLElement) =>
  `${el.rawTagName?.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).sort().join(".")}`;

const elementChildren = (el: HTMLElement): HTMLElement[] =>
  el.childNodes.filter((n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE);

function congruent(a: HTMLElement, b: HTMLElement): boolean {
  if (a.rawTagName?.toLowerCase() !== b.rawTagName?.toLowerCase()) return false;
  const ac = elementChildren(a);
  const bc = elementChildren(b);
  if (ac.length !== bc.length) return false;
  return ac.every((child, i) => congruent(child, bc[i]));
}

/**
 * Walk `ref` (always kids[0]'s subtree — the position that decides slot-hood)
 * and `inst` (the same structural position in another instance) in lockstep.
 * Slot-worthiness (isSlottableLeaf) is always decided against `ref`, so an
 * instance whose own text is short (or empty) still yields a sample at that
 * position instead of a missing key. Returns null if the two subtrees
 * diverge structurally — shouldn't happen once congruent() has passed, but
 * this is the conservative safety net the caller falls back on.
 */
function lockstepLeaves(ref: HTMLElement, inst: HTMLElement): HTMLElement[] | null {
  const own = isSlottableLeaf(ref) ? [inst] : [];
  const refKids = elementChildren(ref);
  const instKids = elementChildren(inst);
  if (refKids.length !== instKids.length) return null;
  const nested: HTMLElement[] = [];
  for (let i = 0; i < refKids.length; i++) {
    const sub = lockstepLeaves(refKids[i], instKids[i]);
    if (!sub) return null;
    nested.push(...sub);
  }
  return [...own, ...nested];
}

/** Pass 3b: runs of ≥3 congruent siblings with slottable content → repeat regions. */
export function extractRepeats(page: PageSource): { repeats: RepeatDef[]; fragments: Record<string, string>; diagnostics: Diagnostic[] } {
  const repeats: RepeatDef[] = [];
  const fragments: Record<string, string> = {};
  const diagnostics: Diagnostic[] = [];
  let rn = 0;

  for (const parent of page.root.querySelectorAll("*")) {
    const kids = elementChildren(parent);
    if (kids.length < 3) continue;
    const sig = signature(kids[0]);
    if (!kids.every((k) => signature(k) === sig)) continue;
    if (!kids.every((k) => congruent(k, kids[0]))) {
      diagnostics.push({
        level: "warn",
        code: "repeat_congruence_failed",
        page: page.file,
        message: `A run of ${kids.length} same-signature "${sig}" siblings was not structurally congruent — left as flat content`,
      });
      continue;
    }

    // Resolve every instance's leaves in lockstep with kids[0] (slots decided
    // once, from kids[0]). Bail conservatively if a position can't resolve.
    const perInstance: HTMLElement[][] = [];
    let resolvedOk = true;
    for (const inst of kids) {
      const instLeaves = lockstepLeaves(kids[0], inst);
      if (!instLeaves) { resolvedOk = false; break; }
      perInstance.push(instLeaves);
    }
    if (!resolvedOk) {
      diagnostics.push({
        level: "warn",
        code: "repeat_congruence_failed",
        page: page.file,
        message: `A run of ${kids.length} same-signature "${sig}" siblings could not be resolved leaf-for-leaf — left as flat content`,
      });
      continue;
    }

    const firstLeaves = perInstance[0];
    if (firstLeaves.length === 0) continue;

    const id = `${page.id}_r${++rn}`;
    const slots: SlotDef[] = [];
    const samples: Record<string, string>[] = [];

    // samples first, from each instance's leaves as resolved above (pre-tokenization)
    for (const instLeaves of perInstance) {
      const row: Record<string, string> = {};
      instLeaves.forEach((leaf, i) => { row[`${id}_s${i + 1}`] = leaf.innerHTML.trim(); });
      samples.push(row);
    }
    // slot metadata + tokenization from the first instance only
    firstLeaves.forEach((leaf, i) => {
      const sid = `${id}_s${i + 1}`;
      const sample = leaf.innerHTML.trim();
      const plain = leaf.text.trim();
      slots.push({ id: sid, type: "text", sample, html: sample !== plain, max_chars: Math.max(40, Math.ceil(plain.length * 1.5)) });
      leaf.set_content(slotToken(sid));
    });
    fragments[id] = kids[0].toString();

    kids[0].replaceWith(repeatMarker(id));
    for (const extra of kids.slice(1)) extra.remove();
    repeats.push({ id, fragment: id, min: 1, max: Math.max(12, kids.length), slots, samples });
  }

  // The querySelectorAll("*") snapshot was taken before any mutation, so the
  // loop above can still visit elements whose subtree was already consumed
  // (removed as an extra instance, or tokenized as a survivor) by an outer
  // match. Those produce a RepeatDef whose marker was written into a subtree
  // that's now detached from the page — a phantom that would render as a
  // silent no-op and an orphaned manifest entry. Drop them here.
  const html = page.root.toString();
  const kept: RepeatDef[] = [];
  for (const r of repeats) {
    if (html.includes(repeatMarker(r.id))) {
      kept.push(r);
    } else {
      delete fragments[r.fragment];
      diagnostics.push({
        level: "info",
        code: "repeat_dropped_orphan",
        page: page.file,
        message: `Repeat region "${r.id}" was nested inside content already consumed by another repeat and was discarded`,
      });
    }
  }

  return { repeats: kept, fragments, diagnostics };
}
