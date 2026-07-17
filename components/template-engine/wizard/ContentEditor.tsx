"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock, Save } from "lucide-react";
import { useToast } from "@/components/common/Toast";
import { Field, inputCls } from "@/components/forms/Field";
import { DynamicList } from "@/components/forms/DynamicList";
import type { ContentModel } from "@/lib/template-engine/contentModel";
import type { GenerationDetail } from "./GenerationWizard";
import { cn } from "@/lib/utils";

const areaCls = cn(inputCls, "min-h-20 resize-y");

export function ContentEditor({ gen, onSaved }: { gen: GenerationDetail; onSaved: () => void }) {
  const editable = gen.status === "curating";
  const [model, setModel] = useState<ContentModel | null>(gen.content_model);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // A realtime refetch (e.g. build started elsewhere) replaces the row —
  // only adopt the fresh model when the operator has no unsaved base yet.
  useEffect(() => { if (!model && gen.content_model) setModel(gen.content_model); }, [gen.content_model, model]);

  if (!model) {
    return <div className="rounded-lg border border-border bg-surface p-5 text-sm text-text-muted">No content model yet — the planning step produces it.</div>;
  }

  const set = (patch: Partial<ContentModel>) => setModel({ ...model, ...patch });

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/template-engine/generations/${gen.id}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(model),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const detail = j.detail ?? j.error ?? "Could not save content";
        // detail can be a raw multi-line ZodError message — keep the toast readable.
        toast({ kind: "error", title: "Save failed", body: String(detail).split("\n")[0] });
        return;
      }
      toast({ kind: "success", title: "Content saved", body: "Your edits will be used when the site builds." });
      onSaved();
    } catch {
      toast({ kind: "error", title: "Save failed", body: "Network error — try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {!editable ? (
        <p className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted">
          <Lock className="h-3.5 w-3.5" /> Content is locked once the build starts — this is what the site was built from.
        </p>
      ) : null}

      <fieldset disabled={!editable} className="space-y-5">
        <legend className="sr-only">Website content</legend>
        <Card title="Identity">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business name" required>
              <input className={inputCls} value={model.identity.name}
                onChange={(e) => set({ identity: { ...model.identity, name: e.target.value } })} />
            </Field>
            <Field label="Tagline">
              <input className={inputCls} value={model.identity.tagline}
                onChange={(e) => set({ identity: { ...model.identity, tagline: e.target.value } })} />
            </Field>
            <Field label="Positioning" className="sm:col-span-2">
              <textarea className={areaCls} value={model.identity.positioning}
                onChange={(e) => set({ identity: { ...model.identity, positioning: e.target.value } })} />
            </Field>
          </div>
        </Card>

        <Card title="Brand assets & colors">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Logo URL" className="sm:col-span-2">
              <input className={inputCls} value={model.identity.logo_url ?? ""} placeholder="https://…"
                onChange={(e) => set({ identity: { ...model.identity, logo_url: e.target.value } })} />
            </Field>
            <Field label="Business profile / reviews link" className="sm:col-span-2">
              <input className={inputCls} value={model.identity.profile_link ?? ""} placeholder="https://…"
                onChange={(e) => set({ identity: { ...model.identity, profile_link: e.target.value } })} />
            </Field>
            <Field label="Map embed (full <iframe> …)" className="sm:col-span-2">
              <textarea className={areaCls} value={model.identity.map_embed ?? ""} placeholder='<iframe src="https://www.google.com/maps/embed?…"></iframe>'
                onChange={(e) => set({ identity: { ...model.identity, map_embed: e.target.value } })} />
            </Field>
            <ColorField label="Brand color" value={model.theme?.brand ?? ""}
              onChange={(v) => set({ theme: { ...(model.theme ?? { brand: "", brand_deep: "", accent: "" }), brand: v } })} />
            <ColorField label="Brand deep (headers)" value={model.theme?.brand_deep ?? ""}
              onChange={(v) => set({ theme: { ...(model.theme ?? { brand: "", brand_deep: "", accent: "" }), brand_deep: v } })} />
            <ColorField label="Accent color" value={model.theme?.accent ?? ""}
              onChange={(v) => set({ theme: { ...(model.theme ?? { brand: "", brand_deep: "", accent: "" }), accent: v } })} />
          </div>
          <p className="mt-2 text-xs text-text-faint">Colors are applied over the template palette (leave blank to keep the template&apos;s own colors). Hex like #1d4ed8.</p>
        </Card>

        <Card title="Hero">
          <div className="space-y-3">
            <Field label="Headline parts (rendered as one headline)">
              <DynamicList values={model.hero.headline_parts}
                onChange={(v) => set({ hero: { ...model.hero, headline_parts: v } })}
                placeholder="Headline line" addLabel="Add line" />
            </Field>
            <Field label="Subcopy">
              <textarea className={areaCls} value={model.hero.subcopy}
                onChange={(e) => set({ hero: { ...model.hero, subcopy: e.target.value } })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Primary button"><input className={inputCls} value={model.hero.cta_primary}
                onChange={(e) => set({ hero: { ...model.hero, cta_primary: e.target.value } })} /></Field>
              <Field label="Secondary button"><input className={inputCls} value={model.hero.cta_secondary}
                onChange={(e) => set({ hero: { ...model.hero, cta_secondary: e.target.value } })} /></Field>
            </div>
          </div>
        </Card>

        <Card title={`Services (${model.services.length})`}>
          <div className="space-y-4">
            {model.services.map((svc, i) => (
              <div key={svc.key} className="rounded-md border border-border-subtle p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name">
                    <input className={inputCls} value={svc.name} onChange={(e) => {
                      const services = [...model.services];
                      services[i] = { ...svc, name: e.target.value };
                      set({ services });
                    }} />
                  </Field>
                  <Field label="Short description">
                    <input className={inputCls} value={svc.short} onChange={(e) => {
                      const services = [...model.services];
                      services[i] = { ...svc, short: e.target.value };
                      set({ services });
                    }} />
                  </Field>
                  <Field label="Long description" className="sm:col-span-2">
                    <textarea className={areaCls} value={svc.long} onChange={(e) => {
                      const services = [...model.services];
                      services[i] = { ...svc, long: e.target.value };
                      set({ services });
                    }} />
                  </Field>
                  <Field label="Bullets" className="sm:col-span-2">
                    <DynamicList values={svc.bullets} onChange={(bullets) => {
                      const services = [...model.services];
                      services[i] = { ...svc, bullets };
                      set({ services });
                    }} placeholder="Bullet" addLabel="Add bullet" />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="About">
          <div className="space-y-3">
            <Field label="Story">
              <textarea className={areaCls} value={model.about.story}
                onChange={(e) => set({ about: { ...model.about, story: e.target.value } })} />
            </Field>
            <Field label="Why choose us">
              <DynamicList values={model.about.why_us}
                onChange={(why_us) => set({ about: { ...model.about, why_us } })}
                placeholder="Reason" addLabel="Add reason" />
            </Field>
          </div>
        </Card>

        <Card title={`Testimonials (${model.testimonials.length}) · FAQ (${model.faq.length}) · Stats (${model.stats.length})`}>
          <div className="space-y-4">
            {model.testimonials.map((t, i) => (
              <div key={i} className="grid gap-3 sm:grid-cols-[1fr_200px]">
                <Field label={`Quote ${i + 1}`}>
                  <textarea className={areaCls} value={t.quote} onChange={(e) => {
                    const testimonials = [...model.testimonials];
                    testimonials[i] = { ...t, quote: e.target.value };
                    set({ testimonials });
                  }} />
                </Field>
                <Field label="Name">
                  <input className={inputCls} value={t.name} onChange={(e) => {
                    const testimonials = [...model.testimonials];
                    testimonials[i] = { ...t, name: e.target.value };
                    set({ testimonials });
                  }} />
                </Field>
              </div>
            ))}
            {model.faq.map((f, i) => (
              <div key={i} className="grid gap-3 sm:grid-cols-2">
                <Field label={`Question ${i + 1}`}>
                  <input className={inputCls} value={f.q} onChange={(e) => {
                    const faq = [...model.faq];
                    faq[i] = { ...f, q: e.target.value };
                    set({ faq });
                  }} />
                </Field>
                <Field label="Answer">
                  <input className={inputCls} value={f.a} onChange={(e) => {
                    const faq = [...model.faq];
                    faq[i] = { ...f, a: e.target.value };
                    set({ faq });
                  }} />
                </Field>
              </div>
            ))}
            <div className="grid gap-3 sm:grid-cols-3">
              {model.stats.map((s, i) => (
                <div key={i} className="grid gap-2">
                  <Field label={`Stat ${i + 1} value`}>
                    <input className={inputCls} value={String(s.value)} onChange={(e) => {
                      const stats = [...model.stats];
                      stats[i] = { ...s, value: e.target.value };
                      set({ stats });
                    }} />
                  </Field>
                  <Field label="Label">
                    <input className={inputCls} value={s.label} onChange={(e) => {
                      const stats = [...model.stats];
                      stats[i] = { ...s, label: e.target.value };
                      set({ stats });
                    }} />
                  </Field>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </fieldset>

      {editable ? (
        <div className="flex justify-end">
          <button type="button" onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save content
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A hex text input paired with a native color swatch, kept in sync. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const isHex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" value={isHex ? value : "#000000"} aria-label={`${label} swatch`}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded border border-border bg-surface p-0.5" />
        <input className={inputCls} value={value} placeholder="#1d4ed8 (or blank)"
          onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-text-faint">{title}</h2>
      {children}
    </section>
  );
}
