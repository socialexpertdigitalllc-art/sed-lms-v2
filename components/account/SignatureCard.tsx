"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Upload, ImageIcon, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
import { Panel, EmptyPanel } from "@/components/common/Panel";
import { btnPrimary } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";

export function SignatureCard({ initialTypedName, hasImage }: { initialTypedName: string; hasImage: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [typedName, setTypedName] = useState(initialTypedName);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("typed_name", typedName);
      if (file) fd.set("image", file);
      const res = await fetch("/api/me/signature", { method: "PUT", body: fd });
      const data = await res.json();
      if (!res.ok) { toast({ kind: "error", title: "Save failed", body: data.error }); return; }
      toast({ kind: "success", title: "Signature saved" });
      setFile(null);
      router.refresh();
    } finally { setBusy(false); }
  }

  const nothingSet = !hasImage && !typedName.trim() && !file;

  return (
    <Panel
      icon={PenLine}
      title="Contract signature"
      description="Applied to contracts you send. An uploaded PNG wins; otherwise the typed name is drawn in a script style."
      footer={
        <button type="button" onClick={save} disabled={busy} className={btnPrimary}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? "Saving…" : "Save signature"}
        </button>
      }
      bodyClassName="space-y-4"
    >
      {/* Preview / empty state */}
      {nothingSet ? (
        <EmptyPanel
          icon={PenLine}
          title="No signature set"
          hint="Type your name below, or upload a transparent PNG of your handwritten signature."
          className="rounded-md border border-dashed border-border bg-surface-2 py-9"
        />
      ) : (
        <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface-2 px-4 py-5">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-text-faint">Preview</p>
            {hasImage || file ? (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-text">
                <ImageIcon className="h-4 w-4 shrink-0 text-text-muted" />
                <span className="truncate">{file ? file.name : "Signature image on file"}</span>
              </p>
            ) : (
              <p className="font-display mt-1 truncate text-2xl italic leading-tight text-text" title={typedName}>
                {typedName}
              </p>
            )}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ready-bg px-2 py-0.5 text-[11px] font-medium text-ready-fg">
            <Check className="h-3 w-3" /> {hasImage || file ? "Image" : "Typed"}
          </span>
        </div>
      )}

      <Field label="Typed name (fallback)">
        <input className={inputCls} value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Jordan Rivera" />
      </Field>

      <Field
        label={hasImage ? "Replace signature image (PNG)" : "Signature image (PNG, optional)"}
        hint="Transparent background works best."
      >
        <label
          className={cn(
            inputCls,
            "flex cursor-pointer items-center gap-2 transition-colors duration-150 hover:bg-surface-2",
            "focus-within:ring-2 focus-within:ring-accent",
          )}
        >
          <Upload className="h-4 w-4 shrink-0 text-text-muted" />
          <span className={cn("truncate", file ? "text-text" : "text-text-muted")}>
            {file ? file.name : hasImage ? "Current image on file" : "Choose a PNG"}
          </span>
          <input type="file" accept="image/png" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </Field>
    </Panel>
  );
}
