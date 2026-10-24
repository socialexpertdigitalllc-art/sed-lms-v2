"use client";

import { AlertTriangle, Check, CircleHelp } from "lucide-react";
import type { LogoCandidateView, LogoGenerationView } from "@/lib/logos/store";
import type { BrandColor } from "@/lib/logos/brief";
import { fontInfo } from "@/lib/logos/fontList";

/** Small, presentational pieces of the logo generator (LogoField.tsx). */

export type PreviewBg = "checker" | "light" | "dark";

/**
 * A light checkerboard where the logo is transparent — light in dark mode too:
 * the designs are drawn for white, and a navy name on a dark checker would
 * look broken when it isn't. The Dark preview is a button away.
 */
export const CHECKER_STYLE: React.CSSProperties = {
  backgroundColor: "#ffffff",
  backgroundImage:
    "linear-gradient(45deg, #eceef2 25%, transparent 25%), linear-gradient(-45deg, #eceef2 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #eceef2 75%), linear-gradient(-45deg, transparent 75%, #eceef2 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
};

export function bgStyle(bg: PreviewBg): React.CSSProperties {
  if (bg === "light") return { backgroundColor: "#ffffff" };
  if (bg === "dark") return { backgroundColor: "#0f172a" };
  return CHECKER_STYLE;
}

export const STAGE_LABEL: Record<string, string> = {
  concepts: "Sketching ideas",
  drawing: "Designing the logos",
  checking: "Checking the symbols",
  redrawing: "Drawing more",
  finishing: "Finishing",
};

const STEPS = ["Ideas", "Designs"] as const;
const stepOf = (stage: string | null) => (stage === "concepts" ? 0 : 1);

/** Ideas → Designs, the current one lit. */
export function StageSteps({ stage }: { stage: string | null }) {
  const at = stepOf(stage);
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1.5">
          <span
            className={
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium " +
              (i < at ? "bg-ready-bg text-ready-fg" : i === at ? "bg-accent-soft text-accent-ink" : "bg-surface-2 text-text-faint")
            }
            aria-current={i === at ? "step" : undefined}
          >
            {i < at ? <Check className="h-3 w-3" aria-hidden /> : null}
            {s}
          </span>
          {i < STEPS.length - 1 ? <span className="h-px w-3 bg-border" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

/** Exact spelling (typeset) / reads wrong / extra words / not checked. */
export function SpellingBadge({ c, compact = false }: { c: LogoCandidateView; compact?: boolean }) {
  const v = c.check?.verdict ?? "unchecked";
  if (c.typeset) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ready-bg px-2 py-0.5 text-[11px] font-medium text-ready-fg" title="The name is set in a real font, letter by letter — exactly as typed">
        <Check className="h-3 w-3" aria-hidden /> Exact spelling
      </span>
    );
  }
  if (v === "exact") {
    const fixed = (c.fixes ?? 0) > 0;
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-ready-bg px-2 py-0.5 text-[11px] font-medium text-ready-fg"
        title={fixed ? "It came out misspelled, was corrected automatically, and was read back again: matches the name" : "Read back letter by letter: matches the name"}
      >
        <Check className="h-3 w-3" aria-hidden /> Spelling checked
      </span>
    );
  }
  if (v === "misspelled" || v === "extra") {
    const what = v === "extra" ? `Extra words: ${c.check?.extra.join(", ")}` : `Reads “${c.check?.read || "?"}”`;
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-dropped-bg px-2 py-0.5 text-[11px] font-medium text-dropped-fg" title={what}>
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> <span className="truncate">{compact ? (v === "extra" ? "Extra words" : "Misspelled") : what}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted" title="Not proofread — read it before accepting">
      <CircleHelp className="h-3 w-3" aria-hidden /> Not checked
    </span>
  );
}

/** What else is worth knowing about a design: font, symbol, shape, colours, background. */
export function DesignFacts({ c, colors }: { c: LogoCandidateView; colors: BrandColor[] }) {
  if (c.typeset) {
    const facts: { ok: boolean; text: string }[] = [
      { ok: true, text: `Font: ${fontInfo(c.font).label}` },
      c.iconCheck?.text ? { ok: false, text: "Symbol may have letter-like marks" } : null,
      { ok: true, text: "Transparent background" },
    ].filter((f): f is { ok: boolean; text: string } => f !== null);
    return <FactList facts={facts} />;
  }
  if (c.engine === "google") {
    const facts: { ok: boolean; text: string }[] = [
      { ok: true, text: "Designed by Google" },
      (c.fixes ?? 0) > 0 ? { ok: true, text: "Lettering corrected" } : null,
      { ok: c.horizontal, text: c.horizontal ? "Horizontal" : "Not very wide" },
      { ok: c.transparent, text: c.transparent ? "Transparent background" : "Background kept" },
    ].filter((f): f is { ok: boolean; text: string } => f !== null);
    return <FactList facts={facts} />;
  }
  const ink = colors.filter((x) => x.role !== "light");
  const missing = ink.filter((x) => c.colors.missing.includes(x.hex));
  const facts: { ok: boolean; text: string }[] = [
    { ok: c.horizontal, text: c.horizontal ? "Horizontal" : "Not very wide" },
    ink.length ? { ok: missing.length === 0, text: missing.length ? `Missing ${missing.map((m) => m.name).join(", ")}` : "Brand colours" } : null,
    { ok: c.transparent, text: c.transparent ? "Transparent background" : c.background === "dark" ? "Dark background kept" : "Background kept" },
  ].filter((f): f is { ok: boolean; text: string } => f !== null);
  return <FactList facts={facts} />;
}

function FactList({ facts }: { facts: { ok: boolean; text: string }[] }) {
  return (
    <>
      {facts.map((f) => (
        <span key={f.text} className={"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium " + (f.ok ? "bg-surface-2 text-text-muted" : "bg-notready-bg text-notready-fg")}>
          {f.ok ? <Check className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />} {f.text}
        </span>
      ))}
    </>
  );
}

/** A design's image (a plain <img>: the storage host isn't an optimised one). */
export function DesignImage({ c, className = "", alt }: { c: Pick<LogoCandidateView, "url" | "width" | "height">; className?: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={c.url} alt={alt} width={c.width} height={c.height} loading="lazy" draggable={false} className={"h-auto w-auto object-contain " + className} />;
}

/** "Fresh designs" / "Your idea: …" / "Change: …". PURE. */
export function roundLabel(g: Pick<LogoGenerationView, "mode" | "instructions">): string {
  const said = (g.instructions ?? "").trim();
  const short = said.length > 60 ? `${said.slice(0, 57)}…` : said;
  if (g.mode === "refine") return `Change: ${short}`;
  if (g.mode === "idea" && said) return `Your idea: ${short}`;
  return "Fresh designs";
}

/** "just now", "5 min ago", "3 h ago", or the date. PURE. */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Swatches({ colors }: { colors: BrandColor[] }) {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {colors.map((c) => (
        <span key={c.hex} title={c.name} className="inline-block h-3.5 w-3.5 rounded-full border border-black/15" style={{ backgroundColor: c.hex }} />
      ))}
    </span>
  );
}
