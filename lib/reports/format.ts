/** Shared number formatters for the Agent Periodic Report (dashboard tiles, board, PDF). */

export type Fmt = (v: number | null) => string;

export const fmtInt: Fmt = (v) => (v === null ? "—" : String(Math.round(v)));
export const fmtPct: Fmt = (v) => (v === null ? "—" : `${v.toFixed(0)}%`);
export const fmtHours: Fmt = (v) => (v === null ? "—" : v < 48 ? `${Math.round(v)}h` : `${(v / 24).toFixed(1)}d`);
export const fmtDays: Fmt = (v) => (v === null ? "—" : v < 2 ? `${Math.round(v * 24)}h` : `${v.toFixed(1)}d`);
export const fmtRatio: Fmt = (v) => (v === null ? "—" : v.toFixed(2));
