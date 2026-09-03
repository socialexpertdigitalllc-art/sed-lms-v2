"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { btnPrimary, btnSecondary } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { useToast } from "@/components/common/Toast";
import { templateCoverUrl } from "./TemplateCard";

export interface EditableTemplate {
  id: string;
  name: string;
  cover_image_path: string | null;
}

/**
 * Edit an existing template: rename it, give it a cover, or ship updated files.
 *
 * The cover row is the reason this exists — covers became required for new
 * uploads, which left every template uploaded before that unable to get one,
 * and therefore unable to go in service.
 */
export function TemplateEditModal({
  template,
  onClose,
  onSaved,
}: {
  template: EditableTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(template.name);
  const [cover, setCover] = useState<File | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const renamed = name.trim() !== template.name && name.trim().length > 0;
  const dirty = renamed || !!cover || !!zip;

  async function save() {
    if (!dirty) return;
    setSaving(true);
    try {
      const fd = new FormData();
      if (renamed) fd.append("name", name.trim());
      if (cover) fd.append("cover", cover);
      if (zip) fd.append("file", zip);
      const res = await fetch(`/api/site-builder/templates/${template.id}`, { method: "PATCH", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save the template");
      toast({ kind: "success", title: `Saved "${name.trim()}"` });
      onSaved();
    } catch (e) {
      toast({ kind: "error", title: e instanceof Error ? e.message : "Could not save the template" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-[460px] max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-surface p-6">
        <h2 className="font-semibold text-text">Edit template</h2>
        <p className="mb-4 mt-1 truncate text-sm text-text-muted">{template.name}</p>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="tpl-edit-name">
              Name
            </label>
            <input
              id="tpl-edit-name"
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="tpl-edit-cover">
              Cover image
            </label>
            {template.cover_image_path ? (
              // eslint-disable-next-line @next/next/no-img-element -- authed API route, not an optimizable public asset
              <img
                src={templateCoverUrl(template.id)}
                alt={`${template.name} current cover`}
                className="mb-2 h-28 w-full rounded-md border border-border object-cover"
              />
            ) : (
              <p className="mb-2 rounded-md border border-dashed border-notready-fg/50 bg-notready-bg/40 px-2 py-1.5 text-[11px] text-notready-fg">
                No cover yet — this template cannot go in service until it has one.
              </p>
            )}
            <input
              id="tpl-edit-cover"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              className={inputCls}
              onChange={(e) => setCover(e.target.files?.[0] ?? null)}
              disabled={saving}
            />
            <p className="mt-1 text-[11px] text-text-faint">
              A screenshot of the built site. PNG, JPEG, WebP or AVIF, max 5MB.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="tpl-edit-zip">
              Replace template files (optional)
            </label>
            <input
              id="tpl-edit-zip"
              type="file"
              accept=".zip,application/zip"
              className={inputCls}
              onChange={(e) => setZip(e.target.files?.[0] ?? null)}
              disabled={saving}
            />
            <p className="mt-1 text-[11px] text-text-faint">
              Replaces the source zip and re-reads its pages and assets. Sites already generated keep
              what they built; the next run uses the new files.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className={btnPrimary} onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
