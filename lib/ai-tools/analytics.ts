import type { AiGeneration } from "./types";
import type { NameValue } from "@/lib/leads/analytics";

export interface AiKpis {
  total: number;
  success: number;
  failed: number;
  successRate: number; // 0..1
  totalPages: number;
  totalTokens: number;
  totalCost: number;
  avgTimeSec: number; // average successful generation time
}

export function computeAiKpis(rows: AiGeneration[]): AiKpis {
  let success = 0;
  let failed = 0;
  let totalPages = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let timeSum = 0;
  let timeCount = 0;

  for (const r of rows) {
    if (r.status === "success") success++;
    else if (r.status === "failed") failed++;
    totalPages += r.num_files ?? r.num_pages ?? 0;
    totalTokens += r.tokens_used ?? 0;
    totalCost += Number(r.cost_usd ?? 0);
    if (r.status === "success" && r.total_time_ms) {
      timeSum += r.total_time_ms;
      timeCount++;
    }
  }

  const completed = success + failed;
  return {
    total: rows.length,
    success,
    failed,
    successRate: completed ? success / completed : 0,
    totalPages,
    totalTokens,
    totalCost,
    avgTimeSec: timeCount ? timeSum / timeCount / 1000 : 0,
  };
}

export function byTool(rows: AiGeneration[]): NameValue[] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.tool, (map.get(r.tool) ?? 0) + 1);
  return [...map.entries()].map(([name, value]) => ({ name, value }));
}

export function byModel(rows: AiGeneration[]): NameValue[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const m = r.model ?? "unknown";
    map.set(m, (map.get(m) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export function byAgent(rows: AiGeneration[], agentNameById: Record<string, string>): NameValue[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const name = (r.agent_id && agentNameById[r.agent_id]) || "Unknown";
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

/** Generations per day over the trailing window (UTC day buckets). */
export function generationsOverTime(rows: AiGeneration[], days = 30, now: Date = new Date()): NameValue[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  const perDay = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    perDay.set(key(d), 0);
  }
  for (const r of rows) {
    if (!r.created_at) continue;
    const d = new Date(r.created_at);
    if (Number.isNaN(d.getTime()) || d < start) continue;
    const k = key(d);
    if (perDay.has(k)) perDay.set(k, perDay.get(k)! + 1);
  }
  return [...perDay.entries()].map(([name, value]) => ({ name, value }));
}

function key(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
