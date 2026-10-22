"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Trophy, X } from "lucide-react";
import type { MilestoneCelebration as Celebration } from "@/lib/milestones";

const CONFETTI_COLORS = ["#0d9488", "#5eead4", "#f59e0b", "#fbbf24", "#ec4899", "#8b5cf6", "#3b82f6", "#22c55e"];
const CONFETTI_MS = 4200;
const COUNT_UP_MS = 1600;

function reducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

/** "1,000". PURE. */
export const thousands = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** "1K Club", "2K Club"… PURE. */
export const clubName = (milestone: number) => `${milestone / 1000}K Club`;

/** A short burst of confetti over the whole screen (skipped for reduced motion). */
function Confetti() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el || reducedMotion()) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = el.getContext("2d");
    } catch {
      // no canvas (an old browser, a test page): the card alone is the celebration
    }
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = () => {
      el.width = window.innerWidth * dpr;
      el.height = window.innerHeight * dpr;
    };
    size();
    window.addEventListener("resize", size);
    const w = () => el.width;
    const pieces = Array.from({ length: 180 }, (_, i) => ({
      x: (i % 2 ? 0.1 : 0.9) * w() + (Math.random() - 0.5) * w() * 0.2,
      y: el.height * (0.55 + Math.random() * 0.2),
      vx: (i % 2 ? 1 : -1) * (2 + Math.random() * 7) * dpr,
      vy: -(9 + Math.random() * 9) * dpr,
      size: (5 + Math.random() * 7) * dpr,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      spin: Math.random() * Math.PI,
      vspin: (Math.random() - 0.5) * 0.3,
      round: Math.random() < 0.3,
    }));
    const start = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const elapsed = t - start;
      ctx.clearRect(0, 0, el.width, el.height);
      const fade = Math.max(0, 1 - Math.max(0, elapsed - CONFETTI_MS + 900) / 900);
      for (const p of pieces) {
        p.vy += 0.28 * dpr;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += p.vspin;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
          ctx.fill();
        } else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (elapsed < CONFETTI_MS) frame = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, el.width, el.height);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", size);
    };
  }, []);
  return <canvas ref={canvas} className="pointer-events-none fixed inset-0 z-[61] h-full w-full" aria-hidden />;
}

/** 0 → target, easing out (just the target for reduced motion). */
function useCountUp(target: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reducedMotion()) {
      const t = setTimeout(() => setN(target), 0);
      return () => clearTimeout(t);
    }
    const start = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / COUNT_UP_MS);
      setN(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return n;
}

/** The celebration card itself (exported for tests). */
export function MilestoneCard({ c, firstName, onClose }: { c: Celebration; firstName: string; onClose: () => void }) {
  const shown = useCountUp(c.milestone);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stats = [
    c.mine > 0 ? { value: thousands(c.mine), label: c.mine === 1 ? "of them is yours" : "of them are yours" } : null,
    c.closed > 0 ? { value: thousands(c.closed), label: c.closed === 1 ? "deal closed" : "deals closed" } : null,
    c.team > 0 ? { value: thousands(c.team), label: c.team === 1 ? "person on the team" : "people on the team" } : null,
  ].filter((s): s is { value: string; label: string } => s !== null);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="milestone-title" onClick={onClose}>
      <div
        className="milestone-pop relative w-full max-w-md overflow-hidden rounded-3xl border border-border bg-surface text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="milestone-card"
      >
        <div className="milestone-glow pointer-events-none absolute inset-x-0 top-0 h-56" aria-hidden />
        <button type="button" onClick={onClose} className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-text-faint hover:bg-surface-2 hover:text-text" aria-label="Close">
          <X className="h-4 w-4" aria-hidden />
        </button>

        <div className="relative px-6 pb-6 pt-8 sm:px-8">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent-ink">Achievement unlocked</p>
          <div className="milestone-medal mx-auto mt-4 grid h-24 w-24 place-items-center rounded-full">
            <Trophy className="h-11 w-11 text-white drop-shadow" aria-hidden />
          </div>
          <p className="mt-2 inline-flex rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-ink">{clubName(c.milestone)}</p>

          <h2 id="milestone-title" className="mt-4 font-display text-5xl font-bold tracking-tight text-text sm:text-6xl">
            <span className="tabular-nums" aria-hidden>
              {thousands(shown)}
            </span>
            <span className="sr-only">{thousands(c.milestone)}</span>
          </h2>
          <p className="mt-1 font-display text-xl font-semibold text-text">leads in the pipeline!</p>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-text-muted">
            {firstName ? `${firstName}, every` : "Every"} call, every follow-up and every site got the team here. Thank you — this one is all of ours.
          </p>

          {stats.length ? (
            <div className="mt-5 grid gap-2" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border border-border-subtle bg-surface-2 px-2 py-2.5">
                  <p className="font-display text-lg font-bold tabular-nums text-text">{s.value}</p>
                  <p className="text-[11px] leading-tight text-text-muted">{s.label}</p>
                </div>
              ))}
            </div>
          ) : null}

          <button
            ref={close}
            type="button"
            onClick={onClose}
            className="mt-6 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent-ink"
          >
            On to {thousands(c.next)} <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
          <p className="mt-2 text-[11px] text-text-faint">You&apos;ll see this once. The next one is at {thousands(c.next)} leads.</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Mounted once in the app layout: asks whether a company milestone is owed to
 * this person, and if so celebrates it — once. It is marked seen the moment it
 * shows, so a refresh (or another device) never shows it again until the next
 * thousand (lib/milestones.ts).
 */
export function MilestoneCelebration({ displayName }: { displayName: string }) {
  const [c, setC] = useState<Celebration | null>(null);
  const dismiss = useCallback(() => setC(null), []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me/milestone", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { celebration?: Celebration | null } | null) => {
        const found = j?.celebration ?? null;
        if (cancelled || !found) return;
        setC(found);
        void fetch("/api/me/milestone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ milestone: found.milestone }) }).catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!c) return null;
  const firstName = displayName.trim().split(/\s+/)[0] ?? "";
  return (
    <>
      <MilestoneCard c={c} firstName={firstName} onClose={dismiss} />
      <Confetti />
    </>
  );
}
