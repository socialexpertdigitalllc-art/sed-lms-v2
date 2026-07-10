import Link from "next/link";

/** Rows come straight from a Supabase nested select; the client infers nested
 *  embeds loosely, so we accept the dynamic shape and read it defensively. */
type UserRow = {
  id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  department_members: any[] | null;
};

export function UserTable({ users }: { users: UserRow[] }) {
  if (users.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-lg p-10 text-center text-text-faint text-sm">
        No users yet. Create the first one.
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-text-faint border-b border-border">
            <th className="px-4 py-3 font-semibold">#</th>
            <th className="px-4 py-3 font-semibold">User</th>
            <th className="px-4 py-3 font-semibold">Departments</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Created</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={u.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-2">
              <td className="px-4 py-3">
                <span className="text-text-faint text-xs tabular-nums">{i + 1}</span>
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-text">
                  {u.display_name ?? "—"}
                  {u.username && <span className="font-mono text-xs text-text-faint ml-2">@{u.username}</span>}
                </div>
                <div className="text-text-faint text-xs">{u.email}</div>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {(u.department_members ?? []).map((m, i) => (
                    <span
                      key={i}
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: (m.departments?.color ?? "#0D9488") + "22",
                        color: m.departments?.color ?? "#0D9488",
                      }}
                    >
                      {m.departments?.name}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-4 py-3">
                {u.is_active ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-ready-bg text-ready-fg">
                    Active
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-dropped-bg text-dropped-fg">
                    Inactive
                  </span>
                )}
              </td>
              <td className="px-4 py-3 font-mono text-text-muted text-xs">
                {new Date(u.created_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-right">
                <Link href={`/admin/users/${u.id}`} className="text-accent-ink text-xs font-medium hover:underline">
                  Manage
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
