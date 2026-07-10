"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type Density = "comfortable" | "compact";
type ColumnsPref = Record<string, Record<string, boolean>>; // { leads: { created_at: false, ... } }

type Ctx = {
  density: Density;
  setDensity: (d: Density) => void;
  columns: ColumnsPref;
  setTableColumns: (table: string, vis: Record<string, boolean>) => void;
};

const UiPrefsContext = createContext<Ctx | null>(null);

function save(patch: Record<string, unknown>) {
  fetch("/api/me/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

export function UiPrefsProvider({
  initial,
  children,
}: {
  initial: { density: Density; columns: ColumnsPref };
  children: ReactNode;
}) {
  const [density, setDensityState] = useState<Density>(initial.density);
  const [columns, setColumns] = useState<ColumnsPref>(initial.columns);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    save({ density: d });
  }, []);

  const setTableColumns = useCallback((table: string, vis: Record<string, boolean>) => {
    setColumns((prev) => {
      const next = { ...prev, [table]: vis };
      save({ columns: next });
      return next;
    });
  }, []);

  return (
    <UiPrefsContext.Provider value={{ density, setDensity, columns, setTableColumns }}>
      {children}
    </UiPrefsContext.Provider>
  );
}

export function useUiPrefs() {
  const c = useContext(UiPrefsContext);
  if (!c) throw new Error("useUiPrefs must be used within UiPrefsProvider");
  return c;
}
