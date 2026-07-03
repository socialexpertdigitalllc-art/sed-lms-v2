"use client";

import { createContext, useContext, useMemo } from "react";

const PermissionContext = createContext<Set<string>>(new Set());

export function PermissionProvider({
  value,
  children,
}: {
  value: string[];
  children: React.ReactNode;
}) {
  const set = useMemo(() => new Set(value), [value]);
  return (
    <PermissionContext.Provider value={set}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissionSet() {
  return useContext(PermissionContext);
}
