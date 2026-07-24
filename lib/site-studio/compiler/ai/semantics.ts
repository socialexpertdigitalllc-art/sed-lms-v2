import { parseJsonLoose } from "@/lib/ai/json";
import { PAGE_KINDS, type CompiledTemplate, type Diagnostic, type PageKind } from "../../schema";
import type { AiCall } from "./identityAi";

export const SEMANTIC_LABELS = ["headline", "subheadline", "body", "cta", "quote", "list_item", "label", "other"] as const;
export type SemanticLabel = (typeof SEMANTIC_LABELS)[number];

export interface SemanticsProposal {
  pages: { id: string; kind: string }[];
  slots: { id: string; semantic: string }[];
}

/** Apply a proposal. PURE (clones). Unknown ids/kinds/labels are individually
 *  rejected with warn diagnostics; valid entries still apply. */
export function applySemantics(
  input: CompiledTemplate,
  proposal: SemanticsProposal,
): { template: CompiledTemplate; diagnostics: Diagnostic[] } {
  const template = structuredClone(input);
  const diagnostics: Diagnostic[] = [];
  const reject = (what: string) =>
    diagnostics.push({ level: "warn", code: "ai_semantics_rejected", message: `Semantics proposal rejected: ${what}` });

  const byId = new Map(template.manifest.pages.map((p) => [p.id, p]));
  for (const { id, kind } of proposal.pages) {
    const page = byId.get(id);
    if (!page) { reject(`unknown page "${id}"`); continue; }
    if (!(PAGE_KINDS as readonly string[]).includes(kind)) { reject(`unknown kind "${kind}" for page "${id}"`); continue; }
    page.kind = kind as PageKind;
    page.stampable = kind === "service" || kind === "area";
  }

  // slot ids are unique across the whole manifest (page-scoped prefixes)
  const slotById = new Map<string, { semantic?: string }>();
  for (const page of template.manifest.pages) {
    for (const s of page.slots) slotById.set(s.id, s);
    for (const rep of page.repeats) for (const s of rep.slots) slotById.set(s.id, s);
  }
  for (const { id, semantic } of proposal.slots) {
    const slot = slotById.get(id);
    if (!slot) { reject(`unknown slot "${id}"`); continue; }
    if (!(SEMANTIC_LABELS as readonly string[]).includes(semantic)) { reject(`unknown label "${semantic}" for slot "${id}"`); continue; }
    slot.semantic = semantic;
  }

  return { template, diagnostics };
}

const SYSTEM = `You classify website template structure. Given a list of PAGES (id, filename, title, sample text) and SLOTS (id, sample text), reply with STRICT JSON only:
{"pages":[{"id":"...","kind":"<one of: ${PAGE_KINDS.join(" | ")}>"}],"slots":[{"id":"...","semantic":"<one of: ${SEMANTIC_LABELS.join(" | ")}>"}]}
Rules: "service" = a page about ONE specific service (stampable per-service); "services_hub" = the overview listing many. Same distinction for "area"/"areas_hub". Only include pages whose current kind is wrong and slots worth labeling. No prose, no fences.`;

export async function proposeSemantics(
  tpl: CompiledTemplate,
  call: AiCall,
): Promise<{ proposal: SemanticsProposal; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const lines: string[] = ["PAGES:"];
  for (const p of tpl.manifest.pages) {
    const preview = p.slots.slice(0, 3).map((s) => s.sample).join(" | ").slice(0, 200);
    lines.push(`- id=${p.id} file=${p.file} current_kind=${p.kind} title=${JSON.stringify(p.title_sample)} text=${JSON.stringify(preview)}`);
  }
  lines.push("SLOTS:");
  for (const p of tpl.manifest.pages) {
    for (const s of p.slots) lines.push(`- id=${s.id} sample=${JSON.stringify(s.sample.slice(0, 120))}`);
    for (const rep of p.repeats) for (const s of rep.slots) lines.push(`- id=${s.id} sample=${JSON.stringify(s.sample.slice(0, 120))}`);
  }
  const { text } = await call(SYSTEM, lines.join("\n").slice(0, 8000));
  const json = parseJsonLoose<Partial<SemanticsProposal>>(text);
  const pages = Array.isArray(json?.pages) ? json!.pages!.filter((e) => e && typeof e.id === "string" && typeof e.kind === "string") : null;
  const slots = Array.isArray(json?.slots) ? json!.slots!.filter((e) => e && typeof e.id === "string" && typeof e.semantic === "string") : null;
  if (pages === null && slots === null) {
    diagnostics.push({
      level: "warn", code: "ai_semantics_unparseable",
      message: "The semantics model did not return usable JSON; page kinds/labels unchanged (re-run to retry).",
    });
    return { proposal: { pages: [], slots: [] }, diagnostics };
  }
  return { proposal: { pages: pages ?? [], slots: slots ?? [] }, diagnostics };
}
