"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
type Toast = { id: number; kind: ToastKind; title: string; body?: string };

type ToastCtx = { toast: (t: { kind?: ToastKind; title: string; body?: string }) => void };
const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const c = useContext(Ctx);
  // Safe no-op if used outside a provider (never throws in render).
  return c ?? { toast: () => {} };
}

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info };
const ACCENT = { success: "text-ready-fg", error: "text-dropped-fg", info: "text-accent" };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((t: { kind?: ToastKind; title: string; body?: string }) => {
    const id = ++seq.current;
    setToasts((prev) => [...prev, { id, kind: t.kind ?? "info", title: t.title, body: t.body }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((x) => x.id !== id));

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(92vw,22rem)]">
        {toasts.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <div key={t.id} role="status"
              className="flex items-start gap-2.5 bg-surface border border-border rounded-lg shadow-xl px-3.5 py-2.5 animate-in">
              <Icon className={"w-4 h-4 mt-0.5 shrink-0 " + ACCENT[t.kind]} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text">{t.title}</div>
                {t.body && <div className="text-xs text-text-muted mt-0.5 break-words">{t.body}</div>}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss"
                className="p-0.5 rounded text-text-faint hover:text-text shrink-0"><X className="w-3.5 h-3.5" /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
