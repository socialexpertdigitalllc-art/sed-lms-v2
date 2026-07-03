"use client";

import { usePermissions } from "@/hooks/usePermissions";

export function PermissionGate({
  perm,
  children,
  fallback = null,
}: {
  perm: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { has } = usePermissions();
  return has(perm) ? <>{children}</> : <>{fallback}</>;
}
