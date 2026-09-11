import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ttlCached } from "@/lib/cache/ttl";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { allowedTicketScope, ticketInScope } from "@/lib/tickets/scope";
import { allowedFormScope } from "@/lib/forms/access";

/**
 * Sidebar badge counts. Returns ONLY the keys the caller's permissions allow —
 * the sidebar renders a badge for each key it receives, so omitting a key hides
 * its badge. User-scoped entities (leads, pre_leads) use the RLS user client so
 * the counts match exactly what the user can see; admin entities use the
 * service-role client behind an explicit permission gate.
 *
 * Each count is fail-soft: a query error omits just that key rather than 500-ing
 * the whole response. All counts run concurrently via Promise.all.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 30s per-user cache with inflight dedup. The badge counts are RLS-heavy
  // (the leads count alone measured ~335ms — disk-IO budget incident,
  // 2026-08-17) and every open tab refetches on the same realtime bumps, so
  // coalescing a user's tabs and bursts into one query set per window is a
  // large IO cut for ≤30s of badge staleness.
  const counts = await ttlCached("nav-counts", user.id, 30_000, () => computeCounts(user.id));
  return NextResponse.json({ counts });
}

async function computeCounts(userId: string): Promise<Record<string, number>> {
  const supabase = await createClient();
  const perms = await getUserPermissions(userId);
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const counts: Record<string, number> = {};

  // Compute one badge count into `counts[key]`; swallow errors so a single
  // failing query drops only its badge.
  async function run(key: string, fn: () => Promise<number>): Promise<void> {
    try {
      counts[key] = await fn();
    } catch {
      /* fail-soft — omit this key */
    }
  }

  const tasks: Promise<void>[] = [];

  if (perms.has("leads.view")) {
    // Visible, non-deleted leads (RLS-scoped to what the user can see).
    tasks.push(
      run("leads", async () => {
        const { count, error } = await supabase
          .from("leads")
          .select("*", { count: "exact", head: true })
          .is("deleted_at", null);
        if (error) throw error;
        return count ?? 0;
      })
    );
    // Overdue actionable follow-ups. Scoped to Ready — the ONLY status the
    // Follow-ups page shows (operator decision, 2026-09-11) — so the badge
    // counts the same population the page does; a badge that disagrees with
    // its page erodes trust in every other badge.
    tasks.push(
      run("followups", async () => {
        const { count, error } = await supabase
          .from("leads")
          .select("*", { count: "exact", head: true })
          .is("deleted_at", null)
          .lt("follow_up_time", nowIso)
          .eq("status", "Ready");
        if (error) throw error;
        return count ?? 0;
      })
    );
  }

  if (perms.has("tickets.view")) {
    // Unresolved tickets within the caller's ticket scope. For scoped users we
    // fetch the minimal columns and count in JS with ticketInScope (robust —
    // avoids an unbounded lead_id IN() list in the query string).
    tasks.push(
      run("tickets", async () => {
        const scope = await allowedTicketScope(admin, userId, perms);
        if (scope.all) {
          const { count, error } = await admin
            .from("lead_tickets")
            .select("*", { count: "exact", head: true })
            .neq("status", "Resolved");
          if (error) throw error;
          return count ?? 0;
        }
        const { data, error } = await admin
          .from("lead_tickets")
          .select("created_by, lead_id")
          .neq("status", "Resolved");
        if (error) throw error;
        return (data ?? []).filter((t) =>
          ticketInScope(t as { created_by: string | null; lead_id: string }, userId, scope)
        ).length;
      })
    );
  }

  if (perms.has("feedback.manage")) {
    tasks.push(
      run("feedback", async () => {
        const { count, error } = await admin
          .from("feedback")
          .select("*", { count: "exact", head: true })
          .eq("status", "Open");
        if (error) throw error;
        return count ?? 0;
      })
    );
  }

  if (perms.has("payments.view")) {
    tasks.push(
      run("payments", async () => {
        const { count, error } = await admin
          .from("payment_links")
          .select("*", { count: "exact", head: true })
          .eq("is_active", true);
        if (error) throw error;
        return count ?? 0;
      })
    );
  }

  if (perms.has("forms.view") || perms.has("forms.manage")) {
    // Unread, non-spam website form submissions in the user's scope.
    tasks.push(
      run("forms", async () => {
        const scope = await allowedFormScope(admin, userId, perms);
        let q = admin.from("form_submissions").select("*", { count: "exact", head: true }).is("read_at", null).eq("is_spam", false);
        if (!scope.all) {
          const ids = [...scope.leadIds];
          if (scope.manage) {
            // Scoped managers also see lead-less endpoints' submissions —
            // the badge must count what the inbox shows (same branch as
            // app/api/forms/submissions/route.ts).
            q = ids.length ? q.or(`lead_id.in.(${ids.join(",")}),lead_id.is.null`) : q.is("lead_id", null);
          } else {
            if (!ids.length) return 0;
            q = q.in("lead_id", ids);
          }
        }
        const { count, error } = await q;
        if (error) throw error;
        return count ?? 0;
      })
    );
  }

  if (perms.has("pre_leads.view")) {
    tasks.push(
      run("preleads", async () => {
        const { count, error } = await supabase
          .from("pre_leads")
          .select("*", { count: "exact", head: true })
          .is("deleted_at", null);
        if (error) throw error;
        return count ?? 0;
      })
    );
  }

  if (perms.has("admin.users.view")) {
    tasks.push(
      run("users", async () => {
        const { count, error } = await admin
          .from("profiles")
          .select("*", { count: "exact", head: true })
          .eq("is_active", true);
        if (error) throw error;
        return count ?? 0;
      })
    );
  }

  if (perms.has("admin.departments.manage")) {
    tasks.push(
      run("departments", async () => {
        const { count, error } = await admin
          .from("departments")
          .select("*", { count: "exact", head: true })
          .eq("is_active", true);
        if (error) throw error;
        return count ?? 0;
      })
    );
  }

  if (perms.has("admin.settings.manage")) {
    tasks.push(
      run("addons", async () => {
        const { count, error } = await admin
          .from("website_addons")
          .select("*", { count: "exact", head: true })
          .eq("is_active", true);
        if (error) throw error;
        return count ?? 0;
      })
    );
  }

  await Promise.all(tasks);

  return counts;
}
