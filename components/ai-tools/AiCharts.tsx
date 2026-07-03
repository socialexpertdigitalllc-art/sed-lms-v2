"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { NameValue } from "@/lib/leads/analytics";

const GRID = "#E5E9F0";
const AXIS = "#8089A0";
const TOOL_COLORS: Record<string, string> = { webcraft: "#0D9488", deepseek: "#4F46E5" };
const PALETTE = ["#0D9488", "#4F46E5", "#7E22CE", "#D97706", "#0EA5E9", "#15803D"];

const tooltipStyle = {
  borderRadius: 8,
  border: "1px solid #DDE2EA",
  fontSize: 12,
  boxShadow: "0 8px 24px -12px rgba(20,27,45,0.25)",
};
const axisProps = {
  tick: { fill: AXIS, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: GRID },
} as const;

export function GenerationsTrend({ data }: { data: NameValue[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="aiTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0D9488" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#0D9488" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" {...axisProps} tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
        <YAxis {...axisProps} allowDecimals={false} width={28} />
        <Tooltip contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="value" stroke="#0D9488" strokeWidth={2} fill="url(#aiTrendFill)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ToolDonut({ data }: { data: NameValue[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none" isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={d.name} fill={TOOL_COLORS[d.name] ?? PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function CountBars({ data }: { data: NameValue[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" {...axisProps} interval={0} angle={-15} textAnchor="end" height={50} />
        <YAxis {...axisProps} allowDecimals={false} width={28} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(13,148,136,0.06)" }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={d.name} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
