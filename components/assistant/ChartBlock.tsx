"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { parseChartSpec, type ChartSpec } from "@/lib/assistant/chart";
import { PALETTE } from "@/lib/dashboard/palette";
import { useChartTheme } from "@/components/dashboard/chartTheme";

/**
 * A ```chart block from the assistant, drawn with the dashboard's own chart
 * theme. While the reply is still streaming the spec is incomplete JSON, so
 * the block waits; a spec that is complete but invalid says why instead of
 * drawing something wrong.
 */

const COLORS = [...PALETTE, "#DB2777", "#65A30D"];

function formatter(unit: ChartSpec["unit"]) {
  return (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return String(v);
    const s = n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return unit === "$" ? `$${s}` : unit === "%" ? `${s}%` : s;
  };
}

export function ChartBlock({ source, complete }: { source: string; complete: boolean }) {
  const theme = useChartTheme();
  const spec = useMemo(() => (complete ? parseChartSpec(source) : null), [source, complete]);

  if (!spec) {
    return (
      <div className="flex h-24 items-center justify-center gap-2 rounded-lg border border-dashed border-border text-xs text-text-faint">
        <BarChart3 className="h-4 w-4 animate-pulse" aria-hidden /> Drawing chart…
      </div>
    );
  }
  if ("error" in spec) {
    return <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-text-faint">Chart not shown: {spec.error}</p>;
  }

  // Series are keyed by position, not by name: a name with a dot in it would
  // be read by the chart library as a nested path.
  const data = spec.rows.map((r) => {
    const row: Record<string, string | number> = { label: r.label };
    spec.series.forEach((s, i) => (row[`s${i}`] = r.values[s]));
    return row;
  });
  const fmt = formatter(spec.unit);
  const many = spec.series.length > 1;
  const common = { data, margin: { top: 8, right: 12, left: 0, bottom: 0 } };
  const axisX = <XAxis dataKey="label" {...theme.axisProps} interval="preserveStartEnd" minTickGap={12} />;
  const axisY = <YAxis {...theme.axisProps} width={56} tickFormatter={fmt} />;
  const tooltip = <Tooltip contentStyle={theme.tooltipStyle} formatter={(v) => fmt(v)} cursor={{ fill: theme.cursorFill }} />;
  const legend = many ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null;

  let chart: React.ReactElement;
  if (spec.type === "pie") {
    chart = (
      <PieChart>
        <Pie data={data} dataKey="s0" nameKey="label" innerRadius="45%" outerRadius="80%" paddingAngle={1}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={theme.tooltipStyle} formatter={(v) => fmt(v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    );
  } else if (spec.type === "line") {
    chart = (
      <LineChart {...common}>
        <CartesianGrid stroke={theme.grid} vertical={false} />
        {axisX}
        {axisY}
        {tooltip}
        {legend}
        {spec.series.map((s, i) => (
          <Line key={s} type="monotone" dataKey={`s${i}`} name={s} stroke={COLORS[i]} strokeWidth={2} dot={data.length <= 16} />
        ))}
      </LineChart>
    );
  } else if (spec.type === "area") {
    chart = (
      <AreaChart {...common}>
        <CartesianGrid stroke={theme.grid} vertical={false} />
        {axisX}
        {axisY}
        {tooltip}
        {legend}
        {spec.series.map((s, i) => (
          <Area
            key={s}
            type="monotone"
            dataKey={`s${i}`}
            name={s}
            stroke={COLORS[i]}
            fill={COLORS[i]}
            fillOpacity={0.18}
            strokeWidth={2}
            stackId={spec.stacked ? "a" : undefined}
          />
        ))}
      </AreaChart>
    );
  } else {
    chart = spec.horizontal ? (
      <BarChart {...common} layout="vertical">
        <CartesianGrid stroke={theme.grid} horizontal={false} />
        <XAxis type="number" {...theme.axisProps} tickFormatter={fmt} />
        <YAxis type="category" dataKey="label" {...theme.axisProps} width={110} />
        {tooltip}
        {legend}
        {spec.series.map((s, i) => (
          <Bar key={s} dataKey={`s${i}`} name={s} fill={COLORS[i]} radius={[0, 4, 4, 0]} stackId={spec.stacked ? "a" : undefined} />
        ))}
      </BarChart>
    ) : (
      <BarChart {...common}>
        <CartesianGrid stroke={theme.grid} vertical={false} />
        {axisX}
        {axisY}
        {tooltip}
        {legend}
        {spec.series.map((s, i) => (
          <Bar key={s} dataKey={`s${i}`} name={s} fill={COLORS[i]} radius={[4, 4, 0, 0]} stackId={spec.stacked ? "a" : undefined} />
        ))}
      </BarChart>
    );
  }

  const height = spec.type === "bar" && spec.horizontal ? Math.max(180, data.length * 30) : 240;
  return (
    <figure className="rounded-lg border border-border bg-surface p-3">
      {spec.title ? <figcaption className="mb-2 text-xs font-semibold text-text-muted">{spec.title}</figcaption> : null}
      <ResponsiveContainer width="100%" height={height}>
        {chart}
      </ResponsiveContainer>
    </figure>
  );
}
