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

function stamp(iso: string): { karachi: string; utc: string } {
  const d = new Date(iso);
  // Intl.format THROWS on an Invalid Date; this runs on the delivery path,
  // where a throw would mark the whole delivery failed over a timestamp.
  if (Number.isNaN(d.getTime())) return { karachi: "unknown time", utc: "unknown time" };
  const fmt = (tz: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(d);
  return { karachi: fmt("Asia/Karachi"), utc: fmt("UTC") };
}

export type BuiltEmail = { subject: string; text: string; html: string };

export function buildFormEmail(input: {
  endpointName: string;
  subject: string;
  payload: PayloadField[];
  origin: string | null;
  createdAt: string;
}): BuiltEmail {
  const { karachi, utc } = stamp(input.createdAt);
  const site = input.origin?.trim() || "unknown site";
  // Header-injection defense lives HERE, not only in resolveSubject: no
  // caller contract forces the subject through resolveSubject first.
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200) || `New form submission from ${site}`;

  const text = [
    `New form submission — ${input.endpointName}`,
    "",
    ...input.payload.map((f) => `${f.key}: ${f.value}`),
    "",
    `Site: ${site}`,
    `Time: ${karachi} (Asia/Karachi) · ${utc} (UTC)`,
    "Sent by SED LMS Form Relay",
  ].join("\n");

  const rows = input.payload
    .map(
      (f) =>
        `<tr><td style="padding:6px 10px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;vertical-align:top;white-space:nowrap">${escapeHtml(f.key)}</td><td style="padding:6px 10px;border:1px solid #e5e7eb;white-space:pre-wrap">${escapeHtml(f.value).replace(/\r?\n/g, "<br>")}</td></tr>`
    )
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;max-width:640px">
<h2 style="font-size:16px;margin:0 0 12px">New form submission — ${escapeHtml(input.endpointName)}</h2>
<table style="border-collapse:collapse;width:100%">${rows || `<tr><td style="padding:6px 10px">No fields were submitted.</td></tr>`}</table>
<p style="color:#6b7280;font-size:12px;margin-top:16px">Site: ${escapeHtml(site)}<br>Time: ${escapeHtml(karachi)} (Asia/Karachi) · ${escapeHtml(utc)} (UTC)<br>Sent by SED LMS Form Relay</p>
</div>`;
  return { subject, text, html };
}
