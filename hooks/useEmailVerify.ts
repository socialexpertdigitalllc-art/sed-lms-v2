"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VerificationResult } from "@/lib/email-verify/types";

export type VerifyPhase = "idle" | "checking" | "done" | "error";

type Internal = {
  /** The trimmed address this state describes. Anything else is stale. */
  key: string;
  phase: VerifyPhase;
  result: VerificationResult | null;
  error: string | null;
  deepBusy: boolean;
};

/**
 * Enough of an address to be worth a round trip. Typing "jo" is not a mistake
 * yet, so we stay quiet rather than flashing a syntax error mid-word.
 */
export function looksAddressable(email: string): boolean {
  const v = email.trim();
  const at = v.indexOf("@");
  return at > 0 && v.length > at + 1;
}

async function callApi(email: string, remote: boolean, signal: AbortSignal): Promise<VerificationResult> {
  const res = await fetch("/api/email-verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, remote }),
    signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(res.status === 401 ? "Your session expired — sign in again." : body.error ?? "Verification failed.");
  }
  return (await res.json()) as VerificationResult;
}

/**
 * Local (free) verification of an address, debounced, plus an explicit
 * `deepVerify()` that spends one provider credit.
 *
 * Never blocks anything on its own — callers decide what to do with the verdict.
 * Every state transition is keyed to the address that produced it, so a late
 * response for an old value can never overwrite a newer one.
 */
export function useEmailVerify(
  email: string,
  { debounceMs = 600, enabled = true }: { debounceMs?: number; enabled?: boolean } = {},
) {
  const value = email.trim();
  const worthChecking = enabled && value.length > 0 && looksAddressable(value);

  const [state, setState] = useState<Internal>({
    key: value,
    phase: worthChecking ? "checking" : "idle",
    result: null,
    error: null,
    deepBusy: false,
  });

  const abort = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new address resets everything. Adjusting state during render (rather than
  // in an effect) means the stale verdict is never painted for a frame. Any
  // request still in flight is aborted by the effect below and, belt and braces,
  // discarded on arrival by the key guard in `run`.
  if (state.key !== value) {
    setState({
      key: value,
      phase: worthChecking ? "checking" : "idle",
      result: null,
      error: null,
      deepBusy: false,
    });
  }

  const run = useCallback(async (target: string, remote: boolean) => {
    if (!target) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;

    // Guarded by key on every write: if the field moved on, the answer is dropped.
    setState((p) => (p.key === target ? { ...p, phase: "checking", error: null, deepBusy: remote } : p));
    try {
      const result = await callApi(target, remote, ctrl.signal);
      setState((p) => (p.key === target ? { key: target, phase: "done", result, error: null, deepBusy: false } : p));
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const message = err instanceof Error ? err.message : "Verification failed.";
      setState((p) =>
        p.key === target ? { key: target, phase: "error", result: null, error: message, deepBusy: false } : p,
      );
    }
  }, []);

  // Debounced free pass. The effect only schedules a timer — an external system,
  // not a state write — so a fast typist never generates a request per keystroke.
  useEffect(() => {
    if (!worthChecking) return;
    const id = setTimeout(() => void run(value, false), debounceMs);
    timer.current = id;
    return () => clearTimeout(id);
  }, [value, worthChecking, debounceMs, run]);

  // Drop any in-flight request when the target address changes, and on unmount.
  useEffect(() => () => abort.current?.abort(), [value]);

  /** Run the free pass immediately, skipping the debounce (Enter / explicit submit). */
  const checkNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (value) void run(value, false);
  }, [run, value]);

  /** Spend one provider credit on this address. */
  const deepVerify = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (value) void run(value, true);
  }, [run, value]);

  return {
    phase: state.phase,
    result: state.result,
    error: state.error,
    deepBusy: state.deepBusy,
    checkNow,
    deepVerify,
  };
}
