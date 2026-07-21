import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { statusSetError } from "@/lib/leads/categories";
import { isReadyGuardError, READY_GUARD_MESSAGE } from "@/lib/leads/errors";
import { buildTagLinkRows } from "@/lib/leads/tagFilter";
import { cancelGenerationsForLeads } from "@/lib/template-engine/forceResolve";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["status", "assign", "archive", "tag"]),
  value: z.string().optional(),
});

const PERM: Record<string, string> = {
  status: "leads.status_change",
  assign: "leads.assign",
  archive: "leads.delete",
  tag: "leads.tags.manage",
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 422 });
  const { ids, action, value } = parsed.data;

  const perms = await getUserPermissions(user.id);
  if (!perms.has(PERM[action])) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();

  // Bulk tag: ADD the caller's own tags to every selected lead (never a replace,
  // never touches the `leads` table). Branches out before the leads.update below.
  if (action === "tag") {
    const tagIds = Array.from(
      new Set((value ?? "").split(",").map((s) => s.trim()).filter(Boolean))
    );
    if (tagIds.length === 0) {
      return NextResponse.json({ error: "Select at least one tag." }, { status: 422 });
    }
    // Tags are user-scoped: a user may only apply their OWN tags.
    const { data: owned } = await admin
      .from("lead_tags")
      .select("id")
      .in("id", tagIds)
      .eq("owner_id", user.id);
    if ((owned?.length ?? 0) !== tagIds.length) {
      return NextResponse.json({ error: "You can only apply your own tags." }, { status: 422 });
    }
    // Cartesian product ids × tagIds; existing links are left intact (idempotent).
    const rows = buildTagLinkRows(ids, tagIds, user.id);
    const { error: tagError } = await admin
      .from("lead_tag_links")
      .upsert(rows, { onConflict: "lead_id,tag_id", ignoreDuplicates: true });
    if (tagError) return NextResponse.json({ error: tagError.message }, { status: 400 });

    await admin.from("activity_log").insert({
      user_id: user.id,
      action: "lead.bulk_tag",
      entity_type: "lead",
      new_value: { ids, tagIds, count: ids.length },
    });

    return NextResponse.json({ ok: true, updated: ids.length });
  }

  let update: Record<string, unknown>;
  if (action === "status") {
    if (!value) return NextResponse.json({ error: "A status is required" }, { status: 422 });
    // Same per-category gate as single-lead status changes — the bulk path is
    // not a backdoor around leads.cat_set.*.
    const gateError = statusSetError(perms, value);
    if (gateError) return NextResponse.json({ error: gateError }, { status: 403 });
    update = { status: value };
  } else if (action === "assign") {
    if (value) {
      const { data: salesDept } = await admin
        .from("departments")
        .select("id")
        .eq("slug", "sales")
        .single();
      const { data: membership } = salesDept
        ? await admin
            .from("department_members")
            .select("user_id")
            .eq("department_id", salesDept.id)
            .eq("user_id", value)
            .maybeSingle()
        : { data: null };
      if (!membership) {
        return NextResponse.json(
          { error: "Leads can only be bulk-assigned to Sales department members." },
          { status: 422 }
        );
      }
    }
    update = { agent_id: value ? value : null };
  } else {
    update = { deleted_at: new Date().toISOString() };
  }

  const { error, count } = await admin
    .from("leads")
    .update(update, { count: "exact" })
    .in("id", ids)
    .is("deleted_at", null);
  if (error) {
    if (isReadyGuardError(error)) {
      return NextResponse.json(
        { error: `${READY_GUARD_MESSAGE} (one or more selected leads has no website link)` },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Same ghost-build cleanup as the single-lead DELETE: a soft-deleted lead
  // leaves its in-flight generations running (and wedging the single-flight
  // queue) with no UI left to stop them. Best-effort and non-fatal — the leads
  // are already deleted at this point.
  if (action === "archive") {
    const stopped = await cancelGenerationsForLeads(admin, ids);
    if (stopped > 0) console.info(`[leads] stopped ${stopped} in-flight generation(s) for ${ids.length} deleted lead(s)`);
  }

  await admin.from("activity_log").insert({
    user_id: user.id,
    action: `lead.bulk_${action}`,
    entity_type: "lead",
    new_value: { ids, action, value: value ?? null, count: count ?? ids.length },
  });

  return NextResponse.json({ ok: true, updated: count ?? ids.length });
}
