"use client";

import { usePermissionSet } from "@/providers/PermissionProvider";

export function usePermissions() {
  const set = usePermissionSet();
  return {
    has: (key: string) => set.has(key),
    hasAny: (keys: string[]) => keys.some((k) => set.has(k)),
    all: set,
  };
}
