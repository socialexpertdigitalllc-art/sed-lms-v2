"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deterministicIssues, type ColorSchemeCheck } from "@/lib/leads/colorScheme";

export type ColorCheckPhase = "idle" | "checking" | "done" | "error";

export interface ColorSchemeContext {
  business_name?: string;
  services?: string[];
  site_type?: string;
}

type Internal = {
  /** The trimmed scheme this state describes. Anything else is stale. */
  key: string;
  phase: ColorCheckPhase;
  result: ColorSchemeCheck | null;
};

async function callApi(
  raw: string,
  ctx: ColorSchemeContext,
  signal: AbortSignal
): Promise<ColorSchemeCheck> {
  const res = await fetch("/api/leads/color-scheme/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw, ...ctx }),
    signal,
  });
  if (!res.ok) throw new Error("check failed");
  return (await res.json()) as ColorSchemeCheck;
}

/**
 * Advisory AI review of a colour scheme, debounced.
 *
 * Fails OPEN by design. Any transport failure, or an `ok: null` soft result
 * from the route, is reported as `aiUnavailable` and the caller falls back to
 * `issues` — which are always the deterministic ones merged with whatever the
 * AI added. An outage must never make the field unfillable.
 */
export function useColorSchemeCheck(
  raw: string,
  {
    context,
    debounceMs = 700,
    enabled = true,
  }: { context?: ColorSchemeContext; debounceMs?: number; enabled?: boolean } = {}
) {
  const value = raw.trim();
  const worthChecking = enabled && value.length > 0;

  const [state, setState] = useState<Internal>({
    key: value,
    phase: worthChecking ? "checking" : "idle",
    result: null,
  });

  // Context is read at request time only: a keystroke in "business name" must
  // not re-trigger the colour check.
  const ctxRef = useRef<ColorSchemeContext>(context ?? {});
  useEffect(() => {
    ctxRef.current = context ?? {};
  });

  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new scheme resets everything during render, so a stale verdict is never
  // painted for a frame against the wrong value.
  if (state.key !== value) {
    setState({ key: value, phase: worthChecking ? "checking" : "idle", result: null });
  }

  const run = useCallback(async (target: string) => {
    if (!target) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState((p) => (p.key === target ? { ...p, phase: "checking" } : p));
    try {
      const result = await callApi(target, ctxRef.current, ctrl.signal);
      setState((p) => (p.key === target ? { key: target, phase: "done", result } : p));
    } catch {
      if (ctrl.signal.aborted) return;
      setState((p) => (p.key === target ? { key: target, phase: "error", result: null } : p));
    }
  }, []);

  useEffect(() => {
    if (!worthChecking) return;
    const id = setTimeout(() => void run(value), debounceMs);
    timer.current = id;
    return () => clearTimeout(id);
  }, [value, worthChecking, debounceMs, run]);

  useEffect(() => () => abort.current?.abort(), [value]);

  /** Skip the debounce (blur, or an explicit submit). */
  const checkNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (value) void run(value);
  }, [run, value]);

  const local = deterministicIssues(value);
  const aiUnavailable = state.phase === "error" || state.result?.ok === null;
  // Definite rejection only. `ok: null` (AI down) never blocks anything.
  const rejected = state.result?.ok === false;

  const issues = Array.from(
    new Set([...local, ...(aiUnavailable ? [] : (state.result?.issues ?? []))])
  );

  return {
    phase: state.phase,
    checking: state.phase === "checking",
    aiUnavailable,
    /** Definite AI rejection — the only AI signal allowed to block a submit. */
    rejected,
    issues,
    suggestion: aiUnavailable ? [] : (state.result?.suggestion ?? []),
    note: aiUnavailable ? "" : (state.result?.note ?? ""),
    checkNow,
  };
}

export type ColorSchemeCheckState = ReturnType<typeof useColorSchemeCheck>;
