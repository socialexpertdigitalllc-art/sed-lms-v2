"use client";

import { useThemeTokens } from "@/hooks/useThemeTokens";

/**
 * The theme-dependent chrome of a Recharts chart — grid lines, axis labels
 * and the tooltip card — shared by the dashboard and AI-tools charts.
 *
 * Only the CHROME is themed. The data series keep their fixed palette
 * (lib/dashboard/palette.ts): a status colour means the same thing in either
 * theme, and those hues are mid-tone enough to read on both. What genuinely
 * breaks in the dark is the near-white grid and the white tooltip, which is
 * what this replaces.
 */
export function useChartTheme() {
  const t = useThemeTokens({
    grid: "--color-border",
    axis: "--color-text-faint",
    surface: "--color-surface",
    text: "--color-text",
  });

  // Pre-hydration (and if a variable ever resolves empty) fall back to the
  // light literals this file used to hardcode — that is the first frame the
  // server rendered anyway.
  const grid = t?.grid || "#E5E9F0";
  const axis = t?.axis || "#8089A0";
  const surface = t?.surface || "#FFFFFF";
  const text = t?.text || "#141B2D";

  return {
    grid,
    axis,
    /** Teal wash under the hovered bar; identical in both themes. */
    cursorFill: "rgba(13,148,136,0.10)",
    tooltipStyle: {
      borderRadius: 8,
      border: `1px solid ${grid}`,
      background: surface,
      color: text,
      fontSize: 12,
      boxShadow: "0 8px 24px -12px rgba(0,0,0,0.35)",
    },
    axisProps: {
      tick: { fill: axis, fontSize: 11 },
      tickLine: false,
      axisLine: { stroke: grid },
    },
  };
}
