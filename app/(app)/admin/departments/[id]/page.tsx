import { CloserTeams } from "@/components/admin/CloserTeams";
import { getUserDirectory } from "@/lib/users/directory";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PermissionToggleGrid } from "@/components/admin/PermissionToggleGrid";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/common/BackLink";

export default async function DeptDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: dept } = await supabase
    .from("departments")
    .select("id, name, color, description, slug")
    .eq("id", id)
    .single();
  if (!dept) notFound();

  const { data: perms } = await supabase
    .from("permissions")
    .select("key, name, category, is_sensitive")
    .order("category");
  const { data: granted } = await supabase
    .from("department_permissions")
    .select("permission_key")
    .eq("department_id", id);
  const { data: members } = await supabase
    .from("department_members")
    .select("dept_role, user_id, profiles!department_members_user_id_fkey(display_name, email)")
    .eq("department_id", id);

  /*
   * The Closing department owns the org chart: each closer has a team of sales
   * agents (migration 0069). Only this department shows it — a closer IS a
   * member here, and the people they own are everyone who is not.
   */
  const isClosingDept = dept.slug === "closing";
  let closerTeams: {
    closers: { id: string; name: string }[];
    agents: { id: string; name: string }[];
    assignments: { agent_id: string; closer_id: string }[];
  } | null = null;

  if (isClosingDept) {
    const admin = createAdminClient();
    const directory = await getUserDirectory();
    const nameOf = (uid: string) => directory.find((u) => u.id === uid)?.display_name ?? "—";

    const closerIds = ((members ?? []) as { user_id: string | null }[])
      .map((m) => m.user_id)
      .filter((v): v is string => Boolean(v));
    const { data: assignments } = await admin.from("closer_assignments").select("agent_id, closer_id");
    // Assignable = active people who are NOT closers (the database refuses a
    // closer under a closer; the picker simply never offers one).
    const agents = directory
      .filter((u) => u.is_active && !closerIds.includes(u.id))
      .map((u) => ({ id: u.id, name: u.display_name ?? "—" }));

    closerTeams = {
      closers: closerIds.map((uid) => ({ id: uid, name: nameOf(uid) })),
      agents,
      assignments: (assignments ?? []) as { agent_id: string; closer_id: string }[],
    };
  }

  return (
    <div>
      <BackLink href="/admin/departments" label="Departments" />
      <div className="flex items-center gap-2 mt-2 mb-1">
        <span className="w-3.5 h-3.5 rounded-sm" style={{ background: dept.color ?? "#0D9488" }} />
        <h1 className="text-xl font-semibold text-text">{dept.name}</h1>
      </div>
      {dept.description && <p className="text-sm text-text-muted mb-5">{dept.description}</p>}

      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-wider text-text-faint mb-2 font-semibold">
          Members ({members?.length ?? 0})
        </div>
        <div className="flex flex-wrap gap-2">
          {(members ?? []).map((m: any, i: number) => (
            <span key={i} className="text-xs bg-surface border border-border rounded-full px-3 py-1 text-text-muted">
              {m.profiles?.display_name ?? m.profiles?.email}
              <span className="text-text-faint"> · {m.dept_role}</span>
            </span>
          ))}
          {(members?.length ?? 0) === 0 && (
            <span className="text-xs text-text-faint">No members yet.</span>
          )}
        </div>
      </div>

      {closerTeams && (
        <div className="mb-6">
          <div className="text-[10px] uppercase tracking-wider text-text-faint mb-1 font-semibold">
            Teams
          </div>
          <p className="mb-3 text-xs text-text-muted">
            Sales agents under each closer. A closer sees their team&apos;s leads and can act on them; every action is
            recorded against the closer. An agent belongs to one closer, and a closer is never under another closer.
          </p>
          <CloserTeams
            closers={closerTeams.closers}
            agents={closerTeams.agents}
            assignments={closerTeams.assignments}
          />
        </div>
      )}

      <div className="text-[10px] uppercase tracking-wider text-text-faint mb-2 font-semibold">
        Permissions
      </div>
      <PermissionToggleGrid
        deptId={id}
        permissions={perms ?? []}
        granted={(granted ?? []).map((g) => g.permission_key)}
      />
    </div>
  );
}
