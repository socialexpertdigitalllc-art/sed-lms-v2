"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  MapPinned,
  Globe,
  DollarSign,
  ClipboardCheck,
  UserCog,
  Star,
  ArrowLeft,
  Check,
  AlertTriangle,
} from "lucide-react";
import { SITE_TYPES, type AddOn } from "@/lib/leads/types";
import { settableStatuses } from "@/lib/leads/categories";
import { STATUS_PILL } from "@/lib/leads/types";
import { usePermissions } from "@/hooks/usePermissions";
import { useDuplicateCheck } from "@/hooks/useDuplicateCheck";
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
import { usePhotoExtension } from "@/hooks/usePhotoExtension";
import { isGoogleProfileLink } from "@/lib/photo-capture/googleLink";
import { ExtensionInstallCard } from "@/components/leads/ExtensionInstallCard";
import { useToast } from "@/components/common/Toast";
import { Field, inputCls } from "@/components/forms/Field";
import { RadioPillGroup } from "@/components/forms/RadioPillGroup";
import { ChipGroup } from "@/components/forms/ChipGroup";
import { DynamicList } from "@/components/forms/DynamicList";
import { SocialProfilesField } from "@/components/forms/SocialProfilesField";
import { ConditionalBlock } from "@/components/forms/ConditionalBlock";
import { RatingGroup } from "@/components/forms/RatingGroup";
import { SectionCard, FieldBlock as F, FieldError, SummaryRow } from "@/components/forms/formShell";
import { EmailFieldVerify } from "@/components/email-verify/EmailFieldVerify";
import { ColorSchemeField } from "@/components/leads/ColorSchemeField";
import { useColorSchemeCheck } from "@/hooks/useColorSchemeCheck";
import { MAX_COLORS } from "@/lib/leads/colorScheme";

type Agent = { id: string; display_name: string | null };

export function NewLeadForm({
  agents,
  canAssign,
  canSetStatus,
  salesUsers,
  addons,
  currentUserId,
  canOverrideDuplicate,
}: {
  agents: Agent[];
  canAssign: boolean;
  canSetStatus: boolean;
  salesUsers: { id: string; display_name: string }[];
  addons: AddOn[];
  currentUserId: string;
  canOverrideDuplicate: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { all } = usePermissions();
  const settable = useMemo(() => settableStatuses(all), [all]);
  const photoExt = usePhotoExtension();

  const [f, setF] = useState<NewLeadFormState>(() =>
    emptyNewLead(
      !canSetStatus || settable.includes("Not Ready") ? "Not Ready" : (settable[0] ?? "")
    )
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const collisions = useDuplicateCheck("/api/leads/check-duplicate", {
    business_name: f.business_name,
    phone: f.business_phone,
    email: f.no_email ? "" : f.business_email,
  });
  const dupBy = (field: string) => collisions.find((c) => c.field === field);
  const hasDup = collisions.length > 0;
  const [overrideDup, setOverrideDup] = useState(false);

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

  const contactForced = f.specify_pages.some((p) => p !== "Home" && p !== "Contact Us");
  // ISAP is available only once Service Areas = Yes AND at least one area is filled.
  const isapDisabled = f.has_service_areas !== "Yes" || areaCount === 0;
  // Advisory AI review of the colour scheme. Debounced inside the hook, and
  // deliberately incapable of blocking anything unless it returns a definite
  // rejection — see `colorBlocked` at the submit gate.
  const colorCheck = useColorSchemeCheck(f.color_scheme, {
    context: {
      business_name: f.business_name,
      services: nonEmpty(f.services),
      site_type: f.site_type,
    },
  });
  const colorBlocked = colorCheck.rejected;

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
      const forced = next.some((x) => x !== "Home" && x !== "Contact Us");
      if (forced && !next.includes("Contact Us")) next = [...next, "Contact Us"];
      if (!forced) next = next.filter((x) => x !== "Contact Us");
      return { ...prev, specify_pages: next, other_page: next.includes("Other") ? prev.other_page : "" };
    });
  }

  /** Set the areas list; drop ISAP if no areas remain (it can't apply without areas). */
  function setAreas(v: string[]) {
    setF((prev) => {
      const stripIsap = nonEmpty(v).length === 0;
      return {
        ...prev,
        areas: v,
        specify_pages: stripIsap
          ? prev.specify_pages.filter((p) => p !== "Individual Service Area Pages")
          : prev.specify_pages,
      };
    });
    setErrors((p) => {
      if (!("areas" in p)) return p;
      const n = { ...p };
      delete n.areas;
      return n;
    });
  }

  function setServiceAreas(v: string) {
    const yes = v === "Yes";
    setF((prev) => ({
      ...prev,
      has_service_areas: v as "Yes" | "No",
      areas: yes && nonEmpty(prev.areas).length === 0 ? [""] : yes ? prev.areas : [],
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

  // Live validation (does not surface messages — drives the progress + "fields left" hint).
  const liveErrors = useMemo(() => validateNewLead(f), [f]);
  const sectionErrs: Record<string, string[]> = {
    identity: [
      "site_type",
      "business_name",
      "business_phone",
      "business_email",
      "platform",
      "business_profile_link",
      "other_platform",
    ],
    location: ["has_service_areas", "areas", "services"],
    website: ["client_experience", "specify_pages", "color_scheme", "design_reference_links"],
    pricing: ["follow_up_time", "price_quoted", "price_custom", "reference_link"],
    assessment: ["comments", "rating", "fresh_or_followup", "closed_by"],
  };
  const sectionDone = (key: keyof typeof sectionErrs) =>
    sectionErrs[key].every((k) => !(k in liveErrors));
  const completed = Object.keys(sectionErrs).filter((k) =>
    sectionDone(k as keyof typeof sectionErrs)
  ).length;
  const totalSections = Object.keys(sectionErrs).length;
  const remaining = Object.keys(liveErrors).length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateNewLead(f);
    // Re-run the colour check now (the debounce may still be pending), then gate
    // on what we already know. Only a DEFINITE rejection blocks: if Gemini is
    // down the check reports `aiUnavailable` and the deterministic rules —
    // already inside validateNewLead / the hook's issues — are the whole gate.
    colorCheck.checkNow();
    if (colorBlocked && !errs.color_scheme) {
      errs.color_scheme = colorCheck.issues[0] ?? "That is not a usable colour scheme.";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      requestAnimationFrame(() =>
        document
          .querySelector("[data-error='true']")
          ?.scrollIntoView({ behavior: "smooth", block: "center" })
      );
      return;
    }
    if (hasDup && !(canOverrideDuplicate && overrideDup)) {
      setApiError("Resolve the highlighted duplicate before submitting.");
      return;
    }
    setBusy(true);
    setApiError(null);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...buildLeadPayload(f, { userId: currentUserId }), override: overrideDup }),
    });
    setBusy(false);
    if (!res.ok) {
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        const fields: string[] = (body.collisions ?? []).map((c: { field: string }) => c.field);
        setApiError(
          fields.length
            ? `This business is already in the system (matching ${fields.join(", ")}).`
            : "This business is already in the system."
        );
        return;
      }
      setApiError((await res.json().catch(() => ({}))).error ?? "Failed to create lead");
      return;
    }
    const { id } = await res.json();

    // Fire-and-forget: the lead is saved either way, and the agent must never
    // wait on a browser capture (the redirect below happens unconditionally,
    // before any of this settles). A missing extension simply does nothing —
    // the lead's Images group offers a Capture photos button instead.
    //
    // Every fetch here is checked for `ok`, matching LeadPhotoPicker's
    // runCapture: a 500 (e.g. the migration not yet applied) is otherwise
    // indistinguishable from success, and the extension's DONE message still
    // routes back through the shared usePhotoExtension singleton even though
    // this component has already unmounted by the time it arrives — see
    // hooks/usePhotoExtension.ts.
    if (photoExt.installed && isGoogleProfileLink(f.business_profile_link)) {
      void (async () => {
        const started = await fetch(`/api/leads/${id}/photos/candidates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "started", profileLink: f.business_profile_link }),
        });
        if (!started.ok) {
          // Do not open the extension popup to scrape photos that cannot be
          // stored — that is pure waste and confusing to the operator.
          toast({
            kind: "error",
            title: (await started.json().catch(() => ({}))).error ?? "Could not start the photo capture",
          });
          return;
        }
        try {
          const photos = await photoExt.capture(f.business_profile_link);
          const saved = await fetch(`/api/leads/${id}/photos/candidates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "done",
              profileLink: f.business_profile_link,
              photos,
              extensionVersion: photoExt.version,
            }),
          });
          if (!saved.ok) {
            toast({
              kind: "error",
              title: (await saved.json().catch(() => ({}))).error ?? "Captured, but could not save the photos",
            });
            return;
          }
          toast({
            kind: photos.length ? "success" : "info",
            title: photos.length ? `Captured ${photos.length} photos` : "No photos found on that profile",
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : "Capture failed";
          const recorded = await fetch(`/api/leads/${id}/photos/candidates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "failed", error: message }),
          });
          toast({
            kind: "error",
            title: recorded.ok ? message : `${message} (and the failure could not be recorded)`,
          });
        }
      })();
    }

    router.push(`/leads/${id}`);
    router.refresh();
  }

  const showAssignment = canAssign || canSetStatus;
  const agentName = canAssign
    ? agents.find((a) => a.id === f.agent_id)?.display_name ?? "Unassigned"
    : "You";
  const priceDisplay =
    f.price_quoted === "Other"
      ? f.price_custom
        ? `$${f.price_custom}`
        : "—"
      : f.price_quoted
        ? `$${f.price_quoted}`
        : "—";

  const submitBtn = (
    <button
      disabled={
        busy ||
        (canSetStatus && settable.length === 0) ||
        (hasDup && !(canOverrideDuplicate && overrideDup))
      }
      className="w-full rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-ink disabled:opacity-60"
    >
      {busy ? "Submitting…" : "Submit Lead"}
    </button>
  );

  const dupBanner = hasDup && (
    <div className="mb-3 rounded-lg border border-dropped-fg/20 bg-dropped-bg px-3 py-2.5 text-xs text-dropped-fg">
      <p>
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 inline" /> Possible duplicate — matching{" "}
        {collisions.map((c) => c.field.replace("_", " ")).join(", ")} found in the system.
      </p>
      {canOverrideDuplicate && (
        <label className="mt-2 flex items-center gap-1.5 font-medium">
          <input
            type="checkbox"
            checked={overrideDup}
            onChange={(e) => setOverrideDup(e.target.checked)}
            className="accent-accent"
          />
          Submit anyway
        </label>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header band */}
      <div className="reveal relative mb-6 overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="bg-grid absolute inset-0 opacity-60" />
        <div className="glow-teal absolute -right-16 -top-24 h-64 w-64" />
        <div className="relative flex flex-wrap items-end justify-between gap-4 p-6">
          <div className="min-w-0">
            <Link
              href="/leads"
              className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-text"
            >
              <ArrowLeft size={13} /> Leads
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-ink">
              New Lead
            </p>
            <h1 className="font-display text-2xl font-semibold leading-tight text-text">
              {f.business_name.trim() || "Untitled lead"}
            </h1>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-semibold text-text">
              {completed}
              <span className="text-text-faint">/{totalSections}</span>
            </div>
            <p className="text-[11px] uppercase tracking-wide text-text-faint">sections ready</p>
            <div className="mt-2 h-1.5 w-36 overflow-hidden rounded-full bg-border-subtle">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${(completed / totalSections) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {apiError && (
        <div className="mb-4 rounded-lg border border-dropped-fg/20 bg-dropped-bg px-4 py-2.5 text-sm text-dropped-fg">
          {apiError}
        </div>
      )}

      <form onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="lg:col-span-2">
          <ExtensionInstallCard installed={photoExt.installed} version={photoExt.version} />
        </div>

        {/* Form column */}
        <div className="min-w-0 space-y-5">
          {showAssignment && (
            <SectionCard n={0} icon={UserCog} title="Assignment" subtitle="Ownership & pipeline stage" done delay={0}>
              <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
                {canSetStatus && (
                  <F error={errors.status} label="Status">
                    <select value={f.status} onChange={(e) => set("status", e.target.value)} className={inputCls}>
                      {settable.length === 0 && <option value="">No statuses available to you</option>}
                      {settable.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </F>
                )}
                {canAssign && (
                  <F error={errors.agent_id} label="Agent">
                    <select value={f.agent_id} onChange={(e) => set("agent_id", e.target.value)} className={inputCls}>
                      <option value="">Unassigned</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.display_name ?? a.id}</option>
                      ))}
                    </select>
                  </F>
                )}
              </div>
            </SectionCard>
          )}

          <SectionCard n={1} icon={Building2} title="Client Identity" subtitle="Who the business is" done={sectionDone("identity")} delay={showAssignment ? 60 : 0}>
            <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
              <F error={errors.site_type} label="Site Type" required>
                <RadioPillGroup options={SITE_TYPES} value={f.site_type} onChange={(v) => set("site_type", v)} />
              </F>
              <F error={errors.business_name} label="Business Name" required>
                <input value={f.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="Enter business name" className={inputCls} autoFocus />
                {dupBy("business_name") && (
                  <p className="mt-1 text-[11px] text-dropped-fg">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 inline" />{" "}
                    {dupBy("business_name")!.isOwn
                      ? "You already have a lead with this business name."
                      : `This business name belongs to a lead owned by ${dupBy("business_name")!.ownerDisplayName ?? "another agent"}.`}
                  </p>
                )}
              </F>
              <F error={errors.owner_name} label="Owner Name (optional)">
                <input value={f.owner_name} onChange={(e) => set("owner_name", e.target.value)} placeholder="Who you spoke to, e.g. Maria Alvarez" className={inputCls} />
              </F>
              <F error={errors.business_phone} label="Phone Number" required hint="Format: (252) 401-2775">
                <input type="tel" value={f.business_phone} onChange={(e) => set("business_phone", formatPhone(e.target.value))} placeholder="(252) 401-2775" maxLength={14} className={inputCls} />
                {dupBy("phone") && (
                  <p className="mt-1 text-[11px] text-dropped-fg">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 inline" />{" "}
                    {dupBy("phone")!.isOwn
                      ? "You already have a lead with this phone number."
                      : `This phone number belongs to a lead owned by ${dupBy("phone")!.ownerDisplayName ?? "another agent"}.`}
                  </p>
                )}
              </F>
              <F error={errors.business_email} label="Email Address" required={!f.no_email}>
                <input
                  type="email"
                  value={f.business_email}
                  onChange={(e) => set("business_email", e.target.value)}
                  placeholder="example@email.com"
                  disabled={f.no_email}
                  className={inputCls + (f.no_email ? " opacity-50" : "")}
                />
                {/* Advisory only — never gates submission. */}
                <EmailFieldVerify
                  email={f.business_email}
                  disabled={f.no_email}
                  onAccept={(v) => set("business_email", v)}
                />
                <label className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
                  <input
                    type="checkbox"
                    checked={f.no_email}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      set("no_email", checked);
                      if (checked) set("business_email", "");
                    }}
                    className="accent-accent"
                  />
                  No email (customer didn&apos;t provide one)
                </label>
                {dupBy("email") && (
                  <p className="mt-1 text-[11px] text-dropped-fg">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 inline" />{" "}
                    {dupBy("email")!.isOwn
                      ? "You already have a lead with this email."
                      : `This email belongs to a lead owned by ${dupBy("email")!.ownerDisplayName ?? "another agent"}.`}
                  </p>
                )}
              </F>
            </div>
            <F error={errors.platform} label="Platform" required>
              <RadioPillGroup options={PLATFORM_OPTIONS} value={f.platform} onChange={(v) => set("platform", v)} />
              <div className="mt-3" data-error={errors.business_profile_link ? "true" : undefined}>
                <input value={f.business_profile_link} onChange={(e) => set("business_profile_link", e.target.value)} placeholder="Enter profile link" className={inputCls} />
                <FieldError error={errors.business_profile_link} />
              </div>
              <ConditionalBlock open={f.platform === "Other"} label="Other Platform">
                <div data-error={errors.other_platform ? "true" : undefined}>
                  <input value={f.other_platform} onChange={(e) => set("other_platform", e.target.value)} placeholder="e.g., Facebook, Instagram, LinkedIn" className={inputCls} />
                  <FieldError error={errors.other_platform} />
                </div>
              </ConditionalBlock>
            </F>
            <F error={errors.social_profiles} label="Social Profiles (optional)" hint="Add as many as the business has.">
              <SocialProfilesField values={f.social_profiles} onChange={(v) => set("social_profiles", v)} />
            </F>
          </SectionCard>

          <SectionCard n={2} icon={MapPinned} title="Location & Services" subtitle="Coverage & offering" done={sectionDone("location")} delay={showAssignment ? 120 : 60}>
            <F error={errors.map_embed_link} label="Map Embed Link">
              <textarea value={f.map_embed_link} onChange={(e) => set("map_embed_link", e.target.value)} placeholder="Paste your map embed link or iframe code here" rows={2} className={inputCls} />
            </F>
            <F error={errors.has_service_areas} label="Service Areas" required>
              <RadioPillGroup options={["Yes", "No"]} value={f.has_service_areas} onChange={setServiceAreas} />
              <ConditionalBlock open={f.has_service_areas === "Yes"} label="Areas">
                <div data-error={errors.areas ? "true" : undefined}>
                  <DynamicList values={f.areas} onChange={setAreas} placeholder="Enter service area" addLabel="Add Area" />
                  <FieldError error={errors.areas} />
                </div>
              </ConditionalBlock>
            </F>
            <F error={errors.services} label="Services" required>
              <DynamicList values={f.services} onChange={(v) => set("services", v)} placeholder="Enter service" addLabel="Add Service" />
            </F>
            <F
              error={errors.about_business}
              label="About Business (optional)"
              hint="Extra background for the website generator — history, specialities, what makes them different, service-area notes. Anything you write here is treated as fact by the AI, so only put down what the client actually told you."
            >
              <textarea value={f.about_business} onChange={(e) => set("about_business", e.target.value)} placeholder="e.g., Family run since 1998, specialises in historic-home restoration, only takes jobs within 30 miles of Islip..." rows={6} maxLength={4000} className={inputCls} />
            </F>
          </SectionCard>

          <SectionCard n={3} icon={Globe} title="Website Details" subtitle="Scope of the build" done={sectionDone("website")} delay={showAssignment ? 180 : 120}>
            <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
              <F error={errors.client_experience} label="Client's Experience (Years)" required>
                <input type="number" min={0} value={f.client_experience} onChange={(e) => set("client_experience", e.target.value)} placeholder="e.g., 5" className={inputCls} />
              </F>
              <Field label="No. of Webpages" hint="Auto-derived from the pages below.">
                <div className={inputCls + " flex items-center bg-surface-2 font-mono text-text-muted"}>
                  {total || "—"}
                </div>
              </Field>
            </div>
            <F error={errors.specify_pages} label="Specify Webpages" required hint={total > 0 ? `Total webpages: ${total}.` : "Selections determine the total number of webpages."}>
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
            <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
              <F error={errors.color_scheme} label="Color Scheme" required hint={`Up to ${MAX_COLORS} colours. Pick swatches or type names/hex.`}>
                <ColorSchemeField
                  value={f.color_scheme}
                  onChange={(v) => set("color_scheme", v)}
                  check={colorCheck}
                />
              </F>
              <F error={errors.logo_link} label="Logo Link">
                <label className="mb-1.5 flex items-center gap-1.5 text-xs text-text-muted">
                  <input
                    type="checkbox"
                    checked={f.logo_via_sms}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      set("logo_via_sms", checked);
                      if (checked) set("logo_link", "");
                    }}
                    className="accent-accent"
                  />
                  Sent via SMS
                </label>
                <input
                  type="url"
                  value={f.logo_link}
                  onChange={(e) => set("logo_link", e.target.value)}
                  placeholder="https://example.com/logo.png"
                  disabled={f.logo_via_sms}
                  className={inputCls + (f.logo_via_sms ? " opacity-50" : "")}
                />
              </F>
            </div>
            <F error={errors.design_reference_links} label="Design Reference Sites (optional)" hint="Sites the client shared as design inspiration (max 3)">
              <DynamicList
                values={f.design_reference_links}
                onChange={(v) => set("design_reference_links", v.slice(0, 3))}
                placeholder="https://example.com"
                addLabel="Add Site"
                inputType="url"
                max={3}
              />
            </F>
            <F error={errors.image_links} label="Image Links">
              <DynamicList values={f.image_links} onChange={(v) => set("image_links", v)} placeholder="https://example.com/image.jpg" addLabel="Add Image Link" inputType="url" />
            </F>
            <F
              error={errors.developer_instructions}
              label="Instructions for Developer (optional)"
              hint="Anything you promised the client that the build has to honour."
            >
              <textarea value={f.developer_instructions} onChange={(e) => set("developer_instructions", e.target.value)} placeholder="e.g., Keep the booking button in the header on mobile; the owner wants the team photo on the About page, not the hero..." rows={5} maxLength={8000} className={inputCls} />
            </F>
          </SectionCard>

          <SectionCard n={4} icon={DollarSign} title="Pricing & Follow Up" subtitle="Commercials & next touch" done={sectionDone("pricing")} delay={showAssignment ? 240 : 180}>
            <F error={errors.follow_up_time} label="Follow Up Time" required>
              <input type="datetime-local" value={f.follow_up_time} onChange={(e) => set("follow_up_time", e.target.value)} className={inputCls} />
            </F>
            <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
              <F error={errors.price_quoted} label="Price Quoted" required>
                <RadioPillGroup options={PRICE_OPTIONS} value={f.price_quoted} onChange={(v) => set("price_quoted", v)} />
                <ConditionalBlock open={f.price_quoted === "Other"}>
                  <div className="relative" data-error={errors.price_custom ? "true" : undefined}>
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">$</span>
                    <input type="number" min={0} value={f.price_custom} onChange={(e) => set("price_custom", e.target.value)} placeholder="Enter custom price" className={inputCls + " pl-7"} />
                  </div>
                  <FieldError error={errors.price_custom} />
                </ConditionalBlock>
              </F>
              <F error={errors.yearly_price} label="Yearly Price">
                <RadioPillGroup options={YEARLY_OPTIONS} value={f.yearly_price} onChange={(v) => set("yearly_price", v)} />
                <ConditionalBlock open={f.yearly_price === "Other"}>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">$</span>
                    <input type="number" min={0} value={f.yearly_custom} onChange={(e) => set("yearly_custom", e.target.value)} placeholder="Enter yearly price" className={inputCls + " pl-7"} />
                  </div>
                </ConditionalBlock>
              </F>
            </div>
            <F error={errors.add_ons} label="Add-ons Offered (optional)">
              <div className="flex flex-wrap gap-2">
                {addons.map((a) => {
                  const on = f.add_ons.some((x) => x.id === a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        set(
                          "add_ons",
                          on
                            ? f.add_ons.filter((x) => x.id !== a.id)
                            : [...f.add_ons, { id: a.id, label: a.label, price: a.price }]
                        )
                      }
                      className={
                        "px-3 py-1.5 text-sm rounded-md border transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none " +
                        (on
                          ? "border-accent bg-accent-soft text-accent-ink font-medium"
                          : "border-border text-text-muted hover:bg-surface-2")
                      }
                    >
                      {a.label}
                      {a.price != null ? ` — $${a.price}` : ""}
                    </button>
                  );
                })}
                {addons.length === 0 && (
                  <span className="text-xs text-text-muted">No add-ons configured.</span>
                )}
              </div>
              {f.add_ons.length > 0 && (
                <div className="mt-3 space-y-2">
                  {f.add_ons.map((x) => (
                    <div key={x.id} className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm text-text">{x.label}</span>
                      <div className="relative w-36 shrink-0">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">$</span>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={x.price ?? ""}
                          onChange={(e) =>
                            set(
                              "add_ons",
                              f.add_ons.map((y) =>
                                y.id === x.id
                                  ? { ...y, price: e.target.value === "" ? null : Number(e.target.value) }
                                  : y
                              )
                            )
                          }
                          placeholder="Quoted price"
                          aria-label={`Quoted price for ${x.label}`}
                          className={inputCls + " pl-7"}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </F>
            <F error={errors.direct_line_saved} label="Direct Line saved?">
              <RadioPillGroup options={["Yes", "No"]} value={f.direct_line_saved} onChange={(v) => set("direct_line_saved", v as "Yes" | "No")} />
            </F>
            <ConditionalBlock open={f.site_type === "Redesign"} label="Reference Site (optional)">
              <div data-error={errors.reference_link ? "true" : undefined}>
                <input type="url" value={f.reference_link} onChange={(e) => set("reference_link", e.target.value)} placeholder="https://referencesite.com" className={inputCls} />
                <FieldError error={errors.reference_link} />
              </div>
            </ConditionalBlock>
          </SectionCard>

          <SectionCard n={5} icon={ClipboardCheck} title="Final Assessment" subtitle="Your read on the lead" done={sectionDone("assessment")} delay={showAssignment ? 300 : 240}>
            <F error={errors.comments} label="Specific Comments on Client" required>
              <textarea value={f.comments} onChange={(e) => set("comments", e.target.value)} placeholder="Enter detailed comments about the client..." rows={4} className={inputCls} />
            </F>
            <div className="grid grid-cols-1 gap-x-5 gap-y-5 sm:grid-cols-2">
              <F error={errors.rating} label="Give Lead a Rating (1–10)" required>
                <RatingGroup value={f.rating} onChange={(v) => set("rating", v)} />
              </F>
              <F error={errors.fresh_or_followup} label="Fresh or Follow Up?" required>
                <RadioPillGroup options={["Fresh", "Follow Up"]} value={f.fresh_or_followup} onChange={(v) => set("fresh_or_followup", v)} />
              </F>
            </div>
            <F error={errors.closed_by} label="Lead Closed by" required>
              <select value={f.closed_by} onChange={(e) => set("closed_by", e.target.value)} className={inputCls}>
                <option value="self">Self</option>
                {salesUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name}</option>
                ))}
              </select>
            </F>
          </SectionCard>

          {/* Mobile action row (sticky summary handles this on desktop) */}
          <div className="lg:hidden">
            {dupBanner}
            <div className="flex items-center gap-3">
              <Link href="/leads" className="rounded-lg border border-border px-4 py-2.5 text-sm text-text-muted hover:bg-surface-2">
                Cancel
              </Link>
              <div className="flex-1">{submitBtn}</div>
            </div>
          </div>
        </div>

        {/* Sticky summary */}
        <aside className="hidden lg:block">
          <div className="reveal sticky top-6 rounded-2xl border border-border bg-surface shadow-sm" style={{ animationDelay: "120ms" }}>
            <div className="border-b border-border-subtle px-5 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-faint">Summary</p>
              <p className="font-display text-base font-semibold text-text">Lead dossier</p>
            </div>
            <div className="px-5 py-3">
              <SummaryRow label="Business">{f.business_name.trim() || "—"}</SummaryRow>
              <SummaryRow label="Status">
                <span className={"rounded-md px-2 py-0.5 text-xs font-medium " + (STATUS_PILL[f.status] ?? "bg-surface-2 text-text-muted")}>
                  {f.status || "—"}
                </span>
              </SummaryRow>
              <SummaryRow label="Site type">{f.site_type || "—"}</SummaryRow>
              <SummaryRow label="Agent">{agentName}</SummaryRow>
              <SummaryRow label="Price">
                <span className="font-mono">{priceDisplay}</span>
              </SummaryRow>
              <SummaryRow label="Rating">
                {f.rating ? (
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Star size={13} className="fill-accent text-accent" />
                    {f.rating}/10
                  </span>
                ) : (
                  "—"
                )}
              </SummaryRow>
            </div>
            <div className="border-t border-border-subtle px-5 py-4">
              <p className="mb-3 text-xs text-text-muted">
                {remaining === 0 ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-ready-fg">
                    <Check size={14} /> All required fields complete
                  </span>
                ) : (
                  <>
                    <span className="font-mono font-semibold text-text">{remaining}</span> required{" "}
                    {remaining === 1 ? "field" : "fields"} remaining
                  </>
                )}
              </p>
              {dupBanner}
              {submitBtn}
              <Link
                href="/leads"
                className="mt-2 block rounded-lg border border-border px-4 py-2 text-center text-sm text-text-muted transition-colors hover:bg-surface-2"
              >
                Cancel
              </Link>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
