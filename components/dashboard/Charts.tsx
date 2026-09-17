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
import { STATUS_COLORS, PALETTE, TICKET_COLORS } from "@/lib/dashboard/palette";
import { formatCurrency } from "@/lib/leads/format";
import { useChartTheme } from "./chartTheme";

const TEAL = "#0D9488";

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-full min-h-[150px] grid place-items-center text-sm text-text-faint">
      {label}
    </div>
  );
}

export function LeadsTrend({ data }: { data: NameValue[] }) {
  const { grid, axisProps, tooltipStyle } = useChartTheme();
  if (!data.length) return <EmptyChart label="No activity yet" />;
  const fmt = (v: string) => {
    const d = new Date(v);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return (
    <ResponsiveContainer width="100%" height={170}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TEAL} stopOpacity={0.35} />
            <stop offset="100%" stopColor={TEAL} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis dataKey="name" {...axisProps} tickFormatter={fmt} minTickGap={28} />
        <YAxis {...axisProps} allowDecimals={false} width={28} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(label) => fmt(String(label))} />
        <Area type="monotone" dataKey="value" stroke={TEAL} strokeWidth={2} fill="url(#trendFill)" name="Leads" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LeadsByAgent({ data }: { data: NameValue[] }) {
  const { grid, axisProps, tooltipStyle, cursorFill } = useChartTheme();
  if (!data.length) return <EmptyChart label="No agents yet" />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={grid} horizontal={false} />
        <XAxis type="number" {...axisProps} allowDecimals={false} />
        <YAxis type="category" dataKey="name" {...axisProps} width={70} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: cursorFill }} />
        <Bar dataKey="value" fill={TEAL} radius={[0, 4, 4, 0]} barSize={16} name="Leads" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RevenueByStatus({ data }: { data: { name: string; value: number }[] }) {
  const { grid, axisProps, tooltipStyle, cursorFill } = useChartTheme();
  if (!data.length) return <EmptyChart label="No revenue yet" />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={grid} horizontal={false} />
        <XAxis type="number" {...axisProps} allowDecimals={false} />
        <YAxis type="category" dataKey="name" {...axisProps} width={70} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: cursorFill }}
          formatter={(value) => [formatCurrency(Number(value)), "Revenue"]}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16} name="Revenue">
          {data.map((d) => (
            <Cell key={d.name} fill={STATUS_COLORS[d.name] ?? TEAL} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StatusDonut({ data }: { data: NameValue[] }) {
  const { tooltipStyle } = useChartTheme();
  if (!data.length) return <EmptyChart label="No leads yet" />;
  return (
    <ResponsiveContainer width="100%" height={170}>
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

export function TicketStatusDonut({ data }: { data: { name: string; value: number }[] }) {
  const { tooltipStyle } = useChartTheme();
  if (!data.length) return <EmptyChart label="No tickets yet" />;
  return (
    <ResponsiveContainer width="100%" height={170}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2} stroke="none" isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.name} fill={TICKET_COLORS[d.name] ?? TEAL} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function SiteTypeDonut({ data }: { data: NameValue[] }) {
  const { tooltipStyle } = useChartTheme();
  if (!data.length) return <EmptyChart label="No site types yet" />;
  return (
    <ResponsiveContainer width="100%" height={170}>
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
  const { grid, axisProps, tooltipStyle, cursorFill } = useChartTheme();
  const hasAny = data.some((d) => d.value > 0);
  if (!hasAny) return <EmptyChart label="No ratings yet" />;
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} allowDecimals={false} width={28} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: cursorFill }} />
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

