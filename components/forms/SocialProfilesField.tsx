"use client";

import { X } from "lucide-react";
import { inputCls } from "./Field";
import { SOCIAL_PLATFORMS, type SocialProfile } from "@/lib/leads/types";

/**
 * As many of the business's social profiles as it has.
 *
 * The network is a select rather than free text so the generator and the
 * detail page can key off a known set — with "Other" carrying its own name in
 * `label`, which keeps the canonical five matching the select on a re-edit
 * instead of degrading into unrecognised strings.
 */
export function SocialProfilesField({
  values,
  onChange,
}: {
  values: SocialProfile[];
  onChange: (v: SocialProfile[]) => void;
}) {
  const setAt = (i: number, patch: Partial<SocialProfile>) =>
    onChange(values.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const removeAt = (i: number) => onChange(values.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select
            value={v.platform}
            onChange={(e) => setAt(i, { platform: e.target.value, label: null })}
            aria-label={`Social platform ${i + 1}`}
            className={"w-32 shrink-0 " + inputCls}
          >
            {SOCIAL_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {v.platform === "Other" && (
            <input
              value={v.label ?? ""}
              onChange={(e) => setAt(i, { label: e.target.value })}
              placeholder="Network name"
              aria-label={`Other network name ${i + 1}`}
              className={"w-36 shrink-0 " + inputCls}
            />
          )}
          <input
            type="url"
            value={v.url}
            onChange={(e) => setAt(i, { url: e.target.value })}
            placeholder="https://…"
            aria-label={`Social profile URL ${i + 1}`}
            className={"min-w-[12rem] flex-1 " + inputCls}
          />
          <button
            type="button"
            onClick={() => removeAt(i)}
            aria-label={`Remove social profile ${i + 1}`}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2.5 py-2 text-xs text-text-muted hover:bg-dropped-bg hover:text-dropped-fg"
          >
            <X className="h-4 w-4" /> Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...values, { platform: "Facebook", url: "", label: null }])}
        className="rounded-md border border-dashed border-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-soft"
      >
        + Add Social Profile
      </button>
    </div>
  );
}
