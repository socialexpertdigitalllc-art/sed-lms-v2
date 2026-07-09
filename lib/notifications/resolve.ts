import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationRule, NotifyContext, ContextualRole } from "@/lib/notifications/types";

function roleValue(role: ContextualRole, ctx: NotifyContext): string | null {
  switch (role) {
    case "lead_agent": return ctx.lead?.agent_id ?? null;
    case "lead_closer": return ctx.lead?.closed_by ?? null;
    case "ticket_assignee": return ctx.ticket?.assigned_to ?? null;
    case "ticket_creator": return ctx.ticket?.created_by ?? null;
    case "feedback_submitter": return ctx.feedback?.user_id ?? null;
    default: return null;
  }
}

export function expandTargets(rule: NotificationRule, ctx: NotifyContext, deptMembers: Record<string, string[]>): string[] {
  if (!rule.enabled) return [];
  const ids = new Set<string>();
  for (const slug of rule.target_departments) for (const id of deptMembers[slug] ?? []) ids.add(id);
  for (const u of rule.target_users) ids.add(u);
  for (const role of rule.target_roles) { const v = roleValue(role, ctx); if (v) ids.add(v); }
  if (ctx.actorId) ids.delete(ctx.actorId);
  return [...ids];
}

export async function resolveRecipients(rule: NotificationRule, ctx: NotifyContext): Promise<string[]> {
  const deptMembers: Record<string, string[]> = {};
  if (rule.enabled && rule.target_departments.length) {
    const admin = createAdminClient();
    const { data: depts } = await admin.from("departments").select("id, slug").in("slug", rule.target_departments);
    const idToSlug = new Map((depts ?? []).map((d) => [d.id, d.slug]));
    const { data: mem } = await admin.from("department_members")
      .select("department_id, user_id, profiles!department_members_user_id_fkey(id)")
      .in("department_id", (depts ?? []).map((d) => d.id));
    for (const m of mem ?? []) {
      const slug = idToSlug.get((m as any).department_id); if (!slug) continue;
      (deptMembers[slug] ??= []).push((m as any).user_id);
    }
  }
  return expandTargets(rule, ctx, deptMembers);
}
