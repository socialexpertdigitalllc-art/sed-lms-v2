"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SITE_TYPES } from "@/lib/leads/types";
import { settableStatuses } from "@/lib/leads/categories";
import { usePermissions } from "@/hooks/usePermissions";
import { formatPhone } from "@/lib/forms/phone";
import {
  PAGE_OPTIONS,
  PLATFORM_OPTIONS,
  PRICE_OPTIONS,
  YEARLY_OPTIONS,
  emptyNewLead,
  nonEmpty,
  pageTotal,
  validateNewLead,
  buildLeadPayload,
  type NewLeadFormState,
} from "@/lib/leads/newLeadForm";
import { Field, FormSection, inputCls } from "@/components/forms/Field";
import { RadioPillGroup } from "@/components/forms/RadioPillGroup";
import { ChipGroup } from "@/components/forms/ChipGroup";
import { DynamicList } from "@/components/forms/DynamicList";
import { ConditionalBlock } from "@/components/forms/ConditionalBlock";
import { RatingGroup } from "@/components/forms/RatingGroup";

type Agent = { id: string; display_name: string | null };

export function NewLeadForm({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  const { all } = usePermissions();
  const settable = useMemo(() => settableStatuses(all), [all]);

  const [f, setF] = useState<NewLeadFormState>(() =>
    emptyNewLead(settable.includes("Not Ready") ? "Not Ready" : (settable[0] ?? ""))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  /** Set one field and clear its error. */
  function set<K extends keyof NewLeadFormState>(k: K, v: NewLeadFormState[K]) {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((p) => {
      if (!(k in p)) return p;
      const n = { ...p };
      delete n[k as string];
      return n;
    });
  }

  const serviceCount = nonEmpty(f.services).length;
  const areaCount = f.has_service_areas === "Yes" ? nonEmpty(f.areas).length : 0;
  const total = useMemo(
    () => pageTotal(f.specify_pages, serviceCount, areaCount),
    [f.specify_pages, serviceCount, areaCount]
  );

  // Contact Us is forced whenever anything besides Home/Contact Us is selected.
  const contactForced = f.specify_pages.some((p) => p !== "Home" && p !== "Contact Us");
  const isapDisabled = f.has_service_areas !== "Yes";

  function togglePage(p: string) {
    setErrors((prev) => {
      const n = { ...prev };
      delete n.specify_pages;
      return n;
    });
    setF((prev) => {
      let next = prev.specify_pages.includes(p)
        ? prev.specify_pages.filter((x) => x !== p)
        : [...prev.specify_pages, p];
      // dynamics from the old form
      const forced = next.some((x) => x !== "Home" && x !== "Contact Us");
      if (forced && !next.includes("Contact Us")) next = [...next, "Contact Us"];
      if (!forced) next = next.filter((x) => x !== "Contact Us");
      return { ...prev, specify_pages: next, other_page: next.includes("Other") ? prev.other_page : "" };
    });
  }

  function setServiceAreas(v: string) {
    const yes = v === "Yes";
    setF((prev) => ({
      ...prev,
      has_service_areas: v as "Yes" | "No",
      areas: yes && nonEmpty(prev.areas).length === 0 ? [""] : yes ? prev.areas : [],
      // deselect ISAP when service areas are turned off
      specify_pages: yes
        ? prev.specify_pages
        : prev.specify_pages.filter((p) => p !== "Individual Service Area Pages"),
    }));
    setErrors((p) => {
      const n = { ...p };
      delete n.has_service_areas;
      delete n.areas;
      return n;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateNewLead(f);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      document.querySelector("[data-error='true']")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setBusy(true);
    setApiError(null);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildLeadPayload(f)),
    });
    setBusy(false);
    if (!res.ok) {
      setApiError((await res.json().catch(() => ({}))).error ?? "Failed to create lead");
      return;
    }
    const { id } = await res.json();
    router.push(`/leads/${id}`);
    router.refresh();
  }

  /** Wrapper that flags a field for scroll-to-first-error. */
  const F = ({ k, ...props }: { k: string } & React.ComponentProps<typeof Field>) => (
    <div data-error={errors[k] ? "true" : undefined}>
      <Field {...props} error={errors[k]} />
    </div>
  );

  return (
    <div className="max-w-3xl">
      <Link href="/leads" className="text-xs text-text-muted hover:text-text">← Leads</Link>
      <h1 className="text-xl font-semibold text-text mt-2 mb-5">New lead</h1>

      {apiError && (
        <div className="mb-4 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">{apiError}</div>
      )}

      <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-5 divide-y divide-border">
        {/* ⓪ Assignment (v2-specific) */}
        <FormSection title="Assignment">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="status" label="Status" required>
              <select value={f.status} onChange={(e) => set("status", e.target.value)} className={inputCls}>
                {settable.length === 0 && <option value="">No statuses available to you</option>}
                {settable.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </F>
            <F k="agent_id" label="Agent">
              <select value={f.agent_id} onChange={(e) => set("agent_id", e.target.value)} className={inputCls}>
                <option value="">Unassigned</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.display_name ?? a.id}</option>)}
              </select>
            </F>
          </div>
        </FormSection>

        {/* ① Client Identity */}
        <FormSection title="Client Identity">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="site_type" label="Site Type" required>
              <RadioPillGroup options={SITE_TYPES} value={f.site_type} onChange={(v) => set("site_type", v)} />
            </F>
            <F k="business_name" label="Business Name" required>
              <input value={f.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="Enter business name" className={inputCls} autoFocus />
            </F>
            <F k="business_phone" label="Phone Number" required hint="Format: (252) 401-2775">
              <input type="tel" value={f.business_phone} onChange={(e) => set("business_phone", formatPhone(e.target.value))} placeholder="(252) 401-2775" maxLength={14} className={inputCls} />
            </F>
            <F k="business_email" label="Email Address" required>
              <input type="email" value={f.business_email} onChange={(e) => set("business_email", e.target.value)} placeholder="example@email.com" className={inputCls} />
            </F>
          </div>
          <F k="platform" label="Platform" required>
            <RadioPillGroup options={PLATFORM_OPTIONS} value={f.platform} onChange={(v) => set("platform", v)} />
            <div className="mt-3" data-error={errors.business_profile_link ? "true" : undefined}>
              <input value={f.business_profile_link} onChange={(e) => set("business_profile_link", e.target.value)} placeholder="Enter profile link" className={inputCls} />
              {errors.business_profile_link && (
                <p className="text-[11px] text-dropped-fg mt-1">⚠ {errors.business_profile_link}</p>
              )}
            </div>
            <ConditionalBlock open={f.platform === "Other"} label="Other Platform">
              <div data-error={errors.other_platform ? "true" : undefined}>
                <input value={f.other_platform} onChange={(e) => set("other_platform", e.target.value)} placeholder="e.g., Facebook, Instagram, LinkedIn" className={inputCls} />
                {errors.other_platform && (
                  <p className="text-[11px] text-dropped-fg mt-1">⚠ {errors.other_platform}</p>
                )}
              </div>
            </ConditionalBlock>
          </F>
        </FormSection>

        {/* ② Location & Services */}
        <FormSection title="Location & Services">
          <F k="map_embed_link" label="Map Embed Link">
            <textarea value={f.map_embed_link} onChange={(e) => set("map_embed_link", e.target.value)} placeholder="Paste your map embed link or iframe code here" rows={2} className={inputCls} />
          </F>
          <F k="has_service_areas" label="Service Areas" required>
            <RadioPillGroup options={["Yes", "No"]} value={f.has_service_areas} onChange={setServiceAreas} />
            <ConditionalBlock open={f.has_service_areas === "Yes"} label="Areas">
              <div data-error={errors.areas ? "true" : undefined}>
                <DynamicList values={f.areas} onChange={(v) => set("areas", v)} placeholder="Enter service area" addLabel="Add Area" />
                {errors.areas && <p className="text-[11px] text-dropped-fg mt-1">⚠ {errors.areas}</p>}
              </div>
            </ConditionalBlock>
          </F>
          <F k="services" label="Services" required>
            <DynamicList values={f.services} onChange={(v) => set("services", v)} placeholder="Enter service" addLabel="Add Service" />
          </F>
        </FormSection>

        {/* ③ Website Details */}
        <FormSection title="Website Details">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="client_experience" label="Client's Experience (Years)" required>
              <input type="number" min={0} value={f.client_experience} onChange={(e) => set("client_experience", e.target.value)} placeholder="e.g., 5" className={inputCls} />
            </F>
            <Field label="No. of Webpages (auto)" hint="Derived from the selected pages below.">
              <div className={inputCls + " bg-surface-2 font-mono"}>{total || "—"}</div>
            </Field>
          </div>
          <F k="specify_pages" label="Specify Webpages" required hint={total > 0 ? `Total webpages: ${total}.` : "Selections determine the total number of webpages."}>
            <ChipGroup
              options={PAGE_OPTIONS}
              selected={f.specify_pages}
              onToggle={togglePage}
              locked={contactForced ? ["Home", "Contact Us"] : ["Home"]}
              disabled={isapDisabled ? ["Individual Service Area Pages"] : []}
              counter={total > 0 ? `${total} page(s) total` : "0 / — selected"}
            />
            <ConditionalBlock open={f.specify_pages.includes("Other")}>
              <input value={f.other_page} onChange={(e) => set("other_page", e.target.value)} placeholder="Specify other page name" className={inputCls} />
            </ConditionalBlock>
          </F>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="color_scheme" label="Color Scheme" required>
              <input value={f.color_scheme} onChange={(e) => set("color_scheme", e.target.value)} placeholder="e.g., #1A73E8, #FFFFFF, #000000" className={inputCls} />
            </F>
            <F k="logo_link" label="Logo Link">
              <input type="url" value={f.logo_link} onChange={(e) => set("logo_link", e.target.value)} placeholder="https://example.com/logo.png" className={inputCls} />
            </F>
          </div>
          <F k="image_links" label="Image Links">
            <DynamicList values={f.image_links} onChange={(v) => set("image_links", v)} placeholder="https://example.com/image.jpg" addLabel="Add Image Link" inputType="url" />
          </F>
        </FormSection>

        {/* ④ Pricing & Follow Up */}
        <FormSection title="Pricing & Follow Up">
          <F k="follow_up_time" label="Follow Up Time" required>
            <input type="datetime-local" value={f.follow_up_time} onChange={(e) => set("follow_up_time", e.target.value)} className={inputCls} />
          </F>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="price_quoted" label="Price Quoted" required>
              <RadioPillGroup
                options={PRICE_OPTIONS}
                value={f.price_quoted}
                onChange={(v) => set("price_quoted", v)}
              />
              <ConditionalBlock open={f.price_quoted === "Other"}>
                <div className="relative" data-error={errors.price_custom ? "true" : undefined}>
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">$</span>
                  <input type="number" min={0} value={f.price_custom} onChange={(e) => set("price_custom", e.target.value)} placeholder="Enter custom price" className={inputCls + " pl-7"} />
                </div>
                {errors.price_custom && <p className="text-[11px] text-dropped-fg mt-1">⚠ {errors.price_custom}</p>}
              </ConditionalBlock>
            </F>
            <F k="yearly_price" label="Yearly Price">
              <RadioPillGroup
                options={YEARLY_OPTIONS}
                value={f.yearly_price}
                onChange={(v) => set("yearly_price", v)}
              />
              <ConditionalBlock open={f.yearly_price === "Other"}>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">$</span>
                  <input type="number" min={0} value={f.yearly_custom} onChange={(e) => set("yearly_custom", e.target.value)} placeholder="Enter yearly price" className={inputCls + " pl-7"} />
                </div>
              </ConditionalBlock>
            </F>
          </div>
          <F k="direct_line_saved" label="Direct Line saved?">
            <RadioPillGroup options={["Yes", "No"]} value={f.direct_line_saved} onChange={(v) => set("direct_line_saved", v as "Yes" | "No")} />
          </F>
          <ConditionalBlock open={f.site_type === "Redesign"} label="Reference Site (Redesign only)">
            <div data-error={errors.reference_link ? "true" : undefined}>
              <input type="url" value={f.reference_link} onChange={(e) => set("reference_link", e.target.value)} placeholder="https://referencesite.com" className={inputCls} />
              {errors.reference_link && <p className="text-[11px] text-dropped-fg mt-1">⚠ {errors.reference_link}</p>}
            </div>
          </ConditionalBlock>
        </FormSection>

        {/* ⑤ Final Assessment */}
        <FormSection title="Final Assessment">
          <F k="comments" label="Specific Comments on Client" required>
            <textarea value={f.comments} onChange={(e) => set("comments", e.target.value)} placeholder="Enter detailed comments about the client..." rows={4} className={inputCls} />
          </F>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
            <F k="rating" label="Give Lead a Rating (1–10)" required>
              <RatingGroup value={f.rating} onChange={(v) => set("rating", v)} />
            </F>
            <F k="fresh_or_followup" label="Fresh or Follow Up?" required>
              <RadioPillGroup options={["Fresh", "Follow Up"]} value={f.fresh_or_followup} onChange={(v) => set("fresh_or_followup", v)} />
            </F>
          </div>
        </FormSection>

        <div className="flex justify-end gap-2 pt-5">
          <Link href="/leads" className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2">Cancel</Link>
          <button disabled={busy || settable.length === 0} className="px-5 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60">
            {busy ? "Submitting…" : "Submit Lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
