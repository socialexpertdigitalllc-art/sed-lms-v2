"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Lead } from "@/lib/leads/types";
import { StatusPill } from "@/components/leads/StatusPill";
import { formatCompactCurrency, initials } from "@/lib/leads/format";
import { LiveLeadsGate } from "@/components/leads/LiveLeads";

/**
 * By Agent on the live leads store (hooks/useLiveLeads.ts): the cards update
 * by themselves when anyone changes a lead, and the page no longer re-reads
 * every lead on each visit — it shares the browser's copy with Leads,
 * Follow-ups and the Dashboard.
 */
export function ByAgentBoard({ nameById }: { nameById: Record<string, string> }) {
  return <LiveLeadsGate>{(leads) => <Cards leads={leads} nameById={nameById} />}</LiveLeadsGate>;
}

function Cards({ leads, nameById }: { leads: Lead[]; nameById: Record<string, string> }) {
  const cards = useMemo(() => {
    const groups = new Map<string, Lead[]>();
    for (const l of leads) {
      const name = (l.agent_id && nameById[l.agent_id]) || "Unassigned";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push(l);
    }
    return [...groups.entries()]
      .map(([name, ls]) => ({
        name,
        total: ls.length,
        ready: ls.filter((l) => l.status === "Ready").length,
        closed: ls.filter((l) => l.status === "Closed").length,
        revenue: ls.reduce((s, l) => s + (l.price_quoted ?? 0), 0),
        recent: ls.slice(0, 5),
      }))
      .sort((a, b) => b.total - a.total);
  }, [leads, nameById]);

  return (
    <div>
      <h1 className="text-xl font-semibold text-text mb-1">By agent</h1>
      <p className="text-sm text-text-muted mb-5">Pipeline broken down by who owns each lead.</p>

      {cards.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-10 text-center text-text-faint text-sm">
          No leads yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {cards.map((c) => (
            <div key={c.name} className="bg-surface border border-border rounded-lg p-5">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-sm font-semibold">
                  {initials(c.name)}
                </span>
                <div>
                  <div className="font-semibold text-text">{c.name}</div>
                  <div className="text-xs text-text-faint">{c.total} {c.total === 1 ? "lead" : "leads"}</div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-sm font-mono font-semibold text-text">{formatCompactCurrency(c.revenue)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">quoted</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-4">
                <Stat label="Total" value={c.total} />
                <Stat label="Ready" value={c.ready} tone="text-ready-fg" />
                <Stat label="Closed" value={c.closed} tone="text-closed-fg" />
              </div>

              <div className="overflow-x-auto">
              <table className="w-full text-sm mt-4">
                <tbody>
                  {c.recent.map((l) => (
                    <tr key={l.id} className="border-t border-border-subtle">
                      <td className="py-2">
                        <Link href={`/leads/${l.id}`} className="text-text hover:text-accent-ink font-medium">
                          {l.business_name}
                        </Link>
                      </td>
                      <td className="py-2"><StatusPill status={l.status} /></td>
                      <td className="py-2 text-right font-mono text-text-muted text-xs">
                        {formatCompactCurrency(l.price_quoted ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "text-text" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="bg-surface-2 border border-border rounded-md px-3 py-2">
      <div className={"text-lg font-semibold font-mono " + tone}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-text-faint">{label}</div>
    </div>
  );
}
