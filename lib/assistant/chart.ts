/**
 * The ```chart block the assistant may put in a reply, validated before it is
 * drawn. The model writes the JSON, so nothing about it is trusted: unknown
 * types, missing data, non-numeric values and oversized series are all
 * refused with a reason (shown in place of the chart) rather than rendered
 * wrong.
 *
 *   {"type":"bar","title":"Closed per month","data":[{"label":"Aug","value":12}]}
 *   {"type":"line","series":["closed","dropped"],"data":[{"label":"Aug","closed":12,"dropped":4}]}
 */

export const CHART_TYPES = ["bar", "line", "area", "pie"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartSpec {
  type: ChartType;
  title: string | null;
  /** One row per x-axis point (or pie slice); `label` plus one number per series. */
  rows: { label: string; values: Record<string, number> }[];
  series: string[];
  /** Shown on the value axis and in tooltips: "$", "%", or nothing. */
  unit: "$" | "%" | null;
  stacked: boolean;
  horizontal: boolean;
}

export const MAX_CHART_POINTS = 50;
export const MAX_CHART_SERIES = 4;

const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,%\s]/g, ""));
    return v.trim() && Number.isFinite(n) ? n : null;
  }
  return null;
};

export function parseChartSpec(raw: string): ChartSpec | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: "The chart data is not valid JSON." };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { error: "The chart spec must be a JSON object." };
  const spec = json as Record<string, unknown>;

  const type = String(spec.type ?? "bar").toLowerCase();
  if (!(CHART_TYPES as readonly string[]).includes(type)) return { error: `Unknown chart type "${type}".` };
  if (!Array.isArray(spec.data) || !spec.data.length) return { error: "The chart has no data." };
  if (spec.data.length > MAX_CHART_POINTS) return { error: `Too many points (${spec.data.length}); at most ${MAX_CHART_POINTS}.` };

  const first = spec.data[0] as Record<string, unknown>;
  const labelKey = ["label", "name", "x"].find((k) => first && k in first) ?? null;
  if (!labelKey) return { error: 'Each data row needs a "label".' };

  let series = Array.isArray(spec.series) ? spec.series.filter((s): s is string => typeof s === "string" && s.length > 0) : [];
  if (!series.length) {
    series = "value" in first ? ["value"] : Object.keys(first).filter((k) => k !== labelKey && num(first[k]) !== null);
  }
  if (!series.length) return { error: "The chart has no numeric values." };
  if (series.length > MAX_CHART_SERIES) return { error: `Too many series (${series.length}); at most ${MAX_CHART_SERIES}.` };
  if (type === "pie" && series.length > 1) series = series.slice(0, 1);

  const rows: ChartSpec["rows"] = [];
  for (const r of spec.data) {
    if (!r || typeof r !== "object") return { error: "Every data row must be an object." };
    const row = r as Record<string, unknown>;
    const values: Record<string, number> = {};
    for (const s of series) {
      const v = num(row[s]);
      if (v === null) return { error: `"${String(row[labelKey])}" has no number for "${s}".` };
      values[s] = v;
    }
    rows.push({ label: String(row[labelKey] ?? ""), values });
  }

  const unit = spec.unit === "$" || spec.unit === "%" ? spec.unit : null;
  return {
    type: type as ChartType,
    title: typeof spec.title === "string" && spec.title.trim() ? spec.title.trim().slice(0, 120) : null,
    rows,
    series,
    unit,
    stacked: spec.stacked === true,
    horizontal: spec.horizontal === true,
  };
}
