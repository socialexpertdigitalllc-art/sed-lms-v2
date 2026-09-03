"use client";

import { ExternalLink, FileText, ImageOff, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TemplateCardRow {
  id: string;
  name: string;
  page_files: string[];
  asset_files: string[];
  cover_image_path: string | null;
  in_service?: boolean;
}

export const templateCoverUrl = (id: string) => `/api/site-builder/templates/${id}/cover`;
export const templatePreviewUrl = (id: string) => `/api/site-builder/templates/${id}/preview`;

/**
 * One template, as a picture.
 *
 * The same card serves the operator's board and the salesperson's picker,
 * because they are choosing between the same things and a template that looks
 * different in the two places is a support call waiting to happen. `selected`
 * / `onSelect` turn it into a radio option; without them it is a plain card.
 */
export function TemplateCard({
  template,
  selected,
  onSelect,
  footer,
  className,
}: {
  template: TemplateCardRow;
  selected?: boolean;
  onSelect?: () => void;
  /** Board-only controls (in-service switch, delete). */
  footer?: React.ReactNode;
  className?: string;
}) {
  const pages = template.page_files.length;
  const assets = template.asset_files.length;
  const selectable = !!onSelect;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-surface transition-colors",
        selected ? "border-accent ring-2 ring-accent" : "border-border",
        selectable && !selected && "hover:border-accent/60",
        className,
      )}
    >
      {/* The picture is the point, so it leads and keeps a stable aspect
          ratio — a grid of differently-shaped cards is unreadable at a
          glance, which is the only way this screen gets used. */}
      <div className="relative aspect-[16/10] w-full shrink-0 bg-surface-2">
        {template.cover_image_path ? (
          // eslint-disable-next-line @next/next/no-img-element -- authed API route, not an optimizable public asset
          <img
            src={templateCoverUrl(template.id)}
            alt={`${template.name} cover`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-text-faint">
            <div className="flex flex-col items-center gap-1">
              <ImageOff className="h-5 w-5" aria-hidden />
              <span className="text-[11px]">No cover image</span>
            </div>
          </div>
        )}
        {selectable && (
          <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            aria-label={`Select ${template.name}`}
            className="absolute inset-0 h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          />
        )}
        {selected && (
          <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">
            Selected
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-text">{template.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3.5 w-3.5 text-text-faint" aria-hidden />
              {pages} page{pages === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Layers className="h-3.5 w-3.5 text-text-faint" aria-hidden />
              {assets} asset{assets === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2">
          {/* A new tab, deliberately: the salesperson is on a call and needs
              the template beside the form, not instead of it. */}
          <a
            href={templatePreviewUrl(template.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Preview in new tab
          </a>
          {footer}
        </div>
      </div>
    </div>
  );
}
