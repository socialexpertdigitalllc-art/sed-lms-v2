"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PermissionMode } from "@/lib/assistant/actions/permissions";

/**
 * This person's permission mode for Act (how much SED AI does without a
 * click), loaded once and saved as soon as they pick another. BROWSER ONLY.
 */

export interface PermissionModeOption {
  mode: PermissionMode;
  label: string;
  short: string;
  description: string;
  /** Within the company limit. */
  allowed: boolean;
}

export interface ActPermissionsView {
  mode: PermissionMode;
  effective: PermissionMode;
  cap: PermissionMode;
  modes: PermissionModeOption[];
  allow: { key: string; title: string; group: string }[];
}

const URL = "/api/assistant/actions/permissions";

export function useActPermissions(enabled: boolean) {
  const [view, setView] = useState<ActPermissionsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });

  const reload = useCallback(
    () =>
      fetch(URL, { cache: "no-store" })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as ActPermissionsView & { error?: string };
          if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
          setView(body);
          setError(null);
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  /** Change something; the screen shows it at once and goes back if the server says no. */
  const change = useCallback(async (patch: { mode?: PermissionMode; allow_remove?: string; allow_clear?: true }): Promise<string | null> => {
    const before = viewRef.current;
    if (before && patch.mode) setView({ ...before, mode: patch.mode, effective: patch.mode });
    if (before && patch.allow_remove) setView({ ...before, allow: before.allow.filter((a) => a.key !== patch.allow_remove) });
    if (before && patch.allow_clear) setView({ ...before, allow: [] });
    setSaving(true);
    try {
      const res = await fetch(URL, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = (await res.json().catch(() => ({}))) as ActPermissionsView & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setView(body);
      return null;
    } catch (e) {
      setView(before);
      return (e as Error).message;
    } finally {
      setSaving(false);
    }
  }, []);

  return { view, error, saving, reload, change, mode: view?.effective ?? null };
}
