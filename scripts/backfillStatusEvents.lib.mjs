// Pure reconstruction of lead status history from activity_log rows.
// Imported by scripts/backfill-status-events.mjs (node) AND unit tests (vitest).
// Inputs:
//   activityRows: { user_id, action, entity_id, old_value, new_value, created_at }[]
//     sorted ascending by created_at; actions limited to lead.status_changed /
//     lead.updated / lead.bulk_status.
//   leads:     { id, status, updated_at }[]  (every lead, incl. soft-deleted)
//   followUps: { lead_id, created_at }[]
// Output:
//   events:  rows for lead_status_events (source backfill | backfill_approx)
//   patches: { id, closed_at, dropped_at, first_touch_at }[] — only leads
//            where at least one field is non-null.

export function deriveStatusHistory({ activityRows, leads, followUps }) {
  const events = [];
  const byLead = new Map(); // lead_id -> events for that lead, chronological
  const lastStatus = new Map(); // lead_id -> last known status

  const push = (leadId, to, from, userId, at, source) => {
    if (!leadId || to == null) return;
    if (lastStatus.get(leadId) === to) return; // no-op transition
    const ev = {
      lead_id: leadId,
      // undefined = "row logged no explicit prior status" → carry the running
      // last-known status; an explicit null means the log really said null.
      from_status: from !== undefined ? from : lastStatus.get(leadId) ?? null,
      to_status: to,
      changed_by: userId ?? null,
      changed_at: at,
      source,
    };
    events.push(ev);
    if (!byLead.has(leadId)) byLead.set(leadId, []);
    byLead.get(leadId).push(ev);
    lastStatus.set(leadId, to);
  };

  for (const r of activityRows) {
    if (r.action === "lead.status_changed" || r.action === "lead.updated") {
      const to = r.new_value?.status;
      if (to === undefined) continue; // lead.updated without a status change
      const from = r.old_value && "status" in r.old_value ? r.old_value.status : undefined;
      push(r.entity_id, to, from, r.user_id, r.created_at, "backfill");
    } else if (r.action === "lead.bulk_status") {
      const ids = Array.isArray(r.new_value?.ids) ? r.new_value.ids : [];
      for (const id of ids) push(id, r.new_value?.value, undefined, r.user_id, r.created_at, "backfill");
    }
  }

  const firstTouch = new Map();
  for (const f of followUps) {
    const cur = firstTouch.get(f.lead_id);
    if (!cur || f.created_at < cur) firstTouch.set(f.lead_id, f.created_at);
  }

  const patches = [];
  for (const l of leads) {
    let terminalAt = null;
    if (l.status === "Closed" || l.status === "Dropped") {
      const evs = byLead.get(l.id) ?? [];
      // Scan backward: a lead can bounce in and out of Closed/Dropped —
      // the LATEST entry into the current status is the true exit moment.
      for (let i = evs.length - 1; i >= 0; i--) {
        if (evs[i].to_status === l.status) { terminalAt = evs[i].changed_at; break; }
      }
      if (!terminalAt) {
        // Legacy/imported lead with no trace: approximate from updated_at.
        const ev = {
          lead_id: l.id, from_status: null, to_status: l.status,
          changed_by: null, changed_at: l.updated_at, source: "backfill_approx",
        };
        events.push(ev);
        terminalAt = l.updated_at;
      }
    }
    const patch = {
      id: l.id,
      closed_at: l.status === "Closed" ? terminalAt : null,
      dropped_at: l.status === "Dropped" ? terminalAt : null,
      first_touch_at: firstTouch.get(l.id) ?? null,
    };
    if (patch.closed_at || patch.dropped_at || patch.first_touch_at) patches.push(patch);
  }

  return { events, patches };
}
