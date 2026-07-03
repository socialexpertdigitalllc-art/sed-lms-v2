import { createClient } from "@/lib/supabase/server";

export default async function PermissionsPage() {
  const supabase = await createClient();
  const { data: perms } = await supabase
    .from("permissions")
    .select("key, name, category, is_sensitive")
    .order("category");
  const { data: dp } = await supabase
    .from("department_permissions")
    .select("permission_key, departments(name)");

  const byKey = (dp ?? []).reduce<Record<string, string[]>>((acc, r: any) => {
    (acc[r.permission_key] ??= []).push(r.departments?.name);
    return acc;
  }, {});

  const list = perms ?? [];
  const groups: Record<string, typeof list> = {};
  for (const p of list) {
    (groups[p.category] ??= []).push(p);
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-text mb-1">Permissions</h1>
      <p className="text-sm text-text-muted mb-5">
        The full catalogue and which departments grant each. Manage grants on each department&apos;s page.
      </p>
      <div className="space-y-5">
        {Object.entries(groups).map(([cat, list]) => (
          <div key={cat} className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 text-[10px] uppercase tracking-wider text-text-faint font-semibold bg-surface-2 border-b border-border">
              {cat.replace("_", " ")}
            </div>
            <div className="divide-y divide-border-subtle">
              {(list ?? []).map((p) => (
                <div key={p.key} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="text-sm text-text">
                      {p.name}
                      {p.is_sensitive && (
                        <span className="ml-2 text-[10px] text-dropped-fg uppercase">sensitive</span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-text-faint">{p.key}</div>
                  </div>
                  <div className="text-xs text-text-muted text-right max-w-[40%]">
                    {(byKey[p.key] ?? []).join(", ") || "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
