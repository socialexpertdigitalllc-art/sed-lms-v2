"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { initials } from "@/lib/leads/format";

export function AccountForm({
  email,
  username,
  displayName,
  fullName,
}: {
  email: string;
  username: string;
  displayName: string;
  fullName: string;
}) {
  const router = useRouter();
  const [dName, setDName] = useState(displayName);
  const [fName, setFName] = useState(fullName);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function saveProfile() {
    if (!dName.trim()) {
      setProfileMsg({ ok: false, text: "Display name is required" });
      return;
    }
    setSavingProfile(true);
    setProfileMsg(null);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: dName, fullName: fName }),
    });
    setSavingProfile(false);
    if (!res.ok) {
      setProfileMsg({ ok: false, text: (await res.json().catch(() => ({}))).error ?? "Failed" });
      return;
    }
    setProfileMsg({ ok: true, text: "Profile updated" });
    router.refresh();
  }

  async function changePassword() {
    if (pw.length < 8) {
      setPwMsg({ ok: false, text: "Password must be at least 8 characters" });
      return;
    }
    if (pw !== pw2) {
      setPwMsg({ ok: false, text: "Passwords do not match" });
      return;
    }
    setSavingPw(true);
    setPwMsg(null);
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: pw }),
    });
    setSavingPw(false);
    if (!res.ok) {
      setPwMsg({ ok: false, text: (await res.json().catch(() => ({}))).error ?? "Failed" });
      return;
    }
    setPw("");
    setPw2("");
    setPwMsg({ ok: true, text: "Password changed" });
  }

  const inputCls =
    "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";

  return (
    <div className="max-w-2xl space-y-5">
      {/* identity header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-accent-soft text-accent-ink grid place-items-center text-lg font-semibold">
          {initials(dName || email)}
        </div>
        <div>
          <div className="text-lg font-semibold text-text">{dName || "—"}</div>
          <div className="text-sm text-text-muted">
            <span className="font-mono">@{username}</span> · {email}
          </div>
        </div>
      </div>

      {/* profile */}
      <section className="bg-surface border border-border rounded-lg p-5">
        <div className="text-sm font-semibold text-text mb-4">Profile</div>
        {profileMsg && (
          <div className={"mb-4 text-sm rounded-md px-3 py-2 " + (profileMsg.ok ? "bg-ready-bg text-ready-fg" : "bg-dropped-bg text-dropped-fg")}>
            {profileMsg.text}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Display name</label>
            <input value={dName} onChange={(e) => setDName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Full name</label>
            <input value={fName} onChange={(e) => setFName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Username</label>
            <input value={username} disabled className={inputCls + " font-mono opacity-60 cursor-not-allowed"} />
            <p className="text-xs text-text-faint mt-1">Only an admin can change this.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Email</label>
            <input value={email} disabled className={inputCls + " opacity-60 cursor-not-allowed"} />
            <p className="text-xs text-text-faint mt-1">Managed by an administrator.</p>
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={saveProfile}
            disabled={savingProfile}
            className="px-4 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60"
          >
            {savingProfile ? "Saving…" : "Save profile"}
          </button>
        </div>
      </section>

      {/* password */}
      <section className="bg-surface border border-border rounded-lg p-5">
        <div className="text-sm font-semibold text-text mb-4">Change password</div>
        {pwMsg && (
          <div className={"mb-4 text-sm rounded-md px-3 py-2 " + (pwMsg.ok ? "bg-ready-bg text-ready-fg" : "bg-dropped-bg text-dropped-fg")}>
            {pwMsg.text}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">New password</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Confirm password</label>
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={changePassword}
            disabled={savingPw || !pw}
            className="px-4 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60"
          >
            {savingPw ? "Changing…" : "Change password"}
          </button>
        </div>
      </section>
    </div>
  );
}
