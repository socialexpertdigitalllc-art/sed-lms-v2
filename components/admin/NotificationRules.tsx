"use client";

import { useState } from "react";
import { departmentSlugs } from "@/lib/notifications/logic";
import type { NotificationRule } from "@/lib/notifications/types";

type EventMeta = {
  key: string;
  label: string;
  description?: string;
  bell: "website" | "general";
  availableRoles: readonly string[];
  timingMode: "lead_time" | "delay" | "none";
};

type UserOption = { id: string; display_name: string | null };

type RuleState = {
  enabled: boolean;
  target_departments: string[];
  target_users: string[];
  target_roles: string[];
  delay_minutes: number;
};

const inputCls =
  "w-20 px-2 py-1.5 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";

function chipCls(on: boolean) {
  return (
    "px-3 py-1.5 text-sm font-medium rounded-full border transition-colors " +
    (on
      ? "bg-accent-soft text-accent-ink border-accent"
      : "bg-surface-2 text-text-muted border-border hover:bg-surface")
  );
}

const DEPT_LABEL: Record<string, string> = {
  sales: "Sales",
  management: "Management",
  tech: "Tech",
  support: "Support",
  admin: "Admin",
};

const ROLE_LABEL: Record<string, string> = {
  lead_agent: "Lead agent",
  lead_closer: "Lead closer",
  ticket_assignee: "Ticket assignee",
  ticket_creator: "Ticket creator",
  feedback_submitter: "Feedback submitter",
};

function toggleIn(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function initialState(rule: NotificationRule | undefined): RuleState {
  return {
    enabled: rule?.enabled ?? true,
    // older rules name departments ("Admin"); the chips are slugs ("admin")
    target_departments: departmentSlugs(rule?.target_departments ?? []),
    target_users: rule?.target_users ?? [],
    target_roles: rule?.target_roles ?? [],
    delay_minutes: rule?.delay_minutes ?? 0,
  };
}

function EventCard({
  event,
  rule,
  departments,
  users,
}: {
  event: EventMeta;
  rule: NotificationRule | undefined;
  departments: readonly string[];
  users: UserOption[];
}) {
  const [state, setState] = useState<RuleState>(() => initialState(rule));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/notification-rules/${event.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Failed to save" });
        return;
      }
      setMsg({ ok: true, text: "Saved" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text">{event.label}</span>
            <span
              className={
                "text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded " +
                (event.bell === "website"
                  ? "bg-accent-soft text-accent-ink"
                  : "bg-surface-2 text-text-faint border border-border")
              }
            >
              {event.bell === "website" ? "Website" : "General"}
            </span>
          </div>
          {event.description && (
            <p className="text-xs text-text-muted mt-0.5">{event.description}</p>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-text shrink-0">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => setState((s) => ({ ...s, enabled: e.target.checked }))}
            className="accent-accent w-4 h-4"
          />
          Enabled
        </label>
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-1.5">
            Departments
          </div>
          <div className="flex flex-wrap gap-1.5">
            {departments.map((slug) => (
              <button
                key={slug}
                type="button"
                onClick={() =>
                  setState((s) => ({ ...s, target_departments: toggleIn(s.target_departments, slug) }))
                }
                className={chipCls(state.target_departments.includes(slug))}
              >
                {DEPT_LABEL[slug] ?? slug}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-1.5">
            Users
          </div>
          {users.length === 0 ? (
            <p className="text-xs text-text-faint">No active users.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, target_users: toggleIn(s.target_users, u.id) }))}
                  className={chipCls(state.target_users.includes(u.id))}
                >
                  {u.display_name ?? u.id}
                </button>
              ))}
            </div>
          )}
        </div>

        {event.availableRoles.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-1.5">
              Roles
            </div>
            <div className="flex flex-wrap gap-1.5">
              {event.availableRoles.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setState((s) => ({ ...s, target_roles: toggleIn(s.target_roles, role) }))}
                  className={chipCls(state.target_roles.includes(role))}
                >
                  {ROLE_LABEL[role] ?? role}
                </button>
              ))}
            </div>
          </div>
        )}

        {event.timingMode !== "none" && (
          <label className="flex items-center gap-2 text-xs text-text-muted w-fit">
            {event.timingMode === "lead_time" ? "Minutes before" : "Delay (minutes)"}
            <input
              type="number"
              min={0}
              value={state.delay_minutes}
              onChange={(e) => setState((s) => ({ ...s, delay_minutes: Math.max(0, Number(e.target.value) || 0) }))}
              className={inputCls}
            />
          </label>
        )}
      </div>

      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border-subtle">
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-accent text-white hover:bg-accent-ink disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {msg && (
          <span className={"text-xs " + (msg.ok ? "text-ready-fg" : "text-dropped-fg")}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}

export function NotificationRules({
  rules,
  events,
  users,
  departments,
}: {
  rules: NotificationRule[];
  events: EventMeta[];
  users: UserOption[];
  departments: readonly string[];
}) {
  const ruleByKey = new Map(rules.map((r) => [r.event_key, r]));
  const websiteEvents = events.filter((e) => e.bell === "website");
  const generalEvents = events.filter((e) => e.bell === "general");

  const renderGroup = (label: string, group: EventMeta[]) =>
    group.length > 0 && (
      <div className="mb-6 last:mb-0">
        <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-2">
          {label}
        </div>
        <div className="space-y-3">
          {group.map((ev) => (
            <EventCard
              key={ev.key}
              event={ev}
              rule={ruleByKey.get(ev.key)}
              departments={departments}
              users={users}
            />
          ))}
        </div>
      </div>
    );

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-text">Notification Rules</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Choose who gets notified for each event — by department, specific users, or
          contextual role — and how far in advance or how delayed.
        </p>
      </div>

      {renderGroup("Website bell", websiteEvents)}
      {renderGroup("General bell", generalEvents)}
    </div>
  );
}
