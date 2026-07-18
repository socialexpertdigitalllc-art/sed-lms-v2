"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PenLine, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "@/components/forms/Field";
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

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-text"><PenLine className="w-4 h-4" /> Contract signature</div>
      <p className="text-xs text-text-faint">Used on contracts you send. An uploaded PNG takes priority; otherwise the typed name is drawn in a script style.</p>
      <Field label="Typed name (fallback)">
        <input className={inputCls} value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Jordan Rivera" />
      </Field>
      <Field label={hasImage ? "Replace signature image (PNG)" : "Signature image (PNG, optional)"}>
        <label className={cn(inputCls, "flex items-center gap-2 cursor-pointer")}>
          <Upload className="w-4 h-4 text-text-muted" />
          <span className="text-text-muted truncate">{file ? file.name : hasImage ? "Current image on file" : "Choose a PNG"}</span>
          <input type="file" accept="image/png" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </Field>
      <div className="flex justify-end">
        <button onClick={save} disabled={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-60">{busy ? "Saving…" : "Save signature"}</button>
      </div>
    </div>
  );
}
