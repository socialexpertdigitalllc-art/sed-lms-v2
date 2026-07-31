// One-time backfill of lead_status_events + leads.closed_at/dropped_at/first_touch_at.
// Idempotent: deletes source like 'backfill%' rows first; never touches 'app' rows.
// Run AFTER migration 0065 is applied and the dual-write code is deployed:
//   node --env-file=.env.local scripts/backfill-status-events.mjs
import { createClient } from "@supabase/supabase-js";
import { deriveStatusHistory } from "./backfillStatusEvents.lib.mjs";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const PAGE = 1000;

async function fetchAll(build) {
  const rows = [];
  for (let fromIdx = 0; ; fromIdx += PAGE) {
    const { data, error } = await build().range(fromIdx, fromIdx + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

const activityRows = await fetchAll(() =>
  admin
    .from("activity_log")
    .select("user_id, action, entity_id, old_value, new_value, created_at")
    .in("action", ["lead.status_changed", "lead.updated", "lead.bulk_status"])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
);
const leads = await fetchAll(() =>
  admin.from("leads").select("id, status, updated_at").order("id", { ascending: true })
);
const followUps = await fetchAll(() =>
  admin.from("lead_follow_ups").select("lead_id, created_at").order("id", { ascending: true })
);
console.log(`inputs: ${activityRows.length} log rows, ${leads.length} leads, ${followUps.length} follow-ups`);

const { events, patches } = deriveStatusHistory({ activityRows, leads, followUps });
const approx = events.filter((e) => e.source === "backfill_approx").length;
console.log(`derived: ${events.length} events (${approx} approx), ${patches.length} lead patches`);

const { error: delError } = await admin
  .from("lead_status_events")
  .delete()
  .like("source", "backfill%");
if (delError) throw new Error(`cleanup failed: ${delError.message}`);

for (let i = 0; i < events.length; i += 500) {
  const { error } = await admin.from("lead_status_events").insert(events.slice(i, i + 500));
  if (error) throw new Error(`event insert failed at ${i}: ${error.message}`);
}

let patched = 0;
for (let i = 0; i < patches.length; i += 20) {
  await Promise.all(
    patches.slice(i, i + 20).map(async ({ id, ...fields }) => {
      const { error } = await admin.from("leads").update(fields).eq("id", id);
      if (error) throw new Error(`lead patch failed for ${id}: ${error.message}`);
      patched++;
    })
  );
}
console.log(`done: ${events.length} events inserted, ${patched} leads patched`);
