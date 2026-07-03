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

const TEAL = "#0D9488";
const GRID = "#E5E9F0";
const AXIS = "#8089A0";

const STATUS_COLORS: Record<string, string> = {
  Ready: "#15803D",
  "Not Ready": "#D97706",
  Closed: "#7E22CE",
  Dropped: "#DC2626",
};
const PALETTE = ["#0D9488", "#2563EB", "#7E22CE", "#D97706", "#0EA5E9"];

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
};

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-full min-h-[180px] grid place-items-center text-sm text-text-faint">
      {label}
    </div>
  );
}

export function LeadsTrend({ data }: { data: NameValue[] }) {
  if (!data.length) return <EmptyChart label="No activity yet" />;
  const fmt = (v: string) => {
    const d = new Date(v);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL} stopOpacity={0.35} />
            <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" {...axisProps} tickFormatter={fmt} minTickGap={28} />
        <YAxis {...axisProps} allowDecimals={false} width={28} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(label) => fmt(String(label))} />
        <Area type="monotone" dataKey="value" stroke={TEAL} strokeWidth={2} fill="url(#trendFill)" name="Leads" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LeadsByAgent({ data }: { data: NameValue[] }) {
  if (!data.length) return <EmptyChart label="No agents yet" />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" {...axisProps} allowDecimals={false} />
        <YAxis type="category" dataKey="name" {...axisProps} width={70} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(13,148,136,0.06)" }} />
        <Bar dataKey="value" fill={TEAL} radius={[0, 4, 4, 0]} barSize={16} name="Leads" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StatusDonut({ data }: { data: NameValue[] }) {
  if (!data.length) return <EmptyChart label="No leads yet" />;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none" isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.name} fill={STATUS_COLORS[d.name] ?? TEAL} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function SiteTypeDonut({ data }: { data: NameValue[] }) {
  if (!data.length) return <EmptyChart label="No site types yet" />;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none" isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={d.name} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function RatingBars({ data }: { data: NameValue[] }) {
  const hasAny = data.some((d) => d.value > 0);
  if (!hasAny) return <EmptyChart label="No ratings yet" />;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} allowDecimals={false} width={28} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(13,148,136,0.06)" }} />
        <Bar dataKey="value" fill={TEAL} radius={[3, 3, 0, 0]} name="Leads" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Small legend chip list shared by the donuts. */
export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
      {items.map((i) => (
        <div key={i.name} className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: i.color }} />
          {i.name}
        </div>
      ))}
    </div>
  );
}

export const STATUS_LEGEND = Object.entries(STATUS_COLORS).map(([name, color]) => ({ name, color }));
export const SITE_PALETTE = PALETTE;
