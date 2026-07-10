"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Perm = { key: string; name: string; category: string };
type Override = { permission_key: string; is_granted: boolean };

export function UserManager({
  userId,
  email,
  username,
  isSelf,
  isActive,
  allDepartments,
  currentDeptIds,
  allPermissions,
  deptGranted,
  overrides,
  effective,
}: {
  userId: string;
  email: string;
  username: string;
  isSelf: boolean;
  isActive: boolean;
  allDepartments: { id: string; name: string }[];
  currentDeptIds: string[];
  allPermissions: Perm[];
  deptGranted: string[];
  overrides: Override[];
  effective: string[];
}) {
  const router = useRouter();
  const [active, setActive] = useState(isActive);
  const [deptSel, setDeptSel] = useState<Set<string>>(new Set(currentDeptIds));
  const [ov, setOv] = useState<Map<string, boolean>>(
    new Map(overrides.map((o) => [o.permission_key, o.is_granted]))
  );
  const [savingDepts, setSavingDepts] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);
  const [uname, setUname] = useState(username);
  const [unameMsg, setUnameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingUname, setSavingUname] = useState(false);

  async function saveUsername() {
    setSavingUname(true);
    setUnameMsg(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: uname }),
    });
    setSavingUname(false);
    if (!res.ok) {
      setUnameMsg({ ok: false, text: (await res.json().catch(() => ({}))).error ?? "Failed" });
      return;
    }
    setUnameMsg({ ok: true, text: "Username updated" });
    router.refresh();
  }
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  async function resetPassword() {
    if (newPassword.length < 8) {
      setPwMsg({ ok: false, text: "Password must be at least 8 characters" });
      return;
    }
    setSavingPw(true);
    setPwMsg(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    });
    setSavingPw(false);
    if (!res.ok) {
      setPwMsg({ ok: false, text: (await res.json().catch(() => ({}))).error ?? "Failed" });
      return;
    }
    setNewPassword("");
    setPwMsg({ ok: true, text: "Password updated. Share the new temporary password with the user." });
  }

  async function deleteUser() {
    setDeleting(true);
    setDeleteErr(null);
    const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    if (!res.ok) {
      setDeleting(false);
      setDeleteErr((await res.json().catch(() => ({}))).error ?? "Failed to delete");
      return;
    }
    router.push("/admin/users");
    router.refresh();
  }

  const deptBaseline = new Set(deptGranted);
  const effectiveSet = new Set(effective);

  async function patch(body: object) {
    await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    router.refresh();
  }

  async function toggleActive() {
    const next = !active;
    setActive(next);
    await patch({ isActive: next });
  }

  async function saveDepts() {
    setSavingDepts(true);
    await patch({ departmentIds: [...deptSel] });
    setSavingDepts(false);
  }

  async function setOverride(key: string, value: "grant" | "revoke" | "clear") {
    setOv((prev) => {
      const next = new Map(prev);
      if (value === "clear") next.delete(key);
      else next.set(key, value === "grant");
      return next;
    });
    await fetch(`/api/admin/users/${userId}/overrides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        permissionKey: key,
        isGranted: value === "grant",
        remove: value === "clear",
      }),
    });
    router.refresh();
  }

  const groups = allPermissions.reduce<Record<string, Perm[]>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* username */}
      <section className="bg-surface border border-border rounded-lg p-4">
        <div className="text-sm font-medium text-text mb-1">Username</div>
        <p className="text-xs text-text-muted mb-3">
          Used to sign in. Only an administrator can change it.
        </p>
        {unameMsg && (
          <div className={"mb-3 text-xs rounded-md px-3 py-2 " + (unameMsg.ok ? "bg-ready-bg text-ready-fg" : "bg-dropped-bg text-dropped-fg")}>
            {unameMsg.text}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={uname}
            onChange={(e) => setUname(e.target.value)}
            className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-border bg-surface text-sm font-mono outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            onClick={saveUsername}
            disabled={savingUname || uname.trim().toLowerCase() === username}
            className="px-3 py-2 text-xs font-semibold rounded-md bg-accent text-white hover:bg-accent-ink disabled:opacity-60"
          >
            {savingUname ? "Saving…" : "Save username"}
          </button>
        </div>
      </section>

      {/* status */}
      <section className="bg-surface border border-border rounded-lg p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-text">Account status</div>
          <div className="text-xs text-text-muted">
            {active ? "Active — can sign in" : "Inactive — sign-in blocked"}
          </div>
        </div>
        <button
          onClick={toggleActive}
          className={
            active
              ? "px-3 py-1.5 text-xs font-semibold rounded-md bg-dropped-bg text-dropped-fg"
              : "px-3 py-1.5 text-xs font-semibold rounded-md bg-ready-bg text-ready-fg"
          }
        >
          {active ? "Deactivate" : "Activate"}
        </button>
      </section>

      {/* departments */}
      <section className="bg-surface border border-border rounded-lg p-4">
        <div className="text-sm font-medium text-text mb-3">Departments</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {allDepartments.map((d) => {
            const on = deptSel.has(d.id);
            return (
              <button
                key={d.id}
                onClick={() =>
                  setDeptSel((prev) => {
                    const next = new Set(prev);
                    if (on) next.delete(d.id);
                    else next.add(d.id);
                    return next;
                  })
                }
                className={
                  on
                    ? "px-3 py-1.5 text-xs font-medium rounded-full bg-accent-soft text-accent-ink border border-accent"
                    : "px-3 py-1.5 text-xs font-medium rounded-full bg-surface-2 text-text-muted border border-border"
                }
              >
                {d.name}
              </button>
            );
          })}
        </div>
        <button
          onClick={saveDepts}
          disabled={savingDepts}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-accent text-white hover:bg-accent-ink disabled:opacity-60"
        >
          {savingDepts ? "Saving…" : "Save departments"}
        </button>
      </section>

      {/* reset password */}
      <section className="bg-surface border border-border rounded-lg p-4">
        <div className="text-sm font-medium text-text mb-1">Reset password</div>
        <p className="text-xs text-text-muted mb-3">
          Set a new temporary password for this user. They can change it after signing in.
        </p>
        {pwMsg && (
          <div className={"mb-3 text-xs rounded-md px-3 py-2 " + (pwMsg.ok ? "bg-ready-bg text-ready-fg" : "bg-dropped-bg text-dropped-fg")}>
            {pwMsg.text}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New temporary password"
            className="flex-1 min-w-[220px] px-3 py-2 rounded-md border border-border bg-surface text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            onClick={resetPassword}
            disabled={savingPw || !newPassword}
            className="px-3 py-2 text-xs font-semibold rounded-md bg-accent text-white hover:bg-accent-ink disabled:opacity-60"
          >
            {savingPw ? "Setting…" : "Set password"}
          </button>
        </div>
      </section>

      {/* permission overrides */}
      <section>
        <div className="text-sm font-medium text-text mb-1">Effective permissions &amp; overrides</div>
        <p className="text-xs text-text-muted mb-3">
          Inherited from departments, with per-user grants/revokes layered on top.
        </p>
        <div className="space-y-4">
          {Object.entries(groups).map(([cat, perms]) => (
            <div key={cat} className="bg-surface border border-border rounded-lg p-4">
              <div className="text-[10px] uppercase tracking-wider text-text-faint mb-3 font-semibold">
                {cat.replace("_", " ")}
              </div>
              <div className="space-y-1.5">
                {perms.map((p) => {
                  const inherited = deptBaseline.has(p.key);
                  const override = ov.get(p.key);
                  const has = effectiveSet.has(p.key);
                  return (
                    <div key={p.key} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-sm text-text">{p.name}</span>
                        <span className="font-mono text-[11px] text-text-faint ml-2">{p.key}</span>
                        <span className="ml-2 text-[10px] uppercase">
                          {override === true && <span className="text-ready-fg">granted</span>}
                          {override === false && <span className="text-dropped-fg">revoked</span>}
                          {override === undefined &&
                            (inherited ? (
                              <span className="text-text-faint">inherited</span>
                            ) : (
                              <span className="text-text-faint">—</span>
                            ))}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          className={
                            "w-2 h-2 rounded-full mr-2 " + (has ? "bg-accent" : "bg-border")
                          }
                          title={has ? "effective: yes" : "effective: no"}
                        />
                        <button
                          onClick={() => setOverride(p.key, "grant")}
                          className="text-[11px] px-2 py-1 rounded border border-border text-ready-fg hover:bg-ready-bg"
                        >
                          Grant
                        </button>
                        <button
                          onClick={() => setOverride(p.key, "revoke")}
                          className="text-[11px] px-2 py-1 rounded border border-border text-dropped-fg hover:bg-dropped-bg"
                        >
                          Revoke
                        </button>
                        <button
                          onClick={() => setOverride(p.key, "clear")}
                          className="text-[11px] px-2 py-1 rounded border border-border text-text-muted hover:bg-surface-2"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* danger zone */}
      {!isSelf && (
        <section className="bg-surface border border-dropped-fg/30 rounded-lg p-4">
          <div className="text-sm font-medium text-dropped-fg mb-1">Danger zone</div>
          <p className="text-xs text-text-muted mb-3">
            Permanently delete this user — their account, memberships, and overrides. This cannot be undone.
          </p>
          <button
            onClick={() => {
              setDeleteErr(null);
              setDeleteOpen(true);
            }}
            className="px-3 py-2 text-xs font-semibold rounded-md border border-dropped-fg/40 text-dropped-fg hover:bg-dropped-bg"
          >
            Delete user
          </button>
        </section>
      )}

      {deleteOpen && (
        <div className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4" onClick={() => setDeleteOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-surface border border-border rounded-lg p-6 w-full max-w-[400px] max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-text">Delete user</h2>
            <p className="text-sm text-text-muted mt-2">
              Permanently delete <span className="font-medium text-text">{email}</span>? This removes their
              account, department memberships, and permission overrides. This cannot be undone.
            </p>
            {deleteErr && (
              <div className="mt-3 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{deleteErr}</div>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setDeleteOpen(false)} className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2">
                Cancel
              </button>
              <button
                onClick={deleteUser}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-md bg-dropped-fg text-white font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
