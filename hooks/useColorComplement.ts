"use client";

import { useEffect, useRef, useState } from "react";
import { colorToHex, parseColorScheme } from "@/lib/leads/colorScheme";
import { bestComplement, harmonyOptions, HARMONY_LABEL } from "@/lib/leads/colorHarmony";
import type { ColorSchemeContext } from "./useColorSchemeCheck";

export interface ComplementState {
  /** The partner colour to offer, or null when there is nothing to suggest. */
  hex: string | null;
  note: string;
  loading: boolean;
  /** false while showing colour theory's answer rather than the model's. */
  fromAi: boolean;
}

/**
 * The recommended second colour, for a scheme that currently has exactly one.
 *
 * Shows colour theory's answer IMMEDIATELY and upgrades it in place when the
 * model replies. An agent types a hex and sees a partner the same instant; the
 * model's version, with a reason they can repeat to the client, arrives a
 * moment later. A model outage is therefore invisible rather than fatal.
 *
 * Only ever active at exactly one colour: a second colour means the agent has
 * made the decision, and a suggestion after that is nagging.
 */
export function useColorComplement(
  raw: string,
  { context, debounceMs = 500, enabled = true }: { context?: ColorSchemeContext; debounceMs?: number; enabled?: boolean } = {},
): ComplementState {
  const colors = parseColorScheme(raw);
  const base = colors.length === 1 ? colorToHex(colors[0]) : null;
  const active = enabled && !!base;

  const [ai, setAi] = useState<{ key: string; hex: string; note: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const ctxRef = useRef<ColorSchemeContext>(context ?? {});
  useEffect(() => {
    ctxRef.current = context ?? {};
  });

  useEffect(() => {
    // No base to work from: nothing to fetch, and the reader below already
    // reports loading:false whenever the suggestion is inactive.
    if (!base) return;
    if (ai?.key === base) return; // already answered for this exact colour

    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/leads/color-scheme/complement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base, ...ctxRef.current }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("complement failed");
        const json = (await res.json()) as { hex?: string; note?: string };
        if (json?.hex) setAi({ key: base, hex: json.hex, note: json.note ?? "" });
      } catch {
        /* colour theory below is already showing — nothing to report */
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [base, debounceMs, ai?.key]);

  if (!active || !base) return { hex: null, note: "", loading: false, fromAi: false };

  if (ai?.key === base) return { hex: ai.hex, note: ai.note, loading: false, fromAi: true };

  const kind = harmonyOptions(base)[0]?.kind ?? "complement";
  return {
    hex: bestComplement(base),
    note: `${HARMONY_LABEL[kind]} to ${base}.`,
    loading,
    fromAi: false,
  };
}
