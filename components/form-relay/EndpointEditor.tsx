"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/common/Panel";
import { Select } from "@/components/common/Select";
import { Field, inputCls } from "@/components/forms/Field";
import { btnPrimary, btnSecondary } from "@/components/common/buttons";
import { useToast } from "@/components/common/Toast";
import { US_TIMEZONE_OPTIONS } from "@/lib/geo/timezones";
import type { FormEndpointRow } from "@/lib/forms/types";

export type LeadOption = { id: string; business_name: string; business_email: string | null };
export type MailboxOption = { id: string; email_address: string; display_name: string };

const splitList = (s: string) => s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

export function EndpointEditor({
  initial,
  leads,
  mailboxes,
  presetLeadId = null,
}: {
  initial: FormEndpointRow | null;
  leads: LeadOption[];
  mailboxes: MailboxOption[];
  /** From /forms/endpoints/new?lead=<id> (the lead page shortcut). */
  presetLeadId?: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const presetLead = leads.find((l) => l.id === presetLeadId) ?? null;

  const [name, setName] = useState(initial?.name ?? (presetLead ? `${presetLead.business_name} – contact` : ""));
  const [leadId, setLeadId] = useState(initial?.lead_id ?? presetLeadId ?? "");
  const [toEmails, setToEmails] = useState((initial?.to_emails ?? (presetLead?.business_email ? [presetLead.business_email] : [])).join(", "));
  const [subjectTemplate, setSubjectTemplate] = useState(initial?.subject_template ?? "");
  const [mailboxId, setMailboxId] = useState(initial?.mailbox_id ?? "");
  const [origins, setOrigins] = useState((initial?.allowed_origins ?? []).join(", "));
  const [dailyLimit, setDailyLimit] = useState(initial?.daily_limit ?? 200);
  const [redirect, setRedirect] = useState(initial?.success_redirect_url ?? "");
  const [timezone, setTimezone] = useState(initial?.timezone ?? "");
  const [paused, setPaused] = useState(initial?.status === "paused");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onLeadChange(id: string) {
    setLeadId(id);
    const l = leads.find((x) => x.id === id);
    if (l && !initial) {
      if (!name) setName(`${l.business_name} – contact`);
      if (!toEmails && l.business_email) setToEmails(l.business_email);
    }
  }

  async function save() {
    setSaving(true); setError(null);
    const body = {
      name: name.trim(),
      lead_id: leadId || null,
      to_emails: splitList(toEmails),
      subject_template: subjectTemplate.trim(),
      mailbox_id: mailboxId || null,
      allowed_origins: splitList(origins),
      daily_limit: Math.max(1, Math.round(Number(dailyLimit)) || 200),
      success_redirect_url: redirect.trim() || null,
      timezone: timezone || null,
      status: paused ? "paused" : "active",
    };
    const res = await fetch(initial ? `/api/forms/endpoints/${initial.id}` : "/api/forms/endpoints", {
      method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setSaving(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const first = json.issues?.fieldErrors ? Object.entries(json.issues.fieldErrors as Record<string, string[]>).map(([k, v]) => `${k}: ${v[0]}`)[0] : null;
      setError(first ?? json.error ?? "Save failed");
      return;
    }
    toast({ kind: "success", title: initial ? "Endpoint saved" : "Endpoint created" });
    if (initial) router.refresh(); else router.push(`/forms/endpoints/${json.endpoint.id}`);
  }

  return (
    <Panel title={initial ? "Settings" : "New endpoint"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Roofing – contact form" /></Field>
        <Field label="Lead" hint="Submissions show on this lead's page and ping its agent.">
          <Select className={inputCls} value={leadId} onChange={(e) => onLeadChange(e.target.value)}>
            <option value="">— none —</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.business_name}</option>)}
          </Select>
        </Field>
        <Field label="Send to" required hint="Comma-separated email addresses of the client.">
          <input className={inputCls} value={toEmails} onChange={(e) => setToEmails(e.target.value)} placeholder="owner@client.com" />
        </Field>
        <Field label="Subject template" hint="{site} = endpoint name, {name} = visitor. Blank = default.">
          <input className={inputCls} value={subjectTemplate} onChange={(e) => setSubjectTemplate(e.target.value)} placeholder="New enquiry from {name} — {site}" />
        </Field>
        <Field label="Sender mailbox" hint="Blank = the default set in Admin › Settings.">
          <Select className={inputCls} value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
            <option value="">— default —</option>
            {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.display_name ? `${m.display_name} <${m.email_address}>` : m.email_address}</option>)}
          </Select>
        </Field>
        <Field label="Allowed origins" hint="Hostnames, comma-separated. Blank = any site may post. *.example.com matches subdomains.">
          <input className={inputCls} value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="acmeroofing.com, *.acmeroofing.com" />
        </Field>
        <Field label="Daily limit"><input type="number" min={1} className={inputCls} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} /></Field>
        <Field label="Email timezone" hint="For the received-at time in the email. Automatic = the lead's area, else Eastern.">
          <Select className={inputCls} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            <option value="">— automatic —</option>
            {US_TIMEZONE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Redirect after plain HTML post" hint="Only used by non-JavaScript forms."><input className={inputCls} value={redirect} onChange={(e) => setRedirect(e.target.value)} placeholder="https://acmeroofing.com/thank-you" /></Field>
        <label className="flex items-center gap-2 text-sm text-text sm:col-span-2">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} /> Paused (submissions are rejected with 410)
        </label>
      </div>
      {error ? <p className="mt-3 text-sm text-dropped-fg">{error}</p> : null}
      <div className="mt-5 flex gap-2">
        <button type="button" className={btnPrimary} disabled={saving} onClick={save}>{saving ? "Saving…" : initial ? "Save changes" : "Create endpoint"}</button>
        <button type="button" className={btnSecondary} onClick={() => router.push("/forms/endpoints")}>Back</button>
      </div>
    </Panel>
  );
}
