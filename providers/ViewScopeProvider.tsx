"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Scopes per-view session state (useViewState) to the logged-in user. Session
 * storage is per-browser-tab and survives sign-out, so without a user scope a
 * filter set by one account would silently bleed into the next account signed
 * in on the same machine. Keying storage by user id gives each account its own
 * clean slate and self-heals any state left by the previous key format.
 */
const ViewScopeContext = createContext<string>("anon");

export function ViewScopeProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  return <ViewScopeContext.Provider value={userId || "anon"}>{children}</ViewScopeContext.Provider>;
}

export function useViewScope(): string {
  return useContext(ViewScopeContext);
}
