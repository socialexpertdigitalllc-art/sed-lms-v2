"use client";

import { useState } from "react";

type Perm = { key: string; name: string; category: string; is_sensitive?: boolean };

export function PermissionToggleGrid({
  deptId,
  permissions,
  granted,
}: {
  deptId: string;
  permissions: Perm[];
  granted: string[];
}) {
  const [on, setOn] = useState<Set<string>>(new Set(granted));
  const [busy, setBusy] = useState<string | null>(null);

  const groups = permissions.reduce<Record<string, Perm[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  async function toggle(key: string) {
    const enabled = !on.has(key);
    setBusy(key);
    setOn((prev) => {
      const next = new Set(prev);
      if (enabled) next.add(key);
      else next.delete(key);
      return next;
    });
    try {
      await fetch(`/api/admin/departments/${deptId}/permissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionKey: key, enabled }),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {Object.entries(groups).map(([cat, perms]) => (
        <div key={cat} className="bg-surface border border-border rounded-lg p-4">
          <div className="text-[10px] uppercase tracking-wider text-text-faint mb-3 font-semibold">
            {cat.replace("_", " ")}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {perms.map((p) => (
              <label
                key={p.key}
                className="flex items-center gap-2.5 text-sm text-text px-2 py-1.5 rounded-md hover:bg-surface-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={on.has(p.key)}
                  disabled={busy === p.key}
                  onChange={() => toggle(p.key)}
                  className="accent-accent w-4 h-4"
                />
                <span className="flex-1">
                  {p.name}
                  {p.is_sensitive && (
                    <span className="ml-1.5 text-[10px] text-dropped-fg uppercase">sensitive</span>
                  )}
                </span>
                <span className="font-mono text-[11px] text-text-faint">{p.key}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
