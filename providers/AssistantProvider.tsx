"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DEFAULT_ASSISTANT_NAME } from "@/lib/assistant/name";

/**
 * The signed-in user's assistant, app-wide: whether they may use it, what
 * they named it, and whether the floating chat is open. The header button,
 * the floating chat and the full Assistant page all read the name from here,
 * so renaming it in one place renames it everywhere at once.
 */

interface AssistantCtx {
  /** Has "Use SED Assistant". Nothing assistant-related renders without it. */
  enabled: boolean;
  userId: string;
  /** The signed-in person's own name, for greetings. */
  displayName: string;
  /** What to call it: the user's choice, or the SED Assistant default. */
  name: string;
  /** Has the user picked a name yet? First open asks until they have. */
  named: boolean;
  /** Save a new name. Resolves to the name as stored; rejects with a message. */
  saveName: (name: string) => Promise<string>;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
}

const Ctx = createContext<AssistantCtx>({
  enabled: false,
  userId: "",
  displayName: "",
  name: DEFAULT_ASSISTANT_NAME,
  named: false,
  saveName: async () => {
    throw new Error("The assistant is not available here.");
  },
  panelOpen: false,
  setPanelOpen: () => {},
});

export function AssistantProvider({
  enabled,
  userId,
  displayName,
  initialName,
  children,
}: {
  enabled: boolean;
  userId: string;
  displayName: string;
  /** The stored name, or null when the user has not named it yet. */
  initialName: string | null;
  children: React.ReactNode;
}) {
  const [name, setName] = useState<string | null>(initialName);
  const [panelOpen, setPanelOpen] = useState(false);

  const saveName = useCallback(async (next: string) => {
    const res = await fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assistantName: next }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; ui_preferences?: { assistantName?: string } };
    if (!res.ok) throw new Error(body.error ?? "Could not save the name. Try again.");
    const stored = body.ui_preferences?.assistantName ?? next.trim();
    setName(stored);
    return stored;
  }, []);

  const value = useMemo<AssistantCtx>(
    () => ({ enabled, userId, displayName, name: name ?? DEFAULT_ASSISTANT_NAME, named: name !== null, saveName, panelOpen, setPanelOpen }),
    [enabled, userId, displayName, name, saveName, panelOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantCtx {
  return useContext(Ctx);
}
