// lib/forms/email.ts
import type { PayloadField } from "@/lib/forms/types";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Request `subject` → endpoint template ({site}, {name}) → built-in default. Max 200 chars. */
export function resolveSubject(requestSubject: string, template: string, ctx: { site: string; name: string | null }): string {
  const req = requestSubject.trim();
  let out: string;
  if (req) out = req;
  else if (template.trim()) out = template.replace(/\{site\}/g, ctx.site).replace(/\{name\}/g, ctx.name ?? "a visitor");
  else out = `New form submission from ${ctx.site}`;
  return out.replace(/[\r\n]+/g, " ").slice(0, 200);
}

const MESSAGE_KEYS = ["message", "msg", "comments", "comment", "details", "description", "notes", "enquiry", "inquiry"];

/** Short one-line preview for the inbox row and the bell body. */
export function previewLine(payload: PayloadField[], max = 140): string {
  const byKey = new Map(payload.map((f) => [f.key.toLowerCase(), f.value.trim()]));
  let text = "";
  for (const k of MESSAGE_KEYS) {
    const v = byKey.get(k);
    if (v) {
      text = v;
      break;
    }
  }
  if (!text) text = payload.map((f) => f.value.trim()).find(Boolean) ?? "";
  text = text.replace(/\s+/g, " ");
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** Local time in `timeZone` with its abbreviation (e.g. "Sep 14, 2026, 12:37 PM EDT").
 *  Intl.format THROWS on an Invalid Date or bogus zone; this runs on the
 *  delivery path, where a throw would mark the whole delivery failed over a
 *  timestamp — hence the guards. */
function stamp(iso: string, timeZone: string): { local: string; utc: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { local: "unknown time", utc: "unknown time" };
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true };
  const fmt = (tz: string, withName: boolean) =>
    new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz, ...(withName ? { timeZoneName: "short" as const } : {}) }).format(d);
  let local: string;
  try { local = fmt(timeZone, true); } catch { local = fmt("UTC", true); }
  return { local, utc: fmt("UTC", false) };
}

const PHONE_KEYS = ["phone", "phone_number", "phonenumber", "your_phone", "tel", "telephone", "mobile", "cell", "cell_phone", "contact_number", "whatsapp"];

/** Best-effort phone from the payload: first phone-ish key with 7+ digits. */
export function extractPhone(payload: PayloadField[]): { display: string; tel: string } | null {
  const byKey = new Map(payload.map((f) => [f.key.toLowerCase(), f.value.trim()]));
  for (const k of PHONE_KEYS) {
    const v = byKey.get(k);
    if (!v) continue;
    const digits = v.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) continue;
    return { display: v.slice(0, 40), tel: (v.trim().startsWith("+") ? "+" : "") + digits };
  }
  return null;
}

export type BuiltEmail = { subject: string; text: string; html: string };

// SocialExpertDigital brand, matched to the company's customer-facing mails
// (navy band + crimson accents + serif-italic headline).
const NAVY = "#0f1e3d";
const CRIMSON = "#e62249";
const INK = "#1a2540";
const MUTED = "#6b7280";
const RULE = "#edeff3";

const COMPANY_URL = "https://socialexpertdigitalllc.com";
const LOGO = `<a href="${COMPANY_URL}" target="_blank" style="text-decoration:none"><span style="color:#ffffff">Social</span><span style="color:${CRIMSON}">Expert</span><span style="color:#ffffff">Digital</span></a>`;

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function initials(name: string | null | undefined, fallback: string): string {
  const src = (name ?? "").trim() || fallback.trim();
  const parts = src.split(/\s+/).filter(Boolean);
  const two = (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "");
  return (two || "SD").toUpperCase();
}

export function buildFormEmail(input: {
  endpointName: string;
  subject: string;
  payload: PayloadField[];
  origin: string | null;
  createdAt: string;
  submitterName?: string | null;
  submitterEmail?: string | null;
  /** IANA zone for the "received" stamps; resolved by the caller (endpoint → lead area → Eastern). */
  timeZone?: string | null;
}): BuiltEmail {
  const tz = input.timeZone?.trim() || "America/New_York";
  const { local, utc } = stamp(input.createdAt, tz);
  const site = input.origin?.trim() || input.endpointName;
  // Header-injection defense lives HERE, not only in resolveSubject: no
  // caller contract forces the subject through resolveSubject first.
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200) || `New form submission from ${site}`;

  const text = [
    `New form submission — ${input.endpointName}`,
    "",
    ...input.payload.map((f) => `${f.key}: ${f.value}`),
    "",
    `Site: ${site}`,
    `Received: ${local} · ${utc} (UTC)`,
    "Sent by SED LMS Form Relay",
  ].join("\n");

  const rows = input.payload
    .map(
      (f) =>
        `<tr><td class="sed-label" style="padding:11px 0;border-bottom:1px solid ${RULE};color:#8a93a6;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;vertical-align:top;width:140px">${escapeHtml(f.key)}</td><td class="sed-value" style="padding:11px 0 11px 18px;border-bottom:1px solid ${RULE};color:${INK};font-size:14px;line-height:1.55;white-space:pre-wrap">${escapeHtml(f.value).replace(/\r?\n/g, "<br>")}</td></tr>`
    )
    .join("");

  const name = (input.submitterName ?? "").trim();
  const email = (input.submitterEmail ?? "").trim();
  const phone = extractPhone(input.payload);
  const siteHtml = HOSTNAME_RE.test(site)
    ? `<a href="https://${site}" target="_blank" style="color:${INK};font-weight:bold">${escapeHtml(site)}</a>`
    : `<strong style="color:${INK}">${escapeHtml(site)}</strong>`;

  const senderBlock = name || email
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:#f7f8fa;border:1px solid ${RULE};border-radius:8px"><tr>
<td style="padding:14px 16px;width:40px;vertical-align:middle"><div style="width:40px;height:40px;border-radius:50%;background:${NAVY};color:#ffffff;font-size:14px;font-weight:bold;text-align:center;line-height:40px">${escapeHtml(initials(name, input.endpointName))}</div></td>
<td style="padding:14px 12px;vertical-align:middle"><div style="color:${INK};font-size:14px;font-weight:bold">${escapeHtml(name || "A visitor")}</div>${email ? `<div style="color:${MUTED};font-size:12px;padding-top:2px">${escapeHtml(email)}</div>` : ""}</td>
<td class="sed-when" align="right" style="padding:14px 16px;vertical-align:middle;color:#9aa3b5;font-size:11px;white-space:nowrap">${escapeHtml(local)}</td>
</tr></table>`
    : "";

  const buttons: string[] = [];
  if (email) {
    buttons.push(`<a href="mailto:${escapeHtml(email)}" style="display:inline-block;background:${CRIMSON};color:#ffffff;font-size:13px;font-weight:bold;text-decoration:none;padding:11px 22px;border-radius:6px">Reply by Email</a>`);
  }
  if (phone) {
    buttons.push(`<a href="tel:${escapeHtml(phone.tel)}" style="display:inline-block;background:${NAVY};color:#ffffff;font-size:13px;font-weight:bold;text-decoration:none;padding:11px 22px;border-radius:6px">Call ${escapeHtml(phone.display)}</a>`);
  }
  const buttonBlock = buttons.length
    ? `<table role="presentation" class="sed-btn" cellpadding="0" cellspacing="0" style="margin:22px 0 0"><tr>${buttons.map((b) => `<td style="padding:0 10px 8px 0">${b}</td>`).join("")}</tr></table>`
    : "";

  const html = `<style>
@media only screen and (max-width:480px){
  .sed-card{padding:22px 16px !important}
  .sed-head,.sed-foot{padding:16px 18px !important}
  .sed-h1{font-size:22px !important}
  .sed-when{display:none !important}
  .sed-label{display:block !important;width:100% !important;padding:10px 0 0 !important;border-bottom:0 !important}
  .sed-value{display:block !important;padding:3px 0 10px !important}
  .sed-btn td{display:block !important;padding:0 0 8px !important}
}
</style>
<div style="margin:0;padding:32px 12px;background:#eef0f4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif">
<tr><td class="sed-head" style="background:${NAVY};border-radius:10px 10px 0 0;padding:18px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:18px;font-weight:bold;letter-spacing:.3px">${LOGO}</td>
    <td align="right" style="color:#8fa0c0;font-size:10px;font-weight:bold;letter-spacing:2px">NEW LEAD</td>
  </tr></table>
</td></tr>
<tr><td style="height:3px;background:${CRIMSON};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td class="sed-card" style="background:#ffffff;padding:30px 28px 26px">
  <p style="margin:0 0 12px;color:${CRIMSON};font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">&mdash; Form submission &middot; ${escapeHtml(input.endpointName)}</p>
  <h1 class="sed-h1" style="margin:0 0 8px;color:${NAVY};font-size:26px;font-weight:bold;font-family:Georgia,'Times New Roman',serif">A new message <em style="font-weight:normal">for you.</em></h1>
  <p style="margin:0 0 24px;color:${MUTED};font-size:13px;line-height:1.5">Someone just filled out the form on ${siteHtml} &mdash; the full details are below.</p>
  ${senderBlock}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows || `<tr><td style="padding:11px 0;color:${MUTED};font-size:14px">No fields were submitted.</td></tr>`}</table>
  ${buttonBlock}
  <p style="margin:24px 0 0;color:#9aa3b5;font-size:11px;line-height:1.6">Site: ${escapeHtml(site)}<br>Received: ${escapeHtml(local)} &middot; ${escapeHtml(utc)} (UTC)</p>
</td></tr>
<tr><td class="sed-foot" style="background:${NAVY};border-radius:0 0 10px 10px;padding:20px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:14px;font-weight:bold">${LOGO}<div style="color:#8fa0c0;font-size:10px;font-weight:normal;padding-top:4px">Agency-quality websites, SEO &amp; AI for American small businesses.</div></td>
    <td align="right" style="color:#8fa0c0;font-size:10px;line-height:1.7;vertical-align:middle">Sent by SED LMS Form Relay<br>&copy; <a href="${COMPANY_URL}" target="_blank" style="color:#8fa0c0">SocialExpertDigital LLC</a></td>
  </tr></table>
</td></tr>
<tr><td style="padding:14px 8px 0;color:#9aa3b5;font-size:11px;font-style:italic;text-align:center;font-family:Georgia,'Times New Roman',serif">P.S. Fast replies win customers &mdash; this visitor is waiting to hear from you.</td></tr>
</table>
</div>`;
  return { subject, text, html };
}
