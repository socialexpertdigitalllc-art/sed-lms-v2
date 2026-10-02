"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Panel } from "@/components/common/Panel";
import { Field, inputCls } from "@/components/forms/Field";
import { Select } from "@/components/common/Select";
import { btnPrimary, btnSecondary, btnSecondarySm, btnGhostSm } from "@/components/common/buttons";
import type { WebsiteServiceRow, PricingTier, ServiceFAQ, IncludedItem } from "@/lib/website-cms/types";
import {
  Dialog,
  createRow,
  updateRow,
  deleteRow,
  usePublishToast,
  linesToArray,
  arrayToLines,
} from "./shared";

// The service editor is the heart of the CMS: everything a service page
// shows (tiers/prices, features, FAQs, pains, inclusions) is edited here
// and lands on the live site seconds after saving.

type Draft = {
  slug: string;
  name: string;
  short_name: string;
  tagline: string;
  description: string;
  icon: string;
  featuresText: string;
  tiers: PricingTier[];
  quote_based: boolean;
  starting_at: string;
  market_comparison: { label: string; marketPrice: string; ourPrice: string };
  faqs: ServiceFAQ[];
  pain_heading: string;
  painsText: string;
  included: IncludedItem[];
  sort_order: number;
  active: boolean;
};

const EMPTY: Draft = {
  slug: "",
  name: "",
  short_name: "",
  tagline: "",
  description: "",
  icon: "",
  featuresText: "",
  tiers: [],
  quote_based: false,
  starting_at: "",
  market_comparison: { label: "", marketPrice: "", ourPrice: "" },
  faqs: [],
  pain_heading: "Sound familiar?",
  painsText: "",
  included: [],
  sort_order: 0,
  active: true,
};

function toDraft(row: WebsiteServiceRow): Draft {
  return {
    slug: row.slug,
    name: row.name,
    short_name: row.short_name,
    tagline: row.tagline,
    description: row.description,
    icon: row.icon,
    featuresText: arrayToLines(row.features),
    tiers: row.tiers ?? [],
    quote_based: row.quote_based,
    starting_at: row.starting_at ?? "",
    market_comparison: row.market_comparison ?? { label: "", marketPrice: "", ourPrice: "" },
    faqs: row.faqs ?? [],
    pain_heading: row.pain_heading,
    painsText: arrayToLines(row.pains),
    included: row.included ?? [],
    sort_order: row.sort_order,
    active: row.active,
  };
}

function toPayload(d: Draft) {
  return {
    slug: d.slug,
    name: d.name,
    short_name: d.short_name,
    tagline: d.tagline,
    description: d.description,
    icon: d.icon,
    features: linesToArray(d.featuresText),
    tiers: d.tiers.map((t) => ({ ...t, price: Number(t.price) || 0 })),
    quote_based: d.quote_based,
    starting_at: d.starting_at || null,
    market_comparison: d.market_comparison,
    faqs: d.faqs.filter((f) => f.question.trim() && f.answer.trim()),
    pain_heading: d.pain_heading,
    pains: linesToArray(d.painsText),
    included: d.included.filter((i) => i.title.trim() && i.text.trim()),
    sort_order: Number(d.sort_order) || 0,
    active: d.active,
  };
}

function tierSummary(tiers: PricingTier[]) {
  if (!tiers?.length) return "quote-based";
  return tiers.map((t) => `$${t.price}${t.priceNote === "/mo" ? "/mo" : ""}`).join(" · ");
}

export function ServicesPanel({ rows, canManage }: { rows: WebsiteServiceRow[]; canManage: boolean }) {
  const router = useRouter();
  const publishToast = usePublishToast();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function save() {
    if (!editing) return;
    setBusy(true);
    setFieldErrors({});
    const payload = toPayload(editing.draft);
    const outcome = editing.id
      ? await updateRow("services", editing.id, payload)
      : await createRow("services", payload);
    setBusy(false);
    publishToast(outcome, editing.id ? "Service saved" : "Service created");
    if (outcome.ok) {
      setEditing(null);
      router.refresh();
    } else if (outcome.fieldErrors) {
      setFieldErrors(outcome.fieldErrors);
    }
  }

  async function remove(row: WebsiteServiceRow) {
    if (!window.confirm(`Delete "${row.name}" from the website? The page /services/${row.slug} disappears.`)) return;
    const outcome = await deleteRow("services", row.id);
    publishToast(outcome, "Service deleted");
    if (outcome.ok) router.refresh();
  }

  const d = editing?.draft;
  const set = (patch: Partial<Draft>) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  return (
    <Panel
      flush
      title="Services"
      count={rows.length}
      description="The 9 service pages, their prices, FAQs and copy — exactly what the website renders."
      action={
        canManage ? (
          <button type="button" className={btnSecondarySm} onClick={() => setEditing({ id: null, draft: EMPTY })}>
            <Plus className="h-3.5 w-3.5" /> New service
          </button>
        ) : undefined
      }
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
            <th className="px-4 py-2 font-medium">Service</th>
            <th className="px-4 py-2 font-medium">Slug</th>
            <th className="px-4 py-2 font-medium">Pricing</th>
            <th className="px-4 py-2 font-medium">Active</th>
            {canManage && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border-subtle last:border-0 hover:bg-surface-2/50">
              <td className="px-4 py-2.5 font-medium text-text">{row.name}</td>
              <td className="px-4 py-2.5 font-mono text-xs text-text-muted">{row.slug}</td>
              <td className="px-4 py-2.5 text-text-muted">{tierSummary(row.tiers)}</td>
              <td className="px-4 py-2.5">{row.active ? "Yes" : <span className="text-text-faint">Hidden</span>}</td>
              {canManage && (
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    className={btnGhostSm}
                    onClick={() => setEditing({ id: row.id, draft: toDraft(row) })}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button type="button" className={btnGhostSm} onClick={() => remove(row)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-sm text-text-muted">
                No services yet — use <span className="font-medium">Settings → Seed from website</span> to import the
                current site content.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing && d && (
        <Dialog title={editing.id ? `Edit — ${d.name || d.slug}` : "New service"} onClose={() => setEditing(null)} wide>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required error={fieldErrors.name?.[0]}>
                <input className={inputCls} value={d.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Slug (URL)" required hint="lowercase-with-dashes; changes the page URL" error={fieldErrors.slug?.[0]}>
                <input className={inputCls} value={d.slug} onChange={(e) => set({ slug: e.target.value })} />
              </Field>
              <Field label="Short name (menus)">
                <input className={inputCls} value={d.short_name} onChange={(e) => set({ short_name: e.target.value })} />
              </Field>
              <Field label="Icon key" hint="must exist in the website's icon map">
                <input className={inputCls} value={d.icon} onChange={(e) => set({ icon: e.target.value })} />
              </Field>
            </div>
            <Field label="Tagline">
              <input className={inputCls} value={d.tagline} onChange={(e) => set({ tagline: e.target.value })} />
            </Field>
            <Field label="Description">
              <textarea
                className={inputCls}
                rows={3}
                value={d.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>
            <Field label="Features (one per line)">
              <textarea
                className={inputCls}
                rows={5}
                value={d.featuresText}
                onChange={(e) => set({ featuresText: e.target.value })}
              />
            </Field>

            {/* Tiers */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="block text-xs font-medium text-text-muted">Pricing tiers</span>
                <button
                  type="button"
                  className={btnGhostSm}
                  onClick={() =>
                    set({
                      tiers: [
                        ...d.tiers,
                        { name: "", price: 0, priceNote: "one-time", billingNote: "", features: [] },
                      ],
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Add tier
                </button>
              </div>
              <div className="space-y-3">
                {d.tiers.map((t, i) => (
                  <div key={i} className="rounded-md border border-border-subtle p-3">
                    <div className="grid gap-3 sm:grid-cols-4">
                      <Field label="Tier name">
                        <input
                          className={inputCls}
                          value={t.name}
                          onChange={(e) => {
                            const tiers = [...d.tiers];
                            tiers[i] = { ...t, name: e.target.value };
                            set({ tiers });
                          }}
                        />
                      </Field>
                      <Field label="Price (USD)">
                        <input
                          className={inputCls}
                          type="number"
                          min={0}
                          value={t.price}
                          onChange={(e) => {
                            const tiers = [...d.tiers];
                            tiers[i] = { ...t, price: Number(e.target.value) };
                            set({ tiers });
                          }}
                        />
                      </Field>
                      <Field label="Price note" hint='"one-time", "/mo", …'>
                        <input
                          className={inputCls}
                          value={t.priceNote}
                          onChange={(e) => {
                            const tiers = [...d.tiers];
                            tiers[i] = { ...t, priceNote: e.target.value };
                            set({ tiers });
                          }}
                        />
                      </Field>
                      <Field label="Badge">
                        <Select
                          className={inputCls}
                          value={t.badge ?? ""}
                          onChange={(e) => {
                            const tiers = [...d.tiers];
                            const badge = e.target.value as "" | "Popular" | "Recommended";
                            tiers[i] = { ...t, badge: badge === "" ? undefined : badge };
                            set({ tiers });
                          }}
                        >
                          <option value="">None</option>
                          <option value="Popular">Popular</option>
                          <option value="Recommended">Recommended</option>
                        </Select>
                      </Field>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label="Billing note">
                        <input
                          className={inputCls}
                          value={t.billingNote}
                          onChange={(e) => {
                            const tiers = [...d.tiers];
                            tiers[i] = { ...t, billingNote: e.target.value };
                            set({ tiers });
                          }}
                        />
                      </Field>
                      <Field label="Tier features (one per line)">
                        <textarea
                          className={inputCls}
                          rows={3}
                          value={arrayToLines(t.features)}
                          onChange={(e) => {
                            const tiers = [...d.tiers];
                            tiers[i] = { ...t, features: linesToArray(e.target.value) };
                            set({ tiers });
                          }}
                        />
                      </Field>
                    </div>
                    <div className="mt-2 text-right">
                      <button
                        type="button"
                        className={btnGhostSm}
                        onClick={() => set({ tiers: d.tiers.filter((_, j) => j !== i) })}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove tier
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Quote-based?">
                <Select
                  className={inputCls}
                  value={d.quote_based ? "yes" : "no"}
                  onChange={(e) => set({ quote_based: e.target.value === "yes" })}
                >
                  <option value="no">No — show tiers</option>
                  <option value="yes">Yes — quote-based</option>
                </Select>
              </Field>
              <Field label='"Starting at" chip' hint='e.g. "from $299"'>
                <input className={inputCls} value={d.starting_at} onChange={(e) => set({ starting_at: e.target.value })} />
              </Field>
              <Field label="Sort order">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={d.sort_order}
                  onChange={(e) => set({ sort_order: Number(e.target.value) })}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Market comparison — label">
                <input
                  className={inputCls}
                  value={d.market_comparison.label}
                  onChange={(e) => set({ market_comparison: { ...d.market_comparison, label: e.target.value } })}
                />
              </Field>
              <Field label="Typical market price">
                <input
                  className={inputCls}
                  value={d.market_comparison.marketPrice}
                  onChange={(e) => set({ market_comparison: { ...d.market_comparison, marketPrice: e.target.value } })}
                />
              </Field>
              <Field label="Our price">
                <input
                  className={inputCls}
                  value={d.market_comparison.ourPrice}
                  onChange={(e) => set({ market_comparison: { ...d.market_comparison, ourPrice: e.target.value } })}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Pain section heading">
                <input className={inputCls} value={d.pain_heading} onChange={(e) => set({ pain_heading: e.target.value })} />
              </Field>
              <Field label="Pain points (one per line)">
                <textarea
                  className={inputCls}
                  rows={3}
                  value={d.painsText}
                  onChange={(e) => set({ painsText: e.target.value })}
                />
              </Field>
            </div>

            {/* What's included */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="block text-xs font-medium text-text-muted">What&apos;s included</span>
                <button
                  type="button"
                  className={btnGhostSm}
                  onClick={() => set({ included: [...d.included, { title: "", text: "" }] })}
                >
                  <Plus className="h-3.5 w-3.5" /> Add item
                </button>
              </div>
              <div className="space-y-2">
                {d.included.map((it, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      className={inputCls}
                      placeholder="Title"
                      value={it.title}
                      onChange={(e) => {
                        const included = [...d.included];
                        included[i] = { ...it, title: e.target.value };
                        set({ included });
                      }}
                    />
                    <input
                      className={inputCls}
                      placeholder="Text"
                      value={it.text}
                      onChange={(e) => {
                        const included = [...d.included];
                        included[i] = { ...it, text: e.target.value };
                        set({ included });
                      }}
                    />
                    <button
                      type="button"
                      className={btnGhostSm}
                      aria-label="Remove item"
                      onClick={() => set({ included: d.included.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* FAQs */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="block text-xs font-medium text-text-muted">FAQs</span>
                <button
                  type="button"
                  className={btnGhostSm}
                  onClick={() => set({ faqs: [...d.faqs, { question: "", answer: "" }] })}
                >
                  <Plus className="h-3.5 w-3.5" /> Add FAQ
                </button>
              </div>
              <div className="space-y-2">
                {d.faqs.map((f, i) => (
                  <div key={i} className="rounded-md border border-border-subtle p-3">
                    <input
                      className={inputCls}
                      placeholder="Question"
                      value={f.question}
                      onChange={(e) => {
                        const faqs = [...d.faqs];
                        faqs[i] = { ...f, question: e.target.value };
                        set({ faqs });
                      }}
                    />
                    <textarea
                      className={`${inputCls} mt-2`}
                      rows={2}
                      placeholder="Answer"
                      value={f.answer}
                      onChange={(e) => {
                        const faqs = [...d.faqs];
                        faqs[i] = { ...f, answer: e.target.value };
                        set({ faqs });
                      }}
                    />
                    <div className="mt-1 text-right">
                      <button
                        type="button"
                        className={btnGhostSm}
                        onClick={() => set({ faqs: d.faqs.filter((_, j) => j !== i) })}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Field label="Visible on the website?">
              <Select
                className={inputCls}
                value={d.active ? "yes" : "no"}
                onChange={(e) => set({ active: e.target.value === "yes" })}
              >
                <option value="yes">Yes — live</option>
                <option value="no">No — hidden</option>
              </Select>
            </Field>

            <div className="flex justify-end gap-2 border-t border-border-subtle pt-4">
              <button type="button" className={btnSecondary} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save & publish"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </Panel>
  );
}
