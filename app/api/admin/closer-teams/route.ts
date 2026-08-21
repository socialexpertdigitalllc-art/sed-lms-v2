import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserPermissions } from "@/lib/permissions/resolver";
import { invalidateCloserTeams } from "@/lib/teams/closers";

export const runtime = "nodejs";

/**
 * Who owns which sales agent (see lib/teams/closers.ts). Managing the org
 * chart is an admin action — the hierarchy decides who can see and act on
 * whose leads, so it sits behind the same gate as department membership.
 *
 * The two structural rules (one closer per agent, no closer under a closer)
 * are enforced by the database (migration 0069). This route surfaces those
 * failures as readable messages instead of re-implementing them.
 */
async function guard(): Promise<{ error: 401 | 403 } | { userId: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 401 };
  const perms = await getUserPermissions(user.id);
  if (!perms.has("admin.departments.manage")) return { error: 403 };
  return { userId: user.id };
}

const assignSchema = z.object({
  agent_id: z.string().uuid(),
  closer_id: z.string().uuid(),
});

/** GET — every assignment, for the Closing department screen. */
export async function GET() {
  const auth = await guard();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.from("closer_assignments").select("agent_id, closer_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ assignments: data ?? [] });
}

/** POST — put an agent under a closer (moves them if they already had one). */
export async function POST(req: Request) {
  const auth = await guard();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });
  }
  const parsed = assignSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "agent_id and closer_id are required" }, { status: 422 });
  const { agent_id, closer_id } = parsed.data;

  const admin = createAdminClient();
  // Upsert on the PK: reassigning an agent MOVES them rather than failing,
  // which is what "add this person to my team" means to an admin.
  const { error } = await admin
    .from("closer_assignments")
    .upsert({ agent_id, closer_id, assigned_by: auth.userId }, { onConflict: "agent_id" });
  if (error) {
    // The trigger's messages are already operator-readable.
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  invalidateCloserTeams();

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "closer.team.assigned",
    entity_type: "closer_assignment",
    entity_id: agent_id,
    new_value: { agent_id, closer_id },
  });
  return NextResponse.json({ ok: true });
}

/** DELETE ?agent_id= — take an agent off their closer's team. */
export async function DELETE(req: Request) {
  const auth = await guard();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error === 401 ? "Unauthorized" : "Forbidden" }, { status: auth.error });
  }
  const agentId = new URL(req.url).searchParams.get("agent_id") ?? "";
  if (!agentId) return NextResponse.json({ error: "agent_id is required" }, { status: 422 });

  const admin = createAdminClient();
  const { error } = await admin.from("closer_assignments").delete().eq("agent_id", agentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  invalidateCloserTeams();

  await admin.from("activity_log").insert({
    user_id: auth.userId,
    action: "closer.team.unassigned",
    entity_type: "closer_assignment",
    entity_id: agentId,
    new_value: { agent_id: agentId },
  });
  return NextResponse.json({ ok: true });
}
