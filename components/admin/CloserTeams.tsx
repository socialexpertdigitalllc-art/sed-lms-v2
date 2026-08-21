"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserMinus, Users } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { Select } from "@/components/common/Select";
import { btnSecondarySm } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";

export interface TeamPerson {
  id: string;
  name: string;
}

/**
 * The closer -> sales-agent org chart, edited in place on the Closing
 * department screen.
 *
 * Structure rules live in the database (migration 0069): an agent has ONE
 * closer, and a closer is never under another closer. This screen therefore
 * shows an agent under exactly one closer, moves them on reassignment rather
 * than duplicating, and surfaces the database's refusal verbatim if anything
 * slips past the filtered picker.
 */
export function CloserTeams({
  closers,
  agents,
  assignments,
}: {
  closers: TeamPerson[];
  /** Assignable sales agents (closers are excluded server-side). */
  agents: TeamPerson[];
  assignments: { agent_id: string; closer_id: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});

  const byCloser = useMemo(() => {
    const map: Record<string, TeamPerson[]> = {};
    for (const c of closers) map[c.id] = [];
    for (const a of assignments) {
      const person = agents.find((p) => p.id === a.agent_id);
      if (person && map[a.closer_id]) map[a.closer_id].push(person);
    }
    for (const list of Object.values(map)) list.sort((x, y) => x.name.localeCompare(y.name));
    return map;
  }, [closers, agents, assignments]);

  const closerOf = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of assignments) map[a.agent_id] = a.closer_id;
    return map;
  }, [assignments]);

  const unassigned = useMemo(() => agents.filter((a) => !closerOf[a.id]), [agents, closerOf]);

  async function assign(closerId: string) {
    const agentId = picked[closerId];
    if (!agentId) return;
    setBusy(closerId);
    try {
      const res = await fetch("/api/admin/closer-teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agentId, closer_id: closerId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not add to the team" });
        return;
      }
      setPicked((p) => ({ ...p, [closerId]: "" }));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove(agentId: string) {
    setBusy(agentId);
    try {
      const res = await fetch(`/api/admin/closer-teams?agent_id=${encodeURIComponent(agentId)}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({ kind: "error", title: body.error ?? "Could not remove from the team" });
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (closers.length === 0) {
    return (
      <p className="text-xs text-text-faint">
        No closers yet — add members to this department first, then assign their sales agents here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {closers.map((closer) => {
        const team = byCloser[closer.id] ?? [];
        // A closer can take an agent from another closer (it MOVES them), so
        // offer everyone except this closer's own team.
        const choices = agents.filter((a) => closerOf[a.id] !== closer.id);
        return (
          <div key={closer.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-text-faint" />
              <span className="text-sm font-semibold text-text">{closer.name}</span>
              <span className="text-xs text-text-faint">
                {team.length} agent{team.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {team.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-text"
                >
                  {a.name}
                  <button
                    type="button"
                    aria-label={`Remove ${a.name} from ${closer.name}'s team`}
                    title="Remove from this team"
                    disabled={busy !== null}
                    onClick={() => void remove(a.id)}
                    className="text-text-faint hover:text-dropped-fg disabled:opacity-50"
                  >
                    {busy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserMinus className="h-3 w-3" />}
                  </button>
                </span>
              ))}
              {team.length === 0 && <span className="text-xs text-text-faint">No sales agents yet.</span>}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Select
                aria-label={`Add a sales agent to ${closer.name}'s team`}
                value={picked[closer.id] ?? ""}
                onChange={(e) => setPicked((p) => ({ ...p, [closer.id]: e.target.value }))}
                className={inputCls + " min-w-[240px]"}
              >
                <option value="">Add a sales agent…</option>
                {choices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {closerOf[a.id] ? `${a.name} (move from another closer)` : a.name}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                className={btnSecondarySm}
                disabled={!picked[closer.id] || busy !== null}
                onClick={() => void assign(closer.id)}
              >
                {busy === closer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
              </button>
            </div>
          </div>
        );
      })}

      {unassigned.length > 0 && (
        <p className="text-xs text-text-faint">
          Not on any team yet: {unassigned.map((a) => a.name).join(", ")}
        </p>
      )}
    </div>
  );
}
