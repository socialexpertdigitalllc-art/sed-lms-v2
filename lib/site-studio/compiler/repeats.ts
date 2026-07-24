import { HTMLElement, NodeType } from "node-html-parser";
import { Diagnostic, RepeatDef, SlotDef } from "../schema";
import { repeatMarker, slotToken } from "../tokens";
import { PageSource } from "./inventory";
import { isSlottableLeaf } from "./slots";

const signature = (el: HTMLElement) =>
  `${el.rawTagName?.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).sort().join(".")}`;

function congruent(a: HTMLElement, b: HTMLElement): boolean {
  if (a.rawTagName?.toLowerCase() !== b.rawTagName?.toLowerCase()) return false;
  const ac = a.childNodes.filter((n) => n.nodeType === NodeType.ELEMENT_NODE) as HTMLElement[];
  const bc = b.childNodes.filter((n) => n.nodeType === NodeType.ELEMENT_NODE) as HTMLElement[];
  if (ac.length !== bc.length) return false;
  return ac.every((child, i) => congruent(child, bc[i]));
}

const leaves = (el: HTMLElement): HTMLElement[] => {
  const own = isSlottableLeaf(el) ? [el] : [];
  const kids = el.childNodes
    .filter((n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE)
    .flatMap(leaves);
  return [...own, ...kids];
};

/** Pass 3b: runs of ≥3 congruent siblings with slottable content → repeat regions. */
export function extractRepeats(page: PageSource): { repeats: RepeatDef[]; fragments: Record<string, string>; diagnostics: Diagnostic[] } {
  const repeats: RepeatDef[] = [];
  const fragments: Record<string, string> = {};
  const diagnostics: Diagnostic[] = [];
  let rn = 0;

  for (const parent of page.root.querySelectorAll("*")) {
    const kids = parent.childNodes.filter((n): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE);
    if (kids.length < 3) continue;
    const sig = signature(kids[0]);
    if (!kids.every((k) => signature(k) === sig)) continue;
    if (!kids.every((k) => congruent(k, kids[0]))) continue;
    if (leaves(kids[0]).length === 0) continue;

    const id = `${page.id}_r${++rn}`;
    const slots: SlotDef[] = [];
    const samples: Record<string, string>[] = [];

    // samples first (leaf order is identical across congruent instances)
    for (const inst of kids) {
      const row: Record<string, string> = {};
      leaves(inst).forEach((leaf, i) => { row[`${id}_s${i + 1}`] = leaf.innerHTML.trim(); });
      samples.push(row);
    }
    // fragment from the first instance
    leaves(kids[0]).forEach((leaf, i) => {
      const sid = `${id}_s${i + 1}`;
      const sample = leaf.innerHTML.trim();
      const plain = leaf.text.trim();
      slots.push({ id: sid, type: "text", sample, html: sample !== plain, max_chars: Math.max(40, Math.ceil(plain.length * 1.5)) });
      leaf.set_content(slotToken(sid));
    });
    fragments[id] = kids[0].toString();

    kids[0].replaceWith(repeatMarker(id));
    for (const extra of kids.slice(1)) extra.remove();
    repeats.push({ id, fragment: id, min: 1, max: 12, slots, samples });
  }

  return { repeats, fragments, diagnostics };
}
