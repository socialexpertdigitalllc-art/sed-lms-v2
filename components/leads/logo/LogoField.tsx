"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, History, Loader2, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { FieldRow } from "@/components/detail/FieldRow";
import { btnGhostSm, btnPrimary, btnSecondary } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import type { BrandColor } from "@/lib/logos/brief";
import type { LogoCandidateView, LogoGenerationView } from "@/lib/logos/store";
import { LogoRetryDialog, type Designer, type RetryRequest } from "./LogoRetryDialog";
import { ago, bgStyle, CHECKER_STYLE, DesignFacts, DesignImage, roundLabel, SpellingBadge, StageSteps, STAGE_LABEL, type PreviewBg } from "./LogoParts";

/**
 * The lead's Logo link field, with the AI logo generator under it
 * (lib/logos/*): Generate logo → four horizontal designs in the lead's
 * colours, drawn by MiniMax and proofread → Accept uploads the chosen one to
 * imgbb and puts its direct link in this field; Retry changes a design or
 * starts from the person's own idea.
 */

interface Brief {
  logoText: string;
  trade: string;
  colors: BrandColor[];
}

const POLL_MS = 2500;
/** Designs still waiting for a decision come back up when the page is opened within this long. */
const REOPEN_MS = 6 * 3_600_000;

type StartBody = { mode: "new" | "idea" | "refine"; instructions?: string; logoText?: string; parentId?: string; parentIndex?: number; font?: string; engine?: Designer };

interface Engines {
  google: boolean;
  minimax: boolean;
  default: Designer | null;
}

/** The same request as a round that failed, to try it again. PURE. */
export function sameAgain(g: LogoGenerationView): StartBody {
  const instructions = g.instructions ?? undefined;
  if (g.mode === "refine" && g.parentId && g.parentIndex != null && instructions) return { mode: "refine", instructions, logoText: g.logoText, parentId: g.parentId, parentIndex: g.parentIndex };
  return g.mode === "idea" && instructions ? { mode: "idea", instructions, logoText: g.logoText } : { mode: "new", logoText: g.logoText };
}

/** Designs nobody has accepted yet, from a recent round. PURE. */
export function awaitingDecision(g: Pick<LogoGenerationView, "acceptedIndex" | "candidates" | "createdAt">, now: number): boolean {
  return g.acceptedIndex == null && g.candidates.length > 0 && now - Date.parse(g.createdAt) < REOPEN_MS;
}

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string };
}

export function LogoField({
  leadId,
  logoLink,
  logoViaSms,
  canEdit,
  onSave,
  onSaved,
}: {
  leadId: string;
  logoLink: string | null;
  logoViaSms: boolean;
  canEdit: boolean;
  /** Typing a link by hand (the field's own edit). */
  onSave: (value: string) => Promise<void>;
  /** A design was accepted: refresh the lead. */
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [gens, setGens] = useState<LogoGenerationView[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [open, setOpen] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [pick, setPick] = useState<{ gen: string; index: number } | null>(null);
  const [bg, setBg] = useState<PreviewBg>("checker");
  const [saveBg, setSaveBg] = useState<"transparent" | "white">("transparent");
  const [busy, setBusy] = useState<"start" | "accept" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [budget, setBudget] = useState<{ used: number; limit: number | null } | null>(null);
  const [engines, setEngines] = useState<Engines | null>(null);

  const upsert = useCallback((g: LogoGenerationView) => {
    setGens((prev) => (prev.some((x) => x.id === g.id) ? prev.map((x) => (x.id === g.id ? g : x)) : [g, ...prev]));
  }, []);

  /** The rounds, the brief and today's allowance, fresh from the server. */
  const load = useCallback(
    () =>
      fetch(`/api/leads/${leadId}/logo`, { cache: "no-store" })
        .then((r) => (r.ok ? readJson<{ generations: LogoGenerationView[]; brief: Brief; budget?: { used: number; limit: number | null }; engines?: Engines }>(r) : null))
        .catch(() => null),
    [leadId],
  );

  // What's there already: a round still running, or designs waiting for a decision, open by themselves.
  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    void load().then((j) => {
      if (cancelled || !j?.generations) return;
      setGens(j.generations);
      setBrief(j.brief);
      if (j.budget) setBudget(j.budget);
      if (j.engines) setEngines(j.engines);
      const latest = j.generations[0];
      if (latest && (latest.status === "running" || awaitingDecision(latest, Date.now()))) setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [load, canEdit]);

  const viewed = gens.find((g) => g.id === viewId) ?? gens[0] ?? null;
  const running = viewed?.status === "running" ? viewed.id : null;

  // While a round runs: poll it, and tick the clock.
  useEffect(() => {
    if (!running) return;
    let stop = false;
    const poll = setInterval(() => {
      void fetch(`/api/leads/${leadId}/logo/${running}`, { cache: "no-store" })
        .then((r) => (r.ok ? readJson<{ generation: LogoGenerationView }>(r) : null))
        .then((j) => {
          if (stop || !j?.generation) return;
          upsert(j.generation);
          // Finished: today's count has moved.
          if (j.generation.status !== "running") void load().then((x) => x?.budget && setBudget(x.budget));
        })
        .catch(() => {});
    }, POLL_MS);
    const tick = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [running, leadId, upsert, load]);

  const candidates = viewed?.candidates ?? [];
  const selected: LogoCandidateView | null = (pick && pick.gen === viewed?.id ? candidates.find((c) => c.index === pick.index) : null) ?? candidates[0] ?? null;
  const concept = selected && viewed ? viewed.concepts[selected.concept] : null;
  const designLabel = selected ? `Design ${selected.index + 1}${concept?.title ? ` — ${concept.title}` : ""}` : "";
  const inUse = (g: LogoGenerationView | null, c: LogoCandidateView | null) => !!(g && c && logoLink && g.acceptedIndex === c.index && g.acceptedUrl === logoLink);

  async function start(body: StartBody): Promise<boolean> {
    setBusy("start");
    setError(null);
    setRetryError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/logo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await readJson<{ generation: LogoGenerationView; created: boolean }>(res);
      if (!res.ok || !j.generation) throw new Error(j.error ?? "Couldn't start the logo.");
      upsert(j.generation);
      setViewId(j.generation.id);
      setPick(null);
      setConfirmReplace(false);
      setOpen(true);
      setClock(Date.now());
      if (!j.created) toast({ kind: "info", title: "A logo round is already running for this lead", body: "Showing that one." });
      void load().then((x) => {
        if (x?.brief) setBrief(x.brief);
        if (x?.budget) setBudget(x.budget);
        if (x?.engines) setEngines(x.engines);
      });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't start the logo.";
      setError(msg);
      setRetryError(msg);
      setOpen(true);
      return false;
    } finally {
      setBusy(null);
    }
  }

  function onGenerateClick() {
    const latest = gens[0];
    // Don't spend a round when the last one is still running or still waiting for a decision.
    if (!open && latest && (latest.status === "running" || awaitingDecision(latest, Date.now()))) {
      setViewId(latest.id);
      setOpen(true);
      return;
    }
    void start({ mode: "new" });
  }

  async function cancel() {
    if (!viewed) return;
    setBusy("cancel");
    try {
      const res = await fetch(`/api/leads/${leadId}/logo/${viewed.id}/cancel`, { method: "POST" });
      const j = await readJson<{ generation: LogoGenerationView }>(res);
      if (j.generation) upsert(j.generation);
    } finally {
      setBusy(null);
    }
  }

  async function accept() {
    if (!viewed || !selected) return;
    if (logoLink && !inUse(viewed, selected) && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    setBusy("accept");
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/logo/${viewed.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: selected.index, background: saveBg }),
      });
      const j = await readJson<{ url: string; host: string | null }>(res);
      if (!res.ok || !j.url) throw new Error(j.error ?? "Couldn't save the logo.");
      upsert({ ...viewed, acceptedIndex: selected.index, acceptedUrl: j.url, acceptedAt: new Date().toISOString() });
      setConfirmReplace(false);
      toast({ kind: "success", title: "Logo saved", body: `Uploaded${j.host ? ` to ${j.host}` : ""} — the link is in the Logo field.` });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the logo.");
    } finally {
      setBusy(null);
    }
  }

  async function retry(r: RetryRequest) {
    const ok = await start(
      r.mode === "refine" && viewed && selected
        ? { mode: "refine", instructions: r.instructions, logoText: r.logoText, parentId: viewed.id, parentIndex: selected.index, ...(r.font ? { font: r.font } : {}), ...(r.engine ? { engine: r.engine } : {}) }
        : { mode: r.instructions ? "idea" : "new", instructions: r.instructions || undefined, logoText: r.logoText, ...(r.font ? { font: r.font } : {}), ...(r.engine ? { engine: r.engine } : {}) },
    );
    if (ok) setRetryOpen(false);
  }

  const display = (
    <div className="space-y-2">
      <div className="break-all">{logoLink ? logoLink : logoViaSms ? <span className="text-text-faint">Sent via SMS — add the link once uploaded</span> : <span className="text-text-faint">—</span>}</div>
      {logoLink ? (
        <a href={logoLink} target="_blank" rel="noreferrer" className="inline-grid max-w-full place-items-center rounded-md border border-border-subtle p-1.5" style={CHECKER_STYLE} title="Open the logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoLink} alt="Current logo" className="max-h-12 max-w-[240px] object-contain" />
        </a>
      ) : null}
      {canEdit ? (
        <button
          type="button"
          onClick={onGenerateClick}
          disabled={busy === "start"}
          className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-xs font-semibold text-accent-ink transition-colors hover:border-accent hover:bg-accent hover:text-white disabled:opacity-60"
        >
          {busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
          {logoLink ? "New logo with AI" : "Generate logo"}
        </button>
      ) : null}
    </div>
  );

  const drawnCount = candidates.length;
  const expected = viewed?.stage === "redrawing" ? Math.ceil((drawnCount + 1) / 4) * 4 : viewed?.stage === "concepts" || viewed?.stage === "drawing" ? 4 : drawnCount;
  const skeletons = running ? Math.max(0, expected - drawnCount) : 0;
  const elapsed = viewed ? Math.max(0, Math.round((clock - Date.parse(viewed.createdAt)) / 1000)) : 0;
  const earlier = gens.filter((g) => g.id !== viewed?.id);

  return (
    <>
      <FieldRow label="Logo link" value={logoLink ?? ""} type="url" canEdit={canEdit} onSave={onSave} display={display} />

      {open && canEdit ? (
        <section className="sm:col-span-2 mb-2 rounded-xl border border-border bg-surface-2/40 p-3 sm:p-4" aria-label="AI logo generator">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
                <Sparkles className="h-4 w-4 text-accent" aria-hidden /> AI logo
              </h3>
              <p className="mt-0.5 text-xs text-text-muted">
                {viewed ? (
                  <>
                    “{viewed.logoText}” · {roundLabel(viewed)} · {ago(viewed.createdAt, clock)}
                  </>
                ) : brief ? (
                  <>“{brief.logoText}”</>
                ) : null}
              </p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Hide the logo generator" className="rounded p-1 text-text-faint hover:bg-surface-2 hover:text-text">
              <X className="h-4 w-4" />
            </button>
          </header>

          {error ? <p className="mt-3 rounded-md bg-dropped-bg px-3 py-2 text-xs text-dropped-fg" role="alert">{error}</p> : null}

          {viewed?.status === "running" ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2" aria-live="polite">
              <div className="flex flex-wrap items-center gap-3">
                <StageSteps stage={viewed.stage} />
                <span className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden />
                  {STAGE_LABEL[viewed.stage ?? ""] ?? "Working"}
                  {drawnCount ? ` · ${drawnCount} ready` : ""} · {elapsed}s
                </span>
              </div>
              <button type="button" onClick={cancel} disabled={busy === "cancel"} className={btnGhostSm}>
                <Square className="h-3 w-3" aria-hidden /> Stop
              </button>
            </div>
          ) : null}

          {viewed?.status === "failed" && !drawnCount ? (
            <div className="mt-3 rounded-lg border border-dropped-fg/30 bg-dropped-bg/60 px-3 py-2.5 text-xs text-dropped-fg">
              <p className="font-medium">The logo couldn&apos;t be made.</p>
              <p className="mt-0.5">{viewed.error ?? "Something went wrong."}</p>
              <button type="button" onClick={() => void start(sameAgain(viewed))} disabled={busy === "start"} className={btnSecondary + " mt-2"}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Try again
              </button>
            </div>
          ) : null}
          {viewed?.status === "cancelled" && !drawnCount ? <p className="mt-3 text-xs text-text-muted">Stopped before any design was drawn.</p> : null}

          {selected && viewed ? (
            <div className="mt-3">
              <div className="relative overflow-hidden rounded-lg border border-border-subtle" style={bgStyle(bg)}>
                <div className="grid min-h-40 place-items-center p-6 sm:min-h-48">
                  <DesignImage c={selected} alt={`${designLabel}: logo for ${viewed.logoText}`} className="max-h-44 max-w-full" />
                </div>
                <div className="absolute right-2 top-2 flex gap-0.5 rounded-md border border-border bg-surface/90 p-0.5 text-[11px] shadow-sm backdrop-blur" role="group" aria-label="Preview background">
                  {(["checker", "light", "dark"] as const).map((b) => (
                    <button key={b} type="button" aria-pressed={bg === b} onClick={() => setBg(b)} className={"rounded px-1.5 py-0.5 " + (bg === b ? "bg-accent text-white" : "text-text-muted hover:text-text")}>
                      {b === "checker" ? "Transparent" : b === "light" ? "Light" : "Dark"}
                    </button>
                  ))}
                </div>
                {inUse(viewed, selected) ? (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
                    <Check className="h-3 w-3" aria-hidden /> In use
                  </span>
                ) : null}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-semibold text-text">{designLabel}</span>
                <SpellingBadge c={selected} />
                <DesignFacts c={selected} colors={brief?.colors ?? []} />
              </div>
              {concept?.idea ? <p className="mt-1 text-xs text-text-muted">{concept.idea}</p> : null}
              {selected.check?.issues.length ? <p className="mt-1 text-[11px] text-text-faint">Proofreader: {selected.check.issues.join(" · ")}</p> : null}
            </div>
          ) : null}

          {drawnCount || skeletons ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Designs">
              {candidates.map((c) => {
                const on = selected?.index === c.index;
                return (
                  <button
                    key={c.index}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`Design ${c.index + 1}`}
                    onClick={() => {
                      setPick({ gen: viewed!.id, index: c.index });
                      setConfirmReplace(false);
                    }}
                    className={"group relative flex flex-col overflow-hidden rounded-lg border bg-surface text-left transition " + (on ? "border-accent ring-2 ring-accent/40" : "border-border-subtle hover:border-accent/60")}
                  >
                    <span className="grid h-16 place-items-center p-2" style={CHECKER_STYLE}>
                      <DesignImage c={c} alt="" className="max-h-12 max-w-full" />
                    </span>
                    <span className="flex items-center justify-between gap-1 border-t border-border-subtle px-1.5 py-1">
                      <SpellingBadge c={c} compact />
                      <span className="text-[10px] tabular-nums text-text-faint">{c.index + 1}</span>
                    </span>
                    {inUse(viewed, c) ? <span className="absolute right-1 top-1 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">In use</span> : null}
                  </button>
                );
              })}
              {Array.from({ length: skeletons }, (_, i) => (
                <div key={`s${i}`} className="h-[5.75rem] animate-pulse rounded-lg border border-border-subtle bg-surface-2" aria-hidden />
              ))}
            </div>
          ) : null}

          {viewed?.notes.length ? (
            <ul className="mt-2 space-y-0.5 text-[11px] text-text-faint">
              {viewed.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}

          {selected && viewed ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {confirmReplace ? (
                <>
                  <span className="text-xs text-text">This replaces the lead&apos;s current logo link.</span>
                  <button type="button" onClick={accept} disabled={busy === "accept"} className={btnPrimary}>
                    {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Replace it
                  </button>
                  <button type="button" onClick={() => setConfirmReplace(false)} className={btnSecondary}>
                    Keep the current one
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={accept} disabled={busy === "accept" || inUse(viewed, selected)} className={btnPrimary}>
                    {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                    {inUse(viewed, selected) ? "In use" : busy === "accept" ? "Uploading…" : "Accept"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRetryError(null);
                      setRetryOpen(true);
                    }}
                    disabled={!!running || busy === "start"}
                    className={btnSecondary}
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden /> Retry
                  </button>
                  <label
                    className="ml-auto flex items-center gap-1.5 text-[11px] text-text-muted"
                    title="Transparent: the background — and any white inside the letters or shapes — is see-through, for any website header. On white: the logo on a solid white background, exactly as drawn."
                  >
                    Save as
                    <select value={saveBg} onChange={(e) => setSaveBg(e.target.value as "transparent" | "white")} className="rounded-md border border-border bg-surface px-1.5 py-1 text-[11px] text-text">
                      <option value="transparent">Transparent PNG</option>
                      <option value="white">On white</option>
                    </select>
                  </label>
                </>
              )}
            </div>
          ) : viewed && !running ? (
            <div className="mt-3">
              <button type="button" onClick={() => setRetryOpen(true)} className={btnSecondary}>
                <RotateCcw className="h-4 w-4" aria-hidden /> Try a different idea
              </button>
            </div>
          ) : null}

          {budget?.limit ? (
            <p className="mt-3 text-right text-[11px] text-text-faint" title="A daily cap an admin set (LOGO_DAILY_IMAGE_BUDGET); resets at midnight UTC">
              Today: {Math.min(budget.used, budget.limit)} of {budget.limit} pictures used
            </p>
          ) : null}

          {earlier.length ? (
            <div className="mt-3 border-t border-border-subtle pt-2">
              <button type="button" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} className={btnGhostSm}>
                <History className="h-3.5 w-3.5" aria-hidden /> Earlier rounds ({earlier.length})
                <ChevronDown className={"h-3.5 w-3.5 transition-transform " + (showHistory ? "rotate-180" : "")} aria-hidden />
              </button>
              {showHistory ? (
                <ul className="mt-1 space-y-1">
                  {earlier.map((g) => (
                    <li key={g.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setViewId(g.id);
                          setPick(null);
                          setConfirmReplace(false);
                          setError(null);
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
                      >
                        <span className="flex shrink-0 gap-1">
                          {g.candidates.slice(0, 4).map((c) => (
                            <span key={c.index} className="grid h-8 w-14 place-items-center overflow-hidden rounded border border-border-subtle" style={CHECKER_STYLE}>
                              <DesignImage c={c} alt="" className="max-h-7 max-w-[3.25rem]" />
                            </span>
                          ))}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-text">{roundLabel(g)}</span>
                          <span className="block text-[11px] text-text-faint">
                            {ago(g.createdAt, clock)} · {g.status === "ready" ? `${g.candidates.length} designs` : g.status === "running" ? "running" : g.status === "cancelled" ? "stopped" : "failed"}
                            {g.acceptedIndex != null ? ` · design ${g.acceptedIndex + 1} accepted` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {retryOpen ? (
        <LogoRetryDialog
          design={selected}
          designLabel={designLabel}
          logoText={viewed?.logoText ?? brief?.logoText ?? ""}
          colors={brief?.colors ?? []}
          busy={busy === "start"}
          error={retryError}
          engines={engines ? (["google", "minimax"] as const).filter((e) => engines[e]) : []}
          defaultEngine={engines?.default ?? null}
          onClose={() => setRetryOpen(false)}
          onSubmit={retry}
        />
      ) : null}
    </>
  );
}
